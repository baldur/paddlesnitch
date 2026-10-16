// Assemble a region dataset from what the ingest steps fetched. Pure: the
// script in apps/web/scripts/waterways does the fetching and caching.
import { haversine } from '@paddlesnitch/timing/geo'
import { project } from './line'
import type { CrewDetail, Feature, LatLng, NetLink, OsmElement, RegionDataset } from './types'

export type RegionInput = {
  region: string
  bbox: RegionDataset['bbox']
  builtAt: string
  links: NetLink[]
  features: Feature[]
  osm: OsmElement[]
  crewByLock?: Record<string, CrewDetail>   // lock name ("Cookham") → crew detail from EA site guides
  keepWithinM?: number                     // drop points further than this from the network
}

/** Two sources mapping the same lock (CRT and EA overlap on the Kennet in
 *  Reading). Within this distance, keep the one carrying more detail. */
const SAME_LOCK_M = 60
/** The same for weirs: the barrier atlas re-publishes EA and SEPA records. */
const SAME_WEIR_M = 40

export function buildRegion(input: RegionInput): RegionDataset {
  const keepM = input.keepWithinM ?? 400
  const near = nearNetwork(input.links, keepM)

  const features = mergeFeatures(input.features.filter(f => near(f.at)), input.crewByLock)

  return {
    region: input.region,
    builtAt: input.builtAt,
    bbox: input.bbox,
    links: input.links,
    features,
    osm: input.osm.filter(o => near(o.at)),
  }
}

/** Every source's features as one list: one record per lock where sources
 *  overlap, and crew detail (from EA site guides) attached by lock name. */
export function mergeFeatures(features: Feature[], crewByLock?: Record<string, CrewDetail>): Feature[] {
  return dedupeLocks(features).map(f => {
    if (f.kind !== 'lock' || !crewByLock) return f
    const crew = crewByLock[lockKey(f.name)]
    return crew ? { ...f, crew } : f
  })
}

/** "Cookham Lock" / "Lock 63, Beech Grove Lock" → "cookham" / "beech grove". */
export function lockKey(name = ''): string {
  return name.toLowerCase().replace(/^lock \d+[a-z]?,?\s*/, '').replace(/\s*lock$/, '').trim()
}

function dedupeLocks(features: Feature[]): Feature[] {
  const lockDetail = (f: Feature) => (f.lock?.postcode ? 2 : 0) + (f.lock?.facilities ? 1 : 0)
  const weirDetail = (f: Feature) => (f.name ? 1 : 0) + (f.weir?.heightM ? 1 : 0)
  const drop = new Set([
    ...samePlace(features.filter(f => f.kind === 'lock'), SAME_LOCK_M, lockDetail),
    ...samePlace(features.filter(f => f.kind === 'weir'), SAME_WEIR_M, weirDetail),
  ])
  return features.filter(f => !drop.has(f.id))
}

/** Ids to drop where two sources map the same thing within `m`: the one with
 *  less detail. Grid-bucketed, so tens of thousands of weirs stay cheap. */
function samePlace(items: Feature[], m: number, detail: (f: Feature) => number): Set<string> {
  const cell = 0.005   // degrees, well over m
  const key = (y: number, x: number) => `${y}:${x}`
  const grid = new Map<string, Feature[]>()
  for (const f of items) {
    const k = key(Math.floor(f.at[0] / cell), Math.floor(f.at[1] / cell))
    const l = grid.get(k)
    if (l) l.push(f); else grid.set(k, [f])
  }
  const drop = new Set<string>()
  for (const a of items) {
    if (drop.has(a.id)) continue
    const y = Math.floor(a.at[0] / cell), x = Math.floor(a.at[1] / cell)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const b of grid.get(key(y + dy, x + dx)) ?? []) {
        if (a === b || a.source.source === b.source.source || drop.has(a.id) || drop.has(b.id)) continue
        if (haversine(a.at, b.at) <= m) drop.add(detail(a) >= detail(b) ? b.id : a.id)
      }
    }
  }
  return drop
}

/** A fast "is this point within m of any link" test (bbox prefilter). */
function nearNetwork(links: NetLink[], m: number): (p: LatLng) => boolean {
  const pad = m / 111_320 * 1.6   // degrees; generous for longitude at UK latitudes
  const boxes = links.map(l => {
    let s = 90, w = 180, n = -90, e = -180
    for (const [lat, lng] of l.line) { s = Math.min(s, lat); n = Math.max(n, lat); w = Math.min(w, lng); e = Math.max(e, lng) }
    return { l, s: s - pad, w: w - pad, n: n + pad, e: e + pad }
  })
  return p => boxes.some(b => p[0] >= b.s && p[0] <= b.n && p[1] >= b.w && p[1] <= b.e && project(b.l.line, p).dist <= m)
}
