#!/usr/bin/env node
// Fetch every national source and write its features, in our schema, to
// .cache/waterways/normalised/{source}.json for build-national.ts.
//
//   pnpm --filter web waterways:sources [--refresh] [source…]
//
// Raw responses are cached under .cache/waterways/raw/{source}/ so a rerun
// doesn't hammer anyone (--refresh refetches; CI always starts empty).
// Parsers are pure, in @paddlesnitch/waterways/ingest/*, and tested there.
// See docs/features/waterways-uk-ireland.md.
import fs from 'fs/promises'
import path from 'path'
import { lockKey } from '@paddlesnitch/waterways/build'
import { CRT_LAYERS, crtQueryUrl, featuresFromCrt, type CrtLayer } from '@paddlesnitch/waterways/ingest/crt'
import { readZip } from '@paddlesnitch/timing/unzip'
import { readDbf } from '@paddlesnitch/waterways/ingest/dbf'
import { featuresFromScottishCanals, SCOTTISH_CANALS_LAYERS, type ScottishCanalsLayer } from '@paddlesnitch/waterways/ingest/scottish-canals'
import { crewFromGuide, guidePaths, locksFromThamesPage, THAMES_GUIDES_URL, THAMES_LOCKS_URL } from '@paddlesnitch/waterways/ingest/thames'
import { featuresFromWi, WI_LAYERS, wiQueryUrl, type WiLayer } from '@paddlesnitch/waterways/ingest/waterways-ireland'
import type { CrewDetail, Feature } from '@paddlesnitch/waterways/types'

const UA = 'paddlesnitch-river-planner/0.2 (+https://paddlesnitch.com/plan/sources)'
const args = process.argv.slice(2)
const refresh = args.includes('--refresh')
const only = args.filter(a => !a.startsWith('--'))
const CACHE = path.join(process.cwd(), '.cache/waterways')
const now = new Date().toISOString()

/** England, Wales and Scotland: CRT's waterways are all inside this. */
const GB: [number, number, number, number] = [49.8, -6.5, 56.1, 2.0]

async function cachedBytes(source: string, name: string, url: string): Promise<{ bytes: Buffer; fetchedAt: string }> {
  const file = path.join(CACHE, 'raw', source, name)
  if (!refresh) {
    try {
      const [bytes, stat] = await Promise.all([fs.readFile(file), fs.stat(file)])
      return { bytes, fetchedAt: stat.mtime.toISOString() }
    } catch { /* not cached yet */ }
  }
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, bytes)
  return { bytes, fetchedAt: now }
}

async function cached(source: string, name: string, url: string): Promise<{ body: string; fetchedAt: string }> {
  const { bytes, fetchedAt } = await cachedBytes(source, name, url)
  return { body: bytes.toString('utf8'), fetchedAt }
}

const JOBS: Record<string, () => Promise<Feature[]>> = {
  // Canal & River Trust: every layer, nationally, 2,000 records a page.
  async crt() {
    const out: Feature[] = []
    for (const layer of Object.keys(CRT_LAYERS) as CrtLayer[]) {
      for (let page = 0, offset = 0; ; page++) {
        const { body, fetchedAt } = await cached('crt', `${layer}-${page}.geojson`, crtQueryUrl(layer, GB, offset))
        const json = JSON.parse(body)
        out.push(...featuresFromCrt(layer, json.features ?? [], fetchedAt))
        if (!json.properties?.exceededTransferLimit) break
        offset += json.features.length
      }
    }
    return out
  },

  // Environment Agency, River Thames: every lock with postcode and facilities,
  // and the site guides' directions and parking on the locks they cover.
  async 'ea-thames'() {
    const locksPage = await cached('ea-thames', 'locks.json', THAMES_LOCKS_URL)
    const locks = locksFromThamesPage(JSON.parse(locksPage.body).details.body, locksPage.fetchedAt)
    const guides = await cached('ea-thames', 'guides.json', THAMES_GUIDES_URL)
    const crew: Record<string, CrewDetail> = {}
    for (const [name, guidePath] of guidePaths(JSON.parse(guides.body))) {
      const page = await cached('ea-thames', `guide-${guidePath.split('/').pop()}.json`, `https://www.gov.uk/api/content${guidePath}`)
      crew[name.toLowerCase()] = crewFromGuide(JSON.parse(page.body).details.body)
    }
    return locks.map(l => (crew[lockKey(l.name)] ? { ...l, crew: crew[lockKey(l.name)] } : l))
  },
}

JOBS['scottish-canals'] = async () => {
  const out: Feature[] = []
  for (const [layer, { url, dbf }] of Object.entries(SCOTTISH_CANALS_LAYERS) as [ScottishCanalsLayer, { url: string; dbf: string }][]) {
    const { bytes, fetchedAt } = await cachedBytes('scottish-canals', `${layer}.zip`, url)
    const entry = readZip(new Uint8Array(bytes).buffer).find(e => e.filename === dbf)
    if (!entry) throw new Error(`${dbf} missing from ${url}`)
    out.push(...featuresFromScottishCanals(layer, readDbf(new Uint8Array(entry.data)), fetchedAt))
  }
  return out
}

// Waterways Ireland: non-commercial licence, used while paddlesnitch is free.
JOBS['waterways-ireland'] = async () => {
  const out: Feature[] = []
  for (const layer of Object.keys(WI_LAYERS) as WiLayer[]) {
    for (let page = 0, offset = 0; ; page++) {
      const { body, fetchedAt } = await cached('waterways-ireland', `${layer}-${page}.geojson`, wiQueryUrl(layer, offset))
      const json = JSON.parse(body)
      out.push(...featuresFromWi(layer, json.features ?? [], fetchedAt))
      if (!json.properties?.exceededTransferLimit) break
      offset += json.features.length
    }
  }
  return out
}

async function main() {
  await fs.mkdir(path.join(CACHE, 'normalised'), { recursive: true })
  for (const [name, job] of Object.entries(JOBS)) {
    if (only.length && !only.includes(name)) continue
    const features = await job()
    await fs.writeFile(path.join(CACHE, 'normalised', `${name}.json`), JSON.stringify(features))
    const kinds = Object.entries(features.reduce<Record<string, number>>((m, f) => ({ ...m, [f.kind]: (m[f.kind] ?? 0) + 1 }), {}))
    console.log(`  ${name}: ${features.length} features (${kinds.map(([k, n]) => `${n} ${k}`).join(', ')})`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
