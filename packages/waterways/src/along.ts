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

/** Items within `near(item)` metres of the route, in travel order. */
export function along<T>(line: LatLng[], items: T[], at: (t: T) => LatLng, near: (t: T) => number): Along<T>[] {
  const cum = cumulative(line)
  const out: Along<T>[] = []
  for (const item of items) {
    const p = at(item)
    const pr = project(line, p, cum)
    if (pr.dist > near(item)) continue
    out.push({ item, chainageM: pr.along, offM: pr.dist, bank: bankOf(line, cum, pr.along, p, pr.dist) })
  }
  return out.sort((a, b) => a.chainageM - b.chainageM)
}

export const featuresAlong = (line: LatLng[], features: Feature[]) =>
  along(line, features, f => f.at, f => NEAR_M[f.kind])

export const osmAlong = (line: LatLng[], osm: OsmElement[], nearM = 250) =>
  along(line, osm, o => o.at, () => nearM)

function bankOf(line: LatLng[], cum: number[], alongM: number, p: LatLng, dist: number): 'left' | 'right' | undefined {
  if (dist < 8) return undefined   // on the water line itself (a lock, a weir)
  let i = 1
  while (i < cum.length - 1 && cum[i] < alongM) i++
  const a = line[i - 1], b = line[i]
  const kx = Math.cos((a[0] * Math.PI) / 180)
  const dx = (b[1] - a[1]) * kx, dy = b[0] - a[0]
  const px = (p[1] - a[1]) * kx, py = p[0] - a[0]
  return dx * py - dy * px > 0 ? 'left' : 'right'
}
