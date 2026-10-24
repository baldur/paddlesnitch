#!/usr/bin/env node
// Build the national river-planner dataset for the UK, Ireland, the Netherlands, Belgium, France, Germany, Austria, Switzerland, Denmark and Sweden.
//
//   pnpm --filter web waterways:national [--extract <dir>[,<dir>…]] [--publish]
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
import { getObject, putObject } from '@paddlesnitch/core/storage'
import { gunzipSync } from 'zlib'
import { reachesAhead, type OfficialTides } from '@paddlesnitch/waterways/tide'
import { NEAR_M, WATERBOARD_NEAR_M } from '@paddlesnitch/waterways/along'
import { mergeFeatures } from '@paddlesnitch/waterways/build'
import { checkRoutes } from '@paddlesnitch/waterways/checks'
import { haversine } from '@paddlesnitch/timing/geo'
import { isOurs, linksFromWays, osmAccess, osmFacilities, osmGateLocks, osmLocks, type OsmWay } from '@paddlesnitch/waterways/ingest/osm'
import { publishedKey, publishedNdjsonKey, type Manifest } from '@paddlesnitch/waterways/national'
import { toNdjson } from '@paddlesnitch/waterways/ndjson'
import { SOURCES } from '@paddlesnitch/waterways/sources'
import { snap } from '@paddlesnitch/waterways/network'
import { buildPlaces } from '@paddlesnitch/waterways/places'
import type { Feature, LatLng, NetLink, OsmElement } from '@paddlesnitch/waterways/types'

const args = process.argv.slice(2)
const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const CACHE = path.join(process.cwd(), '.cache/waterways')
/** One OSM extract per country group (osm_extract.py output): Britain and
 *  Ireland, the Netherlands. Each is read if present; elements in two (the
 *  North Sea between them) are kept once. */
const EXTRACTS = (arg('--extract')?.split(',') ?? ['gbie', 'nl', 'be', 'fr', 'de', 'at', 'ch', 'dk', 'se'].map(n => path.join(CACHE, 'osm', n))).filter(d => fs.existsSync(d))
const NORMALISED = path.join(CACHE, 'normalised')
const MANIFEST = path.resolve(process.cwd(), '../../packages/waterways/data/manifest.json')

/** OSM points are kept only this close to the water; parking is everywhere. */
const OSM_NEAR_M = 400
/** An OSM lock this close to an authority's lock is the same lock. */
const GAP_LOCK_M = 120
/** An OSM slipway or put-in this close to an authority's access point is the same place. */
const GAP_ACCESS_M = 100
/** A slipway, put-in, toilet or tap further from our water than this is on another
 *  pond, the coast or in town: the same bank-side reach as an authority's (NEAR_M). */
const ACCESS_ON_WATER_M = NEAR_M.slipway
const FACILITY_ON_WATER_M = NEAR_M.facility
/** Share-alike points (the Dutch water boards) further than this from the water aren't kept:
 *  they'd be in side ditches (WATERBOARD_NEAR_M), and there are 133,000. */
const SA_NEAR_M = WATERBOARD_NEAR_M

async function* lines(file: string) {
  for await (const l of readline.createInterface({ input: fs.createReadStream(file) })) if (l) yield JSON.parse(l)
}

