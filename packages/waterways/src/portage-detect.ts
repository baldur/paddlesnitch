// Portages from a paddler's own track: where a recorded paddle passes a lock,
// the slow stretch beside it is the carry, and its ends are where they got
// out and back in. A carry that's run looks different: a stop either side of a
// short fast stretch past the lock. Only ever a suggestion: the paddler sees it drawn and
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
  t: number                       // when they got out, on the track's clock
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
/** Stopped at the bank: getting out or back in. */
const STOPPED_MS = 0.8
/** A run past a lock has a stop this close before it and after it. */
const STOP_WITHIN_S = 180
/** Slow this long either side of the lock is walking, not a run past it. */
const WALKED_S = 15
/** Paddling, not jogging or a rest: at least this fast for this long. Low enough
 *  for an unhurried paddler, long enough that a jog along the bank doesn't count. */
const PADDLING_MS = 1.2, PADDLING_S = 40
/** Points this close together are dense enough that one stopped point alone is a bad GPS speed. */
const DENSE_S = 3

/** Stopped, a short run past the lock, stopped: a carry done at a jog, too fast
 *  to look slow. Measured on the Kennet: 2.0–2.6 m/s on the bank, 2.7–3.1 paddling.
 *  Paddling through between two rests looks the same; a person checks every suggestion. */
function stopRunStop(points: TrackPoint[], near: number): [number, number] | null {
  // Slow all around the lock is a walked carry: slowStretch finds its ends.
  if (points.every(p => Math.abs(p.t - points[near].t) > WALKED_S || p.speed < SLOW_MS)) return null
  const stopped = (i: number) => {
    if (points[i].speed >= STOPPED_MS) return false
    const close = [points[i - 1], points[i + 1]].filter(q => q && Math.abs(q.t - points[i].t) <= DENSE_S)
    return !close.length || close.some(q => q.speed < STOPPED_MS)
  }
  const tNear = points[near].t
  let a = -1, b = -1
  for (let i = near; i >= 0 && tNear - points[i].t <= STOP_WITHIN_S; i--) if (stopped(i)) { a = i; break }
  for (let i = near; i < points.length && points[i].t - tNear <= STOP_WITHIN_S; i++) if (stopped(i)) { b = i; break }
  if (a < 0 || b < 0) return null
  const paddlingFrom = (i: number) => {
    let last = i
    for (let j = i; j < points.length && points[j].t - points[i].t <= PADDLING_S; j++) {
      if (points[j].speed < PADDLING_MS) return false
      last = j
    }
    return points[last].t - points[i].t >= PADDLING_S * 0.75
  }
  // A carry can pause after the lock: the put-in is the last stop before paddling
  // again. The take-out is the nearest stop before it: on the Kennet, an outer
  // "stop" before the lock was a brief slowing under a road bridge.
  let end = b
  for (let i = b + 1; i < points.length && points[i].t - points[b].t <= STOP_WITHIN_S; i++) {
    if (stopped(i)) end = i
    else if (paddlingFrom(i)) break
  }
  return [a, end]
}

export function portagesFromTrack(points: TrackPoint[], locks: Feature[]): PortageSuggestion[] {
  if (points.length < 3) return []
  const out: PortageSuggestion[] = []
  for (const lock of locks) {
    if (lock.kind !== 'lock' && lock.kind !== 'portage') continue
    // Closest approach.
    let near = -1, nearM = Infinity
    points.forEach((p, i) => { const d = haversine([p.lat, p.lng], lock.at); if (d < nearM) { nearM = d; near = i } })
    if (nearM > PASS_M) continue
    const ends = [stopRunStop(points, near), slowStretch(points, near)].find((e): e is [number, number] => {
      if (!e) return false
      const [a, b] = e, out1: LatLng = [points[a].lat, points[a].lng], in1: LatLng = [points[b].lat, points[b].lng]
      const carryM = haversine(out1, in1), s = points[b].t - points[a].t
      return carryM >= MIN_CARRY_M && carryM <= MAX_CARRY_M && s >= MIN_S && s <= MAX_S
        && haversine(out1, lock.at) <= LANDING_M && haversine(in1, lock.at) <= LANDING_M
        // The lock lies between them along the track, not beside a stop on one side.
        && a <= near && near <= b
    })
    if (!ends) continue
    const [a, b] = ends
    const out1: LatLng = [points[a].lat, points[a].lng], in1: LatLng = [points[b].lat, points[b].lng]
    const carryM = Math.round(haversine(out1, in1)), s = points[b].t - points[a].t
    out.push({ featureId: lock.id, name: lock.name, at: lock.at, landings: [out1, in1], carryM, minutes: Math.round(s / 60), t: points[a].t })
  }
  return out
}

/** The walked carry: the slow stretch around the closest approach, ignoring short bursts. */
function slowStretch(points: TrackPoint[], near: number): [number, number] | null {
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
  return seed < 0 ? null : [extend(seed, -1), extend(seed, 1)]
}
