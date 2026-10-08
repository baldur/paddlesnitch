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
// With PERF_EMAIL and PERF_PASSWORD (the test account: scripts/perf-account.ts;
// in CI the password comes from SSM) it also signs in and times the signed-in
// pages and the data behind them. Without them it times the public pages only.

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

async function time(url: string, extra: Record<string, string> = {}): Promise<{ sample: Sample; headers: Headers; body: string }> {
  const t0 = performance.now()
  try {
    const res = await fetch(url, { redirect: 'manual', headers: { 'accept-encoding': 'gzip, br', ...extra } })
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

  // Signed in, with the test account: the pages people actually use, and the
  // data behind them (these pages fetch it after they load).
  const email = process.env.PERF_EMAIL, password = process.env.PERF_PASSWORD
  if (email && password) {
    const login = await fetch(`${BASE}/att/api/auth/login`, {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
    })
    const cookie = (login.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ')
    if (!login.ok || !cookie) {
      checks.push({ name: 'Signed in as the test account', ok: false, detail: `sign-in answered ${login.status}` })
    } else {
      const auth = { cookie }
      const data = async (p: string) => JSON.parse((await time(BASE + p, auth)).body || 'null')
      const sessions = (await data('/api/trpc/paddles.sessions'))?.result?.data as { id: string; source: { type: string; deviceId?: string; deviceSessionId?: string } }[] | undefined
      const tracker = sessions?.find(x => x.source.type === 'device')
      const paddleId = tracker?.id ?? sessions?.[0]?.id
      const signedIn: { name: string; path: string; budgetMs: number }[] = [
        { name: 'Paddles', path: '/paddles', budgetMs: 500 },
        { name: 'Paddles (data)', path: '/api/trpc/paddles.sessions', budgetMs: 800 },
        { name: 'Devices (data)', path: '/api/account/devices/sessions', budgetMs: 800 },
        ...(paddleId ? [
          { name: 'A paddle', path: `/paddles/${paddleId}`, budgetMs: 500 },
          { name: 'A paddle (data)', path: `/api/trpc/paddles.get?input=${encodeURIComponent(JSON.stringify({ id: paddleId }))}`, budgetMs: 800 },
        ] : []),
        ...(tracker?.source.deviceSessionId ? [
          { name: 'Boat motion (data)', path: `/api/account/devices/sessions/${tracker.source.deviceSessionId}?deviceId=${tracker.source.deviceId}`, budgetMs: 800 },
        ] : []),
      ]
      for (const p of signedIn) {
        const samples: Sample[] = []
        for (let i = 0; i < RUNS; i++) samples.push((await time(BASE + p.path, auth)).sample)
        results.push(summarise(p.name, p.path, samples, p.budgetMs))
      }
      // A repeat view the browser already has should cost no body at all.
      const motion = signedIn.find(p => p.name === 'Boat motion (data)')
      if (motion) {
        const first = await time(BASE + motion.path, auth)
        const etag = first.headers.get('etag')
        const again = etag ? await time(BASE + motion.path, { ...auth, 'if-none-match': etag }) : null
        checks.push({
          name: 'Boat motion: a repeat view is a 304',
          ok: again?.sample.status === 304,
          // The tags themselves, so a miss says why (a weakened tag, a changed one).
          detail: etag ? `repeat answered ${again?.sample.status} in ${Math.round(again!.sample.ttfbMs)} ms (sent ${etag.slice(0, 14)}…, got back ${(again?.headers.get('etag') ?? 'none').slice(0, 14)}…)` : 'no ETag sent',
        })
      }
    }
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
