#!/usr/bin/env node
// Performance check: time the public pages and report, always (see
// src/lib/perf.ts for what is measured and why).
//
//   pnpm perf                                  # against https://paddlesnitch.com
//   pnpm perf -- --base http://localhost:3000  # against a local server
//   pnpm perf -- --runs 8 --strict             # fail if a page is over budget
//
// Writes perf-results.json and perf-metrics.json (CloudWatch metric data for
// `aws cloudwatch put-metric-data --cli-input-json file://perf-metrics.json`),
// prints a Markdown report, and appends it to $GITHUB_STEP_SUMMARY in CI.
// Signed-out pages only: the signed-in ones need an account to sign in with.

import { appendFileSync, writeFileSync } from 'fs'
import { summarise, checkImmutable, markdown, metricData, type Sample, type PageResult, type Check } from '../src/lib/perf'

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined }
const BASE = (arg('base') ?? process.env.PERF_BASE_URL ?? 'https://paddlesnitch.com').replace(/\/$/, '')
const RUNS = Math.max(2, Number(arg('runs') ?? 5))
const STRICT = process.argv.includes('--strict')

// Name, path, and the median TTFB budget in ms. Fixed names: they are the
// CloudWatch dimension, and a renamed page would start a new series.
const PAGES: { name: string; path: string; budgetMs: number }[] = [
  { name: 'Home', path: '/', budgetMs: 500 },
  { name: 'Trials', path: '/att', budgetMs: 1000 },
  { name: 'Courses', path: '/att/courses', budgetMs: 1000 },
  { name: 'Help', path: '/help', budgetMs: 500 },
  { name: 'Guide', path: '/guide', budgetMs: 500 },
  { name: 'Sign in', path: '/signin', budgetMs: 500 },
  { name: 'Privacy', path: '/privacy', budgetMs: 500 },
]

async function time(url: string): Promise<{ sample: Sample; headers: Headers; body: string }> {
  const t0 = performance.now()
  try {
    const res = await fetch(url, { redirect: 'manual', headers: { 'accept-encoding': 'gzip, br' } })
    const ttfbMs = performance.now() - t0
    const body = await res.text()
    return { sample: { status: res.status, ttfbMs, totalMs: performance.now() - t0, bytes: Buffer.byteLength(body) }, headers: res.headers, body }
  } catch {
    // Unreachable still gives a result: status 0, and the time it took to fail.
    const ms = performance.now() - t0
    return { sample: { status: 0, ttfbMs: ms, totalMs: ms, bytes: 0 }, headers: new Headers(), body: '' }
  }
}

async function main() {
  const at = new Date()
  const results: PageResult[] = []
  const checks: Check[] = []

  // A real trial and course page, found from the lists (ids differ per site).
  const trials = await time(`${BASE}/att`)
  const trialPath = /href="(\/att\/trials\/[^"/]+)"/.exec(trials.body)?.[1]
  const courses = await time(`${BASE}/att/courses`)
  const coursePath = /href="(\/att\/courses\/[^"/]+)"/.exec(courses.body)?.[1]
  const pages = [
    ...PAGES,
    ...(trialPath ? [{ name: 'A trial', path: trialPath, budgetMs: 1000 }] : []),
    ...(coursePath ? [{ name: 'A course', path: coursePath, budgetMs: 1000 }] : []),
  ]

  let homeHtml = ''
  for (const p of pages) {
    const samples: Sample[] = []
    for (let i = 0; i < RUNS; i++) {
      const r = await time(BASE + p.path)
      samples.push(r.sample)
      if (p.path === '/' && !homeHtml) homeHtml = r.body
    }
    results.push(summarise(p.name, p.path, samples, p.budgetMs))
  }

  // One built file: is it marked "keep for a year"?
  const asset = /\/_next\/static\/[^"]+\.js/.exec(homeHtml)?.[0]
  if (asset) checks.push(checkImmutable((await time(BASE + asset)).headers.get('cache-control')))
  else checks.push({ name: 'Built files cached for a year', ok: false, detail: 'no built file found on the home page' })

  const report = markdown(results, checks, { baseUrl: BASE, runs: RUNS, at: at.toISOString() })
  console.log(report)
  writeFileSync('perf-results.json', JSON.stringify({ baseUrl: BASE, at: at.toISOString(), runs: RUNS, results, checks }, null, 2))
  writeFileSync('perf-metrics.json', JSON.stringify(metricData(results, at), null, 2))
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n')

  if (STRICT && results.some(r => r.overBudget || r.status !== 200)) process.exit(1)
}

main().catch(err => {
  // Even a crash reports something.
  const msg = `## Performance: ${BASE}\n\nThe check itself failed: ${err instanceof Error ? err.message : String(err)}`
  console.error(msg)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, msg + '\n')
  process.exit(STRICT ? 1 : 0)
})
