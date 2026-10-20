#!/usr/bin/env node
// Build the national river-planner dataset for the UK and Ireland.
//
//   pnpm --filter web waterways:national [--extract <dir>] [--publish]
//
// Reads the OSM extract written by osm_extract.py (rivers and canals, points,
// places) and every normalised source under .cache/waterways/normalised/, then
// assembles the network, features, OSM layer and places index, and runs the
// check routes. With --publish it writes a new version to storage
// (waterways/published/{version}/, .local-data in dev, S3 with DATA_BUCKET) and
// points packages/waterways/data/manifest.json at it.
// See docs/features/waterways-uk-ireland.md.
import { createHash } from 'crypto'
import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import readline from 'readline'
import { gzipSync } from 'zlib'
import { putObject } from '@paddlesnitch/core/storage'
import { featuresAlong } from '@paddlesnitch/waterways/along'
import { mergeFeatures } from '@paddlesnitch/waterways/build'
import { CHECK_ROUTES } from '@paddlesnitch/waterways/checks'
import { haversine } from '@paddlesnitch/timing/geo'
import { isOurs, linksFromWays, osmAccess, osmFacilities, osmGateLocks, osmLocks, type OsmWay } from '@paddlesnitch/waterways/ingest/osm'
import { publishedKey, type Manifest } from '@paddlesnitch/waterways/national'
import { route, snap } from '@paddlesnitch/waterways/network'
import { buildPlaces } from '@paddlesnitch/waterways/places'
import { SNAP_MAX_M } from '@paddlesnitch/waterways/plan'
import type { Feature, LatLng, NetLink, OsmElement } from '@paddlesnitch/waterways/types'

const args = process.argv.slice(2)
const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const CACHE = path.join(process.cwd(), '.cache/waterways')
const EXTRACT = arg('--extract') ?? path.join(CACHE, 'osm/gbie')
const NORMALISED = path.join(CACHE, 'normalised')
const MANIFEST = path.resolve(process.cwd(), '../../packages/waterways/data/manifest.json')

/** OSM points are kept only this close to the water; parking is everywhere. */
const OSM_NEAR_M = 400
/** An OSM lock this close to an authority's lock is the same lock. */
const GAP_LOCK_M = 120
/** An OSM slipway or put-in this close to an authority's access point is the same place. */
const GAP_ACCESS_M = 100
/** A slipway or put-in further from the water than this is on another pond or the coast. */
const ACCESS_ON_WATER_M = 60
/** A toilet or tap further than this from the water isn't one you'd paddle to. */
const FACILITY_ON_WATER_M = 100

async function* lines(file: string) {
  for await (const l of readline.createInterface({ input: fs.createReadStream(file) })) if (l) yield JSON.parse(l)
}

