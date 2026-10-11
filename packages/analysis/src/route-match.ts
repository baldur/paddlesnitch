// Which paddles are worth comparing (docs/features/buddies-and-compare.md):
// not "started near the same time or place", but how much of the same water
// both covered in the same direction, and how alike their distances are.
//
// Two stages. A cheap first filter: the 100 m squares each route passes through
// (worked out once per paddle and stored), so overlap between every paddle you
// have is a set intersection. Then, for the shortlist only, the exact shared
// same-direction stretch from line-compare. Both lines are resampled every
// 25 m first, so a 1 Hz watch and a sparse tracker compare evenly.
//
// Pure.
import type { LinePoint } from './line-compare'

export const CELL_M = 100
export const RESAMPLE_M = 25
/** Share of the smaller route's squares near the other's to make the shortlist. */
export const SHORTLIST_OVERLAP = 0.2
/** A shared stretch shorter than this isn't a useful comparison (unless you paddled together). */
export const MIN_SHARED_M = 500

const M_LAT = 110_540
// One grid for every paddle in a region: the longitude scale uses the whole
// degree of latitude, so two paddles' squares line up.
const mLng = (lat: number) => Math.cos((Math.round(lat) * Math.PI) / 180) * 111_320

/** The line again, one point every `stepM` metres along it (times interpolated). */
export function resampleLine(pts: LinePoint[], stepM = RESAMPLE_M): LinePoint[] {
  if (pts.length < 2) return pts.slice()
  const out: LinePoint[] = [pts[0]]
  let carry = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]
    const kx = mLng(a.lat)
    const d = Math.hypot((b.lat - a.lat) * M_LAT, (b.lng - a.lng) * kx)
    let at = stepM - carry
    while (at <= d) {
      const f = at / d
      out.push({ t: a.t + (b.t - a.t) * f, lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f })
      at += stepM
    }
    carry = d - (at - stepM)
  }
  const last = pts[pts.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

/** The 100 m squares the route passes through, as "x:y". */
export function routeCells(pts: { lat: number; lng: number }[]): string[] {
  if (!pts.length) return []
  const kx = mLng(pts[0].lat)
  const cells = new Set<string>()
  const line = resampleLine(pts.map((p, i) => ({ t: i, lat: p.lat, lng: p.lng })), CELL_M / 4)
  for (const p of line) cells.add(`${Math.floor((p.lng * kx) / CELL_M)}:${Math.floor((p.lat * M_LAT) / CELL_M)}`)
  return [...cells]
}

/**
 * How much of the smaller route lies in or next to the other's squares (0–1).
 * "Next to" so two lines on either side of a square's edge, or either side of
 * a river, still count.
 */
export function cellOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const [small, large] = a.length <= b.length ? [a, b] : [b, a]
  const near = new Set<string>()
  for (const c of large) {
    const [x, y] = c.split(':').map(Number)
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) near.add(`${x + dx}:${y + dy}`)
  }
  return small.filter(c => near.has(c)).length / small.length
}

export type Comparability = { kind: 'together' | 'same_route' | 'partly'; sharedM: number; score: number }

/**
 * How worth comparing a candidate is, from facts already worked out: whether
 * you paddled together, the shared same-direction stretch, and both distances.
 * Null: not worth offering.
 */
export function comparability(f: { together: boolean; sharedM: number; aKm: number; bKm: number }): Comparability | null {
  const likeness = Math.min(f.aKm, f.bKm) / Math.max(f.aKm, f.bKm, 1e-9)   // 1 = same distance
  if (f.together) return { kind: 'together', sharedM: f.sharedM, score: 1e9 + f.sharedM }
  if (f.sharedM < MIN_SHARED_M) return null
  // Most of both paddles shared: the same route; otherwise part of it.
  const sameRoute = f.sharedM >= 0.7 * Math.min(f.aKm, f.bKm) * 1000 && likeness >= 0.7
  return { kind: sameRoute ? 'same_route' : 'partly', sharedM: f.sharedM, score: f.sharedM * likeness }
}
