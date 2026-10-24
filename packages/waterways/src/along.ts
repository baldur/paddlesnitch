// What's along a route: every feature near enough to the water we travel,
// ordered by distance from the start, with the bank it's on in the direction
// of travel. Recomputed per route, so reversing a route flips the banks.
import { cumulative, project } from './line'
import type { Feature, FeatureKind, LatLng, OsmElement } from './types'

/** How far from the route line a feature may sit and still count as "on" it.
 *  Locks and weirs sit on side channels (lock cuts, weir streams) the
 *  centreline may not follow, so they get the widest net. */
export const NEAR_M: Record<FeatureKind, number> = {
  lock: 250,
  weir: 250,
  portage: 250,
  access: 120,
  slipway: 120,
  facility: 120,
  crew_point: 400,
  hazard: 150,
}

export type Along<T> = {
  item: T
  chainageM: number         // metres from the start of the route
  offM: number              // metres from the route line
  bank?: 'left' | 'right'   // looking in the direction of travel; unset when on the line
}

/** Items within `near(item)` metres of the route, in travel order. Only items
 *  in grid cells the route passes near are measured, so a national feature
 *  list costs no more than a regional one. `near` must not exceed PAD_M. */
export function along<T extends object>(line: LatLng[], items: T[], at: (t: T) => LatLng, near: (t: T) => number): Along<T>[] {
  const cum = cumulative(line)
  const out: Along<T>[] = []
  for (const item of candidates(line, items, at)) {
    const p = at(item)
    const pr = project(line, p, cum)
    if (pr.dist > near(item)) continue
    out.push({ item, chainageM: pr.along, offM: pr.dist, bank: bankOf(line, cum, pr.along, p, pr.dist) })
  }
  return out.sort((a, b) => a.chainageM - b.chainageM)
}

const CELL = 0.01            // degrees
const PAD_M = 500            // more than any NEAR_M
const grids = new WeakMap<object[], Map<string, object[]>>()

function candidates<T extends object>(line: LatLng[], items: T[], at: (t: T) => LatLng): T[] {
  let grid = grids.get(items) as Map<string, T[]> | undefined
  if (!grid) {
    grid = new Map()
    for (const item of items) {
      const [lat, lng] = at(item)
      const k = `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`
      const l = grid.get(k)
      if (l) l.push(item); else grid.set(k, [item])
    }
    grids.set(items, grid)
  }
  const keys = new Set<string>()
  const padLat = PAD_M / 111_320
  const mark = (lat: number, lng: number) => {
    const padLng = padLat / Math.cos((lat * Math.PI) / 180)
    for (let y = Math.floor((lat - padLat) / CELL); y <= Math.floor((lat + padLat) / CELL); y++)
      for (let x = Math.floor((lng - padLng) / CELL); x <= Math.floor((lng + padLng) / CELL); x++) keys.add(`${y}:${x}`)
  }
  for (let i = 0; i < line.length; i++) {
    const a = line[i - 1], b = line[i]
    mark(b[0], b[1])
    if (!a) continue
    // Vertices can be further apart than a cell; mark the gaps too.
    const steps = Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / CELL)
    for (let k = 1; k < steps; k++) mark(a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps)
  }
  const out: T[] = []
  for (const k of keys) for (const item of grid.get(k) ?? []) out.push(item)
  return out
}

/** Some sources put a point on the watercourse itself: OSM lock chambers and
 *  the barrier inventories. One of those off the route by more than this is
 *  on a side cut, a brook or a marina entrance, not on the way. The navigation
 *  authorities put locks and weirs beside the channel, hence NEAR_M's wider net. */
export const ON_WATER_NEAR_M = 60
const ON_WATER_SOURCES = new Set(['osm', 'amber', 'sepa', 'ea-aims', 'ifi', 'amber-eu', 'roe'])

/** Things in the water itself. Slipways, put-ins and toilets stand on the bank,
 *  which on a wide river or estuary is well over 60 m from the line. */
const IN_WATER = new Set<Feature['kind']>(['lock', 'weir', 'hazard', 'portage'])

/** The Dutch water boards' structures stand in polder water: one more than this
 *  from the route is in a side ditch (a dam at its mouth, a pumping station's
 *  outfall), not on the way. Their own locks sit within 5 m of the network. */
export const WATERBOARD_NEAR_M = 10

/** How far from the water a feature may sit and still be on it. */
export const nearOf = (f: Feature) => (f.source.source === 'nl-waterboards' ? WATERBOARD_NEAR_M
  : ON_WATER_SOURCES.has(f.source.source) && IN_WATER.has(f.kind) ? Math.min(ON_WATER_NEAR_M, NEAR_M[f.kind]) : NEAR_M[f.kind])

export const featuresAlong = (line: LatLng[], features: Feature[]) => along(line, features, f => f.at, nearOf)

export const osmAlong = (line: LatLng[], osm: OsmElement[], nearM = 250) =>
  along(line, osm, o => o.at, () => nearM)

function bankOf(line: LatLng[], cum: number[], alongM: number, p: LatLng, dist: number): 'left' | 'right' | undefined {
  if (dist < 8) return undefined   // on the water line itself (a lock, a weir)
  return sideOf(line, cum, alongM, p)
}

/** Which side of the line `p` is on, looking along it at `alongM`. */
export function sideOf(line: LatLng[], cum: number[], alongM: number, p: LatLng): 'left' | 'right' {
  let i = 1
  while (i < cum.length - 1 && cum[i] < alongM) i++
  const a = line[i - 1], b = line[i]
  const kx = Math.cos((a[0] * Math.PI) / 180)
  const dx = (b[1] - a[1]) * kx, dy = b[0] - a[0]
  const px = (p[1] - a[1]) * kx, py = p[0] - a[0]
  return dx * py - dy * px > 0 ? 'left' : 'right'
}
