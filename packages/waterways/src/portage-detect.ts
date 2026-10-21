// Portages from a paddler's own track: where a recorded paddle passes a lock,
// the slow stretch beside it is the carry, and its ends are where they got
// out and back in. Only ever a suggestion: the paddler sees it drawn and
// publishes it themselves (OpenPortage, CC0), or doesn't. Pure.
import { haversine } from '@paddlesnitch/timing/geo'
import type { Feature, LatLng } from './types'

export type TrackPoint = { t: number; lat: number; lng: number; speed: number }   // t in s, speed in m/s

export type PortageSuggestion = {
  featureId: string
  name?: string
  at: LatLng                      // the lock
  landings: [LatLng, LatLng]      // where they got out, where they got back in
  carryM: number
  minutes: number
}

/** The track must come this close to a lock to have passed it. */
export const PASS_M = 80
/** Slower than this is walking or standing, not paddling (paddling is 1.8–4 m/s). */
export const SLOW_MS = 1.3
/** A burst of speed this short inside the slow stretch (a GPS jump, a trolley run) doesn't end it. */
const GAP_S = 20
/** What a carry round one lock looks like. */
const MIN_CARRY_M = 15, MAX_CARRY_M = 500, MIN_S = 60, MAX_S = 30 * 60
/** Each landing within this of the lock. */
const LANDING_M = 300

export function portagesFromTrack(points: TrackPoint[], locks: Feature[]): PortageSuggestion[] {
  if (points.length < 3) return []
  const out: PortageSuggestion[] = []
  for (const lock of locks) {
    if (lock.kind !== 'lock' && lock.kind !== 'portage') continue
    // Closest approach.
    let near = -1, nearM = Infinity
    points.forEach((p, i) => { const d = haversine([p.lat, p.lng], lock.at); if (d < nearM) { nearM = d; near = i } })
    if (nearM > PASS_M) continue
    // The slow stretch around it, ignoring short bursts.
    const slow = (i: number) => points[i].speed < SLOW_MS
    const extend = (from: number, step: 1 | -1) => {
      let edge = from, i = from
      while (i + step >= 0 && i + step < points.length) {
        i += step
        if (slow(i)) { edge = i; continue }
        // Fast: does it go slow again within GAP_S?
        let j = i
        while (j + step >= 0 && j + step < points.length && !slow(j) && Math.abs(points[j].t - points[i].t) <= GAP_S) j += step
        if (slow(j) && Math.abs(points[j].t - points[i].t) <= GAP_S) { i = j; edge = j; continue }
        break
      }
      return edge
    }
    // Start from the slow point nearest in time to the closest approach, within a minute of it.
    const tNear = points[near].t
    let seed = -1
    points.forEach((p, i) => {
      if (slow(i) && Math.abs(p.t - tNear) <= 60 && (seed < 0 || Math.abs(p.t - tNear) < Math.abs(points[seed].t - tNear))) seed = i
    })
    if (seed < 0) continue
    const a = extend(seed, -1), b = extend(seed, 1)
    const out1: LatLng = [points[a].lat, points[a].lng], in1: LatLng = [points[b].lat, points[b].lng]
    const carryM = Math.round(haversine(out1, in1)), s = points[b].t - points[a].t
    if (carryM < MIN_CARRY_M || carryM > MAX_CARRY_M || s < MIN_S || s > MAX_S) continue
    if (haversine(out1, lock.at) > LANDING_M || haversine(in1, lock.at) > LANDING_M) continue
    // The lock lies between them along the track, not beside a stop on one side.
    if (!(a <= near && near <= b)) continue
    out.push({ featureId: lock.id, name: lock.name, at: lock.at, landings: [out1, in1], carryM, minutes: Math.round(s / 60) })
  }
  return out
}
