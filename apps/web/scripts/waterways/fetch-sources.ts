#!/usr/bin/env node
// Fetch every national source and write its features, in our schema, to
// .cache/waterways/normalised/{source}.json for build-national.ts.
//
//   pnpm --filter web waterways:sources [--refresh] [--stage] [source…]
//
// Raw responses are cached under .cache/waterways/raw/{source}/ so a rerun
// doesn't hammer anyone (--refresh refetches; CI always starts empty).
// With --stage (the weekly refresh), each good copy is also kept in storage,
// and a source that fails or shrinks falls back to its last good copy rather
// than dropping out; .cache/waterways/health.json and waterways/health.json
// record which (@paddlesnitch/waterways/health).
// Parsers are pure, in @paddlesnitch/waterways/ingest/*, and tested there.
// See docs/features/waterways-uk-ireland.md.
import fs from 'fs/promises'
import path from 'path'
import { gunzipSync, gzipSync } from 'zlib'
import { getObject, putObject } from '@paddlesnitch/core/storage'
import { assess, HEALTH_KEY, healthLines, stagedKey, type HealthFile } from '@paddlesnitch/waterways/health'
import { lockKey } from '@paddlesnitch/waterways/build'
import { CRT_LAYERS, crtQueryUrl, featuresFromCrt, type CrtLayer } from '@paddlesnitch/waterways/ingest/crt'
import { readZip } from '@paddlesnitch/timing/unzip'
import { AMBER_GB, arcgisPageUrl, featuresFromAmber, featuresFromSepa, SEPA_OBSTACLES } from '@paddlesnitch/waterways/ingest/barriers'
import { readDbf } from '@paddlesnitch/waterways/ingest/dbf'
import { AIMS_FILES, AIMS_URL, featuresFromAims } from '@paddlesnitch/waterways/ingest/ea-aims'
import { EA_UMAPS, featuresFromUmap, umapLayerIds, umapLayerUrl, umapUrl, type EaUmap } from '@paddlesnitch/waterways/ingest/ea-umap'
import { featuresFromScottishCanals, SCOTTISH_CANALS_LAYERS, type ScottishCanalsLayer } from '@paddlesnitch/waterways/ingest/scottish-canals'
import { crewFromGuide, guidePaths, locksFromThamesPage, THAMES_GUIDES_URL, THAMES_LOCKS_URL } from '@paddlesnitch/waterways/ingest/thames'
import { featuresFromWi, WI_LAYERS, wiQueryUrl, type WiLayer } from '@paddlesnitch/waterways/ingest/waterways-ireland'
import type { CrewDetail, Feature } from '@paddlesnitch/waterways/types'

const UA = 'paddlesnitch-river-planner/0.2 (+https://paddlesnitch.com/plan/sources)'
const args = process.argv.slice(2)
const refresh = args.includes('--refresh')
const stage = args.includes('--stage')
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

// EA asset register: every EA weir and slipway in England (OGL).
JOBS['ea-aims'] = async () => {
  const { bytes, fetchedAt } = await cachedBytes('ea-aims', 'structure.zip', AIMS_URL)
  const files = readZip(new Uint8Array(bytes).buffer, { maxEntryBytes: 200 * 1024 * 1024, maxTotalBytes: 400 * 1024 * 1024 })
  const out: Feature[] = []
  for (const name of Object.values(AIMS_FILES)) {
    const entry = files.find(e => e.filename.endsWith(name))
    if (!entry) throw new Error(`${name} missing from the AIMS download`)
    out.push(...featuresFromAims(JSON.parse(Buffer.from(entry.data).toString('utf8')).features, fetchedAt))
  }
  return out
}