async function main() {
  const t0 = Date.now()
  const lap = (what: string) => console.log(`  ${what} (${((Date.now() - t0) / 1000).toFixed(1)} s)`)

  const ways: OsmWay[] = []
  for await (const w of lines(path.join(EXTRACT, 'ways.jsonl'))) if (isOurs(w)) ways.push(w)
  const links = linksFromWays(ways, 3)
  const osmLockList = osmLocks(ways, new Date().toISOString())
  ways.length = 0
  lap(`network: ${links.length} links, ${Math.round(links.reduce((n, l) => n + l.lengthM, 0) / 1000)} km`)

  const osm: OsmElement[] = []
  for await (const p of lines(path.join(EXTRACT, 'points.jsonl'))) if (snap(links, p.at, OSM_NEAR_M)) osm.push(p)
  lap(`OSM points near the water: ${osm.length}`)
  osmLockList.push(...osmGateLocks(osm, osmLockList, new Date().toISOString()))

  const all: Feature[] = []
  const sources: Record<string, number> = {}
  for (const f of await fsp.readdir(NORMALISED).catch(() => [] as string[])) {
    if (!f.endsWith('.json')) continue
    const list: Feature[] = JSON.parse(await fsp.readFile(path.join(NORMALISED, f), 'utf8'))
    const near = list.filter(x => snap(links, x.at, OSM_NEAR_M))
    all.push(...near)
    sources[f.replace(/\.json$/, '')] = near.length
  }
  // One record per lock where sources overlap (CRT and EA on the Kennet in Reading).
  const features = mergeFeatures(all)
  lap(`features: ${features.length} from ${Object.keys(sources).length} sources (${all.length - features.length} duplicate locks and weirs merged)`)

  // OSM lock chambers fill the gaps: only where no authority lists a lock
  // nearby. ODbL, so they're published in their own file (osm-features).
  const coreLocks = features.filter(f => f.kind === 'lock')
  const osmFeatures = osmLockList.filter(l => snap(links, l.at, OSM_NEAR_M) && !coreLocks.some(c => haversine(c.at, l.at) <= GAP_LOCK_M))
  lap(`OSM locks filling gaps: ${osmFeatures.length} of ${osmLockList.length}`)
  const ACCESS_KINDS = new Set(['access', 'slipway', 'portage'])
  const coreAccess = features.filter(f => ACCESS_KINDS.has(f.kind))
  const accessGrid = new Map<string, Feature[]>()
  const cellOf = (p: LatLng) => `${Math.floor(p[0] * 100)}:${Math.floor(p[1] * 60)}`   // ~1.1 km cells
  for (const f of coreAccess) { const k = cellOf(f.at); accessGrid.set(k, [...(accessGrid.get(k) ?? []), f]) }
  const nearCore = (p: LatLng) => {
    const [y, x] = cellOf(p).split(':').map(Number)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((accessGrid.get(`${y + dy}:${x + dx}`) ?? []).some(f => haversine(f.at, p) <= GAP_ACCESS_M)) return true
    }
    return false
  }
  const osmAccessList = osmAccess(osm, new Date().toISOString())
  const osmAccessFill = osmAccessList.filter(a => snap(links, a.at, ACCESS_ON_WATER_M) && !nearCore(a.at))
  osmFeatures.push(...osmAccessFill)
  lap(`OSM slipways and put-ins filling gaps: ${osmAccessFill.length} of ${osmAccessList.length}`)
  // Toilets and water where none of ours (CRT's facilities, Waterways Ireland's…) offer the same within 100 m.
  const coreFacilities = features.filter(f => f.kind === 'facility')
  const facGrid = new Map<string, Feature[]>()
  for (const f of coreFacilities) { const k = cellOf(f.at); facGrid.set(k, [...(facGrid.get(k) ?? []), f]) }
  const sameNearby = (f: Feature) => {
    const [y, x] = cellOf(f.at).split(':').map(Number)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((facGrid.get(`${y + dy}:${x + dx}`) ?? []).some(c => haversine(c.at, f.at) <= GAP_ACCESS_M && c.facilities?.some(k => f.facilities?.includes(k)))) return true
    }
    return false
  }
  const osmFacilityList = osmFacilities(osm, new Date().toISOString())
  const osmFacilityFill = osmFacilityList.filter(f => snap(links, f.at, FACILITY_ON_WATER_M) && !sameNearby(f))
  osmFeatures.push(...osmFacilityFill)
  lap(`OSM toilets and drinking water filling gaps: ${osmFacilityFill.length} of ${osmFacilityList.length}`)

  const osmPlaces: { at: LatLng; tags: Record<string, string> }[] = []
  for await (const p of lines(path.join(EXTRACT, 'places.jsonl'))) osmPlaces.push(p)
  const places = buildPlaces(osmPlaces, [...features, ...osmFeatures], links)
  lap(`places: ${places.length}`)

  const failed = checkRoutes(links, [...features, ...osmFeatures])
  lap('check routes')

  if (!args.includes('--publish')) {
    console.log(failed ? `\n${failed} check route(s) failed.` : '\nAll check routes pass. Run with --publish to publish.')
    process.exit(failed ? 1 : 0)
  }
  if (failed) throw new Error(`${failed} check route(s) failed; not publishing`)

  // Portage paths with their ends, loaded by the server as landings (osmPortages).
  const osmPortageList = osm.filter(p => p.ends && 'portage' in p.tags)
  const files = { network: links, features, 'osm-features': osmFeatures, osm, places, 'osm-portages': osmPortageList }
  const bodies = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.from(JSON.stringify(v))]))
  const hash = createHash('sha256')
  for (const b of Object.values(bodies)) hash.update(b)
  const version = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${hash.digest('hex').slice(0, 8)}`
  for (const [name, body] of Object.entries(bodies)) {
    await putObject(publishedKey(version, name), gzipSync(body))
    console.log(`  wrote ${publishedKey(version, name)} (${(body.length / 1e6).toFixed(1)} MB raw)`)
  }
  const manifest: Manifest = {
    version,
    builtAt: new Date().toISOString(),
    counts: { links: links.length, km: Math.round(links.reduce((n, l) => n + l.lengthM, 0) / 1000), features: features.length, osmLocks: osmFeatures.filter(f => f.kind === 'lock').length, osmAccess: osmAccessFill.length, osmFacilities: osmFacilityFill.length, osm: osm.length, osmPortages: osmPortageList.length, places: places.length },
    sources,
  }
  await fsp.writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`Published ${version}; manifest updated.`)
}

/** Route every check; print what was found. Returns how many failed. */
function checkRoutes(links: NetLink[], features: Feature[]): number {
  let failed = 0
  for (const c of CHECK_ROUTES) {
    const s = snap(links, c.start, SNAP_MAX_M), f = snap(links, c.finish, SNAP_MAX_M)
    const r = s && f ? route(links, s, f) : null
    const km = r ? r.lengthM / 1000 : 0
    const along = r ? featuresAlong(r.line, features) : []
    const locks = along.filter(a => a.item.kind === 'lock').length
    const weirs = along.filter(a => a.item.kind === 'weir').length
    const problems: string[] = []
    if (!r) problems.push(!s ? 'start off the water' : !f ? 'finish off the water' : 'not connected')
    if (r && c.expectKm && Math.abs(km - c.expectKm) / c.expectKm > 0.03) problems.push(`expected ${c.expectKm} km`)
    if (r && c.expectLocks !== undefined && locks !== c.expectLocks) problems.push(`expected ${c.expectLocks} locks`)
    if (problems.length) failed++
    const via = r ? [...new Set(r.legs.map(l => l.name || '(unnamed)'))].join(' > ') : ''
    console.log(`  ${problems.length ? '✗' : '✓'} ${c.name}: ${r ? `${km.toFixed(1)} km, ${locks} locks, ${weirs} weirs` : '—'}${problems.length ? `  [${problems.join('; ')}]` : ''}${via ? `\n      via ${via.length > 200 ? via.slice(0, 200) + '…' : via}` : ''}`)
  }
  return failed
}

main().catch(e => { console.error(e); process.exit(1) })
