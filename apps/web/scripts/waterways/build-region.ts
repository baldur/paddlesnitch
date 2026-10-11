#!/usr/bin/env node
// Build a river-planner region dataset and its coverage report.
//
//   pnpm --filter web waterways [region] [--refresh]
//
// Fetches OSM (Overpass), Canal & River Trust layers and the EA Thames pages,
// caching every raw response under apps/web/.cache/waterways/<region>/ so a
// rebuild doesn't hammer anyone (--refresh refetches). Writes
//   packages/waterways/data/<region>.json           the dataset
//   packages/waterways/data/<region>-coverage.md    what we know, and the gaps
// See docs/features/river-planner.md.
import fs from 'fs/promises'
import path from 'path'
import { featuresAlong } from '@paddlesnitch/waterways/along'
import { buildRegion } from '@paddlesnitch/waterways/build'
import { coverageSummary, lockCoverage, LOCK_FACTS, type LockCoverage } from '@paddlesnitch/waterways/coverage'
import { CRT_LAYERS, crtQueryUrl, featuresFromCrt, type CrtLayer } from '@paddlesnitch/waterways/ingest/crt'
import { featureQuery, linksFromOverpass, networkQuery, osmElementsFromOverpass, OVERPASS_URLS } from '@paddlesnitch/waterways/ingest/osm'
import { crewFromGuide, guidePaths, locksFromThamesPage, THAMES_GUIDES_URL, THAMES_LOCKS_URL } from '@paddlesnitch/waterways/ingest/thames'
import { route, snap } from '@paddlesnitch/waterways/network'
import { REGIONS } from '@paddlesnitch/waterways/regions'
import { SOURCES } from '@paddlesnitch/waterways/sources'
import type { CrewDetail, Feature } from '@paddlesnitch/waterways/types'

const UA = 'paddlesnitch-river-planner/0.1 (+https://paddlesnitch.com)'
const args = process.argv.slice(2)
const regionId = args.find(a => !a.startsWith('--')) ?? 'dw'
const refresh = args.includes('--refresh')
const region = REGIONS[regionId]
if (!region) throw new Error(`unknown region ${regionId}; known: ${Object.keys(REGIONS).join(', ')}`)

const ROOT = path.resolve(process.cwd(), '../..')
const CACHE = path.join(process.cwd(), '.cache/waterways', regionId)
const OUT = path.join(ROOT, 'packages/waterways/data')
const now = new Date().toISOString()

/** Fetch once, then read from the cache. Returns the body and when it was fetched. */
async function cached(name: string, fetcher: () => Promise<string>): Promise<{ body: string; fetchedAt: string }> {
  const file = path.join(CACHE, name)
  if (!refresh) {
    try {
      const [body, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)])
      return { body, fetchedAt: stat.mtime.toISOString() }
    } catch { /* not cached yet */ }
  }
  const body = await fetcher()
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, body)
  return { body, fetchedAt: now }
}

async function get(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.text()
}

/** Overpass is busy; try each mirror, a few times, backing off. */
async function overpass(query: string): Promise<string> {
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of OVERPASS_URLS) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA }, body: new URLSearchParams({ data: query }) })
        if (res.ok) return await res.text()
        last = `${res.status} ${url}`
      } catch (e) { last = e }
    }
    console.log(`  overpass busy (${last}); retrying…`)
    await new Promise(r => setTimeout(r, 15_000 * (attempt + 1)))
  }
  throw new Error(`Overpass failed: ${last}`)
}

