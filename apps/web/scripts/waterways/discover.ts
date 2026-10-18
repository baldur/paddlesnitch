#!/usr/bin/env node
// Weekly search of open-data catalogues for new datasets about the
// water (packages/waterways/src/discovery.ts). Prints a digest; with --out it
// writes the issue body to a file for the refresh workflow to post.
//
//   pnpm --filter web waterways:discover [--days 8] [--out file.md]
//
// data.gov.uk is left out: its catalogue has no working search API (2026-10).
import fs from 'fs'
import { digest, fromArcgis, fromCkan, newCandidates, type Candidate } from '@paddlesnitch/waterways/discovery'

// OpenDataNI's firewall answers 403 unless the user agent looks like a browser
// ("Mozilla/5.0 paddlesnitch" passes; a hyphen, a URL or "compatible;" fails).
const UA = 'Mozilla/5.0 paddlesnitch'
const args = process.argv.slice(2)
const arg = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const since = new Date(Date.now() - Number(arg('--days') ?? 8) * 86_400_000)
const TERMS = ['lock', 'weir', 'slipway', 'portage', 'canoe', 'kayak', 'blueway', 'towpath', 'river access']

async function json(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

async function ckan(catalogue: Candidate['catalogue'], base: string, api: string): Promise<Candidate[]> {
  const out: Candidate[] = []
  for (const t of TERMS) {
    const d = await json(`${api}/package_search?q=${encodeURIComponent(t)}&rows=50&sort=metadata_created%20desc`) as { result?: { results?: unknown[] } }
    out.push(...fromCkan(catalogue, base, d.result?.results ?? []))
  }
  return out
}

// One search per term, on the title: one OR'd query matches every field and
// fills the first 100 with world-wide survey forms.
async function arcgis(): Promise<Candidate[]> {
  const out: Candidate[] = []
  for (const t of TERMS) {
    const q = `title:"${t}" AND type:"Feature Service"`
    const d = await json(`https://www.arcgis.com/sharing/rest/search?q=${encodeURIComponent(q)}&bbox=-11,49.5,2,61&num=100&sortField=created&sortOrder=desc&f=json`) as { results?: unknown[] }
    out.push(...fromArcgis(d.results ?? []))
  }
  return out
}

async function main() {
  const failed: string[] = []
  const safe = async (name: string, p: Promise<Candidate[]>) => { try { return await p } catch (e) { failed.push(`${name} (${(e as Error).message})`); return [] } }
  const all = (await Promise.all([
    safe('data.gov.ie', ckan('data.gov.ie', 'https://data.gov.ie', 'https://data.gov.ie/api/3/action')),
    safe('OpenDataNI', ckan('OpenDataNI', 'https://www.opendatani.gov.uk', 'https://admin.opendatani.gov.uk/api/3/action')),
    safe('ArcGIS Online', arcgis()),
  ])).flat()
  const found = newCandidates(all, since)
  let body = found.length ? digest(found, since) : ''
  if (failed.length) body += `${body ? '\n\n' : ''}Couldn't search: ${failed.join('; ')}.`
  console.log(found.length ? body : `No new candidates since ${since.toISOString().slice(0, 10)}.${failed.length ? ` Couldn't search: ${failed.join('; ')}.` : ''}`)
  const out = arg('--out')
  if (out) fs.writeFileSync(out, found.length ? body : '')
}

main().catch(e => { console.error(e); process.exit(1) })