async function main() {
  const t0 = Date.now()
  const lap = (what: string) => console.log(`  ${what} (${((Date.now() - t0) / 1000).toFixed(1)} s)`)

  if (!EXTRACTS.length) throw new Error('no OSM extract: run osm_extract.py first')
  const seen = new Set<string>()
  const once = (id: string | number) => (seen.has(String(id)) ? false : (seen.add(String(id)), true))
  const ways: OsmWay[] = []
  for (const dir of EXTRACTS) {
    // The Britain and Ireland extract clips in a little of the Dutch coast (isOurs).
    for await (const w of lines(path.join(dir, 'ways.jsonl'))) if ((path.basename(dir) !== 'gbie' || isOurs(w)) && once(`w${w.id}`)) ways.push(w)
  }
  const links = linksFromWays(ways, 3)
  const osmLockList = osmLocks(ways, new Date().toISOString())
  ways.length = 0
  lap(`network: ${links.length} links, ${Math.round(links.reduce((n, l) => n + l.lengthM, 0) / 1000)} km`)

  const osm: OsmElement[] = []
  for (const dir of EXTRACTS) for await (const p of lines(path.join(dir, 'points.jsonl'))) if (once(p.id) && snap(links, p.at, OSM_NEAR_M)) osm.push(p)
  lap(`OSM points near the water: ${osm.length}`)
  osmLockList.push(...osmGateLocks(osm, osmLockList, new Date().toISOString()))

  const all: Feature[] = [], shareAlike: Feature[] = []
  const sources: Record<string, number> = {}
  for (const f of await fsp.readdir(NORMALISED).catch(() => [] as string[])) {
    if (!f.endsWith('.json')) continue
    const list: Feature[] = JSON.parse(await fsp.readFile(path.join(NORMALISED, f), 'utf8'))
    const near = list.filter(x => snap(links, x.at, OSM_NEAR_M))
    // Share-alike sources (CC BY-SA) never join the core features.
    const id = f.replace(/\.json$/, '') as keyof typeof SOURCES
    ;(SOURCES[id]?.shareAlike ? shareAlike : all).push(...near)
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

  // Share-alike sources (the Dutch water boards, CC BY-SA 4.0) in their own
  // file, sa-features: a lock or weir one of ours already lists nearby is the same one.
  const nearAny = (list: Feature[], maxM: number) => {
    const grid = new Map<string, Feature[]>()
    const cell = (p: LatLng) => `${Math.floor(p[0] * 100)}:${Math.floor(p[1] * 60)}`   // ~1.1 km
    for (const f of list) { const k = cell(f.at); grid.set(k, [...(grid.get(k) ?? []), f]) }
    return (p: LatLng) => {
      const [y, x] = cell(p).split(':').map(Number)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((grid.get(`${y + dy}:${x + dx}`) ?? []).some(f => haversine(f.at, p) <= maxM)) return true
      return false
    }
  }
  const hasLock = nearAny([...coreLocks, ...osmFeatures], GAP_LOCK_M), hasWeir = nearAny(features.filter(f => f.kind === 'weir'), 40)
  // Only those on our water: most of the 133,000 are on ditches we don't route on.
  const saFeatures = mergeFeatures(shareAlike.filter(f => snap(links, f.at, SA_NEAR_M)))
    .filter(f => !(f.kind === 'lock' && hasLock(f.at)) && !(f.kind === 'weir' && hasWeir(f.at)))
  lap(`share-alike features: ${saFeatures.length} of ${shareAlike.length}`)
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
  // Canoe hire stays even beside a slipway we list: that it's there is the news.
  const osmAccessFill = osmAccessList.filter(a => snap(links, a.at, ACCESS_ON_WATER_M) && (a.hire || !nearCore(a.at)))
  osmFeatures.push(...osmAccessFill)
  lap(`OSM slipways, put-ins and canoe hire filling gaps: ${osmAccessFill.length} of ${osmAccessList.length} (${osmAccessFill.filter(a => a.hire).length} hire)`)
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
  for (const dir of EXTRACTS) for await (const p of lines(path.join(dir, 'places.jsonl'))) if (once(`p${p.id}`)) osmPlaces.push(p)
  const places = buildPlaces(osmPlaces, [...features, ...osmFeatures, ...saFeatures], links)
  lap(`places: ${places.length}`)

  const failed = checkRoutes(links, [...features, ...osmFeatures, ...saFeatures])
  lap('check routes')

  if (!args.includes('--publish')) {
    console.log(failed ? `\n${failed} check route(s) failed.` : '\nAll check routes pass. Run with --publish to publish.')
    process.exit(failed ? 1 : 0)
  }
  if (failed) throw new Error(`${failed} check route(s) failed; not publishing`)

  // Portage paths with their ends, loaded by the server as landings (osmPortages).
  const osmPortageList = osm.filter(p => p.ends && 'portage' in p.tags)
  // Rijkswaterstaat's predicted high and low waters (fetch-rws-tide-extremes.ts), when fetched.
  let tidesNl = JSON.parse(await fsp.readFile(path.join(CACHE, 'tides-nl.json'), 'utf8').catch(() => 'null')) as OfficialTides | null
  // Not fetched this week (Rijkswaterstaat slow or down): carry the live
  // version's forward while it still reaches a month ahead, rather than ship none.
  if (!tidesNl) {
    const live = (JSON.parse(await fsp.readFile(MANIFEST, 'utf8')) as Manifest).version
    const prev = live ? await getObject(publishedKey(live, 'tides-nl')).catch(() => null) : null
    const carried = prev ? JSON.parse(gunzipSync(prev).toString('utf8')) as OfficialTides : null
    if (carried && reachesAhead(carried, Date.now())) { tidesNl = carried; lap(`Dutch tide predictions carried forward from ${live}`) }
    else lap('no Dutch tide predictions this version')
  }
  const files = { network: links, features, 'osm-features': osmFeatures, 'sa-features': saFeatures, osm, places, 'osm-portages': osmPortageList, ...(tidesNl ? { 'tides-nl': tidesNl } : {}) }
  const bodies = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.from(JSON.stringify(v))]))
  const hash = createHash('sha256')
  for (const b of Object.values(bodies)) hash.update(b)
  const version = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${hash.digest('hex').slice(0, 8)}`
  for (const [name, body] of Object.entries(bodies)) {
    await putObject(publishedKey(version, name), gzipSync(body))
    console.log(`  wrote ${publishedKey(version, name)} (${(body.length / 1e6).toFixed(1)} MB raw)`)
  }
  // The network again, one link per line, which the server streams (ndjson.ts):
  // parsed as one string it peaks near 1 GB. The JSON copy stays for older code.
  await putObject(publishedNdjsonKey(version, 'network'), gzipSync(toNdjson(links)))
  console.log(`  wrote ${publishedNdjsonKey(version, 'network')}`)
  const manifest: Manifest = {
    version,
    builtAt: new Date().toISOString(),
    counts: { links: links.length, km: Math.round(links.reduce((n, l) => n + l.lengthM, 0) / 1000), features: features.length, osmLocks: osmFeatures.filter(f => f.kind === 'lock').length, osmAccess: osmAccessFill.length, osmFacilities: osmFacilityFill.length, shareAlike: saFeatures.length, osm: osm.length, osmPortages: osmPortageList.length, places: places.length },
    sources,
  }
  await fsp.writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`Published ${version}; manifest updated.`)
}

main().catch(e => { console.error(e); process.exit(1) })