// EA uMap maps: Nene locks and facilities, and the Anglian rivers' current notices.
JOBS['ea-umap'] = async () => {
  const out: Feature[] = []
  for (const [map, id] of Object.entries(EA_UMAPS) as [EaUmap, number][]) {
    const { body, fetchedAt } = await cached('ea-umap', `${id}.json`, umapUrl(id))
    const layers = []
    for (const layer of umapLayerIds(JSON.parse(body))) {
      layers.push(JSON.parse((await cached('ea-umap', `${id}-${layer}.json`, umapLayerUrl(id, layer))).body))
    }
    out.push(...featuresFromUmap(map, layers, fetchedAt))
  }
  return out
}

/** Every page of an ArcGIS layer (2,000 records a page). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- GeoJSON straight from the service; each parser checks its fields
async function arcgisAll(source: string, layer: string): Promise<{ features: any[]; fetchedAt: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const features: any[] = []
  let fetchedAt = now
  for (let page = 0, offset = 0; ; page++) {
    const res = await cached(source, `page-${page}.geojson`, arcgisPageUrl(layer, offset))
    const json = JSON.parse(res.body)
    features.push(...(json.features ?? []))
    fetchedAt = res.fetchedAt
    if (!json.properties?.exceededTransferLimit && (json.features?.length ?? 0) < 2000) break
    if (!json.features?.length) break
    offset += json.features.length
  }
  return { features, fetchedAt }
}

// SEPA: Scotland's weirs, dams and sluices, and natural waterfalls (OGL).
JOBS.sepa = async () => {
  const { features, fetchedAt } = await arcgisAll('sepa', SEPA_OBSTACLES)
  return featuresFromSepa(features, fetchedAt)
}

// AMBER-GB barrier atlas: weirs, sluices and dams across Great Britain, with heights (CC BY 4.0).
JOBS.amber = async () => {
  const { features, fetchedAt } = await arcgisAll('amber', AMBER_GB)
  return featuresFromAmber(features, fetchedAt)
}

async function main() {
  await fs.mkdir(path.join(CACHE, 'normalised'), { recursive: true })
  // The waterways role can't list the bucket, so a key that isn't there yet
  // (the first run) reads as access denied rather than not found: treat any
  // read error as "nothing staged".
  const prev = stage ? JSON.parse((await getObject(HEALTH_KEY).catch(() => null))?.toString() ?? 'null') as HealthFile | null : null
  const health: HealthFile = { checkedAt: now, sources: { ...prev?.sources } }
  for (const [name, job] of Object.entries(JOBS)) {
    if (only.length && !only.includes(name)) continue
    const out = path.join(CACHE, 'normalised', `${name}.json`)
    if (!stage) {
      const features = await job()
      await fs.writeFile(out, JSON.stringify(features))
      const kinds = Object.entries(features.reduce<Record<string, number>>((m, f) => ({ ...m, [f.kind]: (m[f.kind] ?? 0) + 1 }), {}))
      console.log(`  ${name}: ${features.length} features (${kinds.map(([k, n]) => `${n} ${k}`).join(', ')})`)
      continue
    }
    let features: Feature[] | undefined, error: string | undefined
    try { features = await job() } catch (e) { error = (e as Error).message.slice(0, 300) }
    const staged = await getObject(stagedKey(name)).then(b => b && gunzipSync(b).toString()).catch(() => null)
    const stagedCount = staged ? (JSON.parse(staged) as Feature[]).length : null
    const { use, health: h } = assess(features ? { features: features.length } : { error: error! }, prev?.sources[name], stagedCount, now)
    health.sources[name] = h
    if (use === 'fresh') {
      const body = JSON.stringify(features)
      await fs.writeFile(out, body)
      await putObject(stagedKey(name), gzipSync(body))
    } else if (use === 'staged') {
      await fs.writeFile(out, staged!)
    }
    console.log(`  ${healthLines({ checkedAt: now, sources: { [name]: h } })[0]}`)
  }
  if (stage) {
    const body = JSON.stringify(health, null, 2)
    await fs.writeFile(path.join(CACHE, 'health.json'), body)
    await putObject(HEALTH_KEY, body)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