async function main() {
  console.log(`Building ${region.id}: ${region.name}`)

  // OSM — network + points.
  const net = await cached('osm-network.json', () => overpass(networkQuery(region.bbox, region.navigations)))
  const navigable = new Set(region.navigations)
  const links = linksFromOverpass(JSON.parse(net.body).elements)
    .filter(l => navigable.has(l.name) || / cut$/i.test(l.name) || l.name === '' || /lock/i.test(l.name))
  const pts = await cached('osm-features.json', () => overpass(featureQuery(region.bbox)))
  const osm = osmElementsFromOverpass(JSON.parse(pts.body).elements)
  console.log(`  OSM: ${links.length} network links, ${osm.length} points`)

  // Canal & River Trust layers.
  const features: Feature[] = []
  for (const layer of Object.keys(CRT_LAYERS) as CrtLayer[]) {
    let offset = 0, page = 0
    for (;;) {
      const { body, fetchedAt } = await cached(`crt-${layer}-${page}.geojson`, () => get(crtQueryUrl(layer, region.bbox, offset)))
      const json = JSON.parse(body)
      features.push(...featuresFromCrt(layer, json.features ?? [], fetchedAt))
      if (!json.properties?.exceededTransferLimit) break
      offset += json.features.length
      page++
    }
  }
  console.log(`  CRT: ${features.length} features`)

  // EA Thames pages.
  const locksPage = await cached('ea-thames-locks.json', () => get(THAMES_LOCKS_URL))
  const eaLocks = locksFromThamesPage(JSON.parse(locksPage.body).details.body, locksPage.fetchedAt)
  features.push(...eaLocks)
  const guides = await cached('ea-thames-guides.json', () => get(THAMES_GUIDES_URL))
  const crewByLock: Record<string, CrewDetail> = {}
  for (const [name, guidePath] of guidePaths(JSON.parse(guides.body))) {
    const slug = guidePath.split('/').pop()!
    const page = await cached(`ea-guide-${slug}.json`, () => get(`https://www.gov.uk/api/content${guidePath}`))
    crewByLock[name.toLowerCase()] = crewFromGuide(JSON.parse(page.body).details.body)
  }
  console.log(`  EA: ${eaLocks.length} Thames locks, ${Object.keys(crewByLock).length} site guides`)

  const dataset = buildRegion({ region: region.id, bbox: region.bbox, builtAt: now, links, features, osm, crewByLock })
  await fs.mkdir(OUT, { recursive: true })
  await fs.writeFile(path.join(OUT, `${region.id}.json`), JSON.stringify(dataset))
  console.log(`  wrote ${region.id}.json — ${dataset.features.length} features, ${dataset.osm.length} OSM points`)

  await fs.writeFile(path.join(OUT, `${region.id}-coverage.md`), report(dataset))
  console.log(`  wrote ${region.id}-coverage.md`)
}

function report(dataset: ReturnType<typeof buildRegion>): string {
  const lines: string[] = [
    `# Coverage: ${region.name}`,
    '',
    `Built ${dataset.builtAt.slice(0, 10)} by \`pnpm --filter web waterways ${region.id}\`. Generated — don't edit by hand.`,
    '',
  ]
  const c = region.check
  if (c) {
    const s = snap(dataset.links, c.start), f = snap(dataset.links, c.finish)
    const r = s && f ? route(dataset.links, s, f) : null
    lines.push(`## Check: ${c.name}`, '')
    if (!r) {
      lines.push('**No route found.** The network is broken somewhere between start and finish.', '')
    } else {
      const along = featuresAlong(r.line, dataset.features)
      const rows = lockCoverage(along, dataset.osm)
      const km = r.lengthM / 1000
      lines.push(
        `| | We find | Reference |`,
        `|---|---|---|`,
        `| Distance | ${km.toFixed(1)} km | ${c.expectKm} km |`,
        `| Locks along the route | ${rows.length} | ${c.expectPortages} portages |`,
        '',
        `Reference: [${c.source.split('/').pop()}](${c.source}).`,
        '',
        "Locks and portages aren't the same count. Portages that aren't locks (the race's compulsory portage at Dreadnought Reach) aren't in any open dataset yet, and some locks may not be separate portages. The reference's portage diagrams are images, so the two lists haven't been matched one by one.",
        '',
        ...summaryTable(rows),
        ...lockTable(rows),
      )
    }
  }
  lines.push('## Sources', '')
  for (const s of Object.values(SOURCES)) lines.push(`- [${s.name}](${s.url}) — ${s.licence}. ${s.attribution}.`)
  lines.push('')
  return lines.join('\n')
}

const FACT_LABEL: Record<(typeof LOCK_FACTS)[number], string> = {
  portageSide: 'Portage side',
  takeOut: 'Take-out',
  putIn: 'Put-in',
  carry: 'Carry route',
  crewAccess: 'Crew access',
  parking: 'Parking',
  facilities: 'Facilities',
}

function summaryTable(rows: LockCoverage[]): string[] {
  const sum = coverageSummary(rows)
  return [
    '## What we know, per lock',
    '',
    '| Fact | Locks with it |',
    '|---|---|',
    ...LOCK_FACTS.map(f => `| ${FACT_LABEL[f]} | ${Math.round(sum[f] * rows.length)} / ${rows.length} (${Math.round(sum[f] * 100)}%) |`),
    '',
  ]
}

function lockTable(rows: LockCoverage[]): string[] {
  return [
    '## Every lock',
    '',
    `| km | Lock | ${LOCK_FACTS.map(f => FACT_LABEL[f]).join(' | ')} | Sources |`,
    `|---|---|${LOCK_FACTS.map(() => '---').join('|')}|---|`,
    ...rows.map(r =>
      `| ${(r.chainageM / 1000).toFixed(1)} | ${r.lock.name ?? '?'} | ${LOCK_FACTS.map(f => (r.known[f] ? '✓' : '—')).join(' | ')} | ${r.sources.join(', ')} |`,
    ),
    '',
  ]
}

main().catch(e => { console.error(e); process.exit(1) })
