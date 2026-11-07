// The same outing recorded by two sources: the tracker and a watch on Strava,
// say (docs/features/one-paddle.md, phase 4). They stay two paddles, linked,
// with a comparison: for QA ("does the tracker agree with my watch?") and for
// anyone who carries both.
//
// Pure. Whether two paddles are one outing is `sameOuting` in
// @paddlesnitch/core/paddles (one rule for the list, the paddle page and
// Compare), read from `outingPlaces`: where the paddle was every 20 s of clock
// time, kept in its summary. `t` = seconds from the paddle's start, so
// paddledAt + t is the clock time.
import type { AnalysisPoint } from './analysis'
import {
  isMotionOnly, sameOuting, placesGap, encodePlaces, timeOverlapShare,
  MIN_TIME_OVERLAP, MIN_AGREEMENT, CORRIDOR_M, PLACES_EVERY_S, MAX_GAP_S,
  type OutingPlaces, type OutingGap,
} from '@paddlesnitch/core/paddles'

export { timeOverlapShare, MIN_TIME_OVERLAP, MIN_AGREEMENT, CORRIDOR_M }
export type { OutingGap }

type Paddle = { paddledAt: string; result: { durationS: number; points: AnalysisPoint[]; noGps?: unknown } }

const startMs = (p: { paddledAt: string }) => Date.parse(p.paddledAt)

/**
 * Where the paddle was at each instant of clock time (UTC) that is a multiple
 * of PLACES_EVERY_S, between its two nearest points: kept in its summary for
 * the same-outing rule. None at an instant whose two points are more than
 * MAX_GAP_S apart (a straight line across a gap can cut a bend).
 */
export function outingPlaces(p: Paddle): OutingPlaces {
  const pts = p.result.points
  const step = PLACES_EVERY_S
  if (pts.length < 2) return encodePlaces(0, step, [])
  const t0 = startMs(p) / 1000
  const from = Math.ceil((t0 + pts[0].t) / step) * step
  const to = Math.floor((t0 + pts[pts.length - 1].t) / step) * step
  const out: ([number, number] | null)[] = []
  let hi = 1
  for (let s = from; s <= to; s += step) {
    const t = s - t0
    while (hi < pts.length - 1 && pts[hi].t < t) hi++
    const a = pts[hi - 1], b = pts[hi]
    if (b.t === t) { out.push([b.lat, b.lng]); continue }
    if (b.t - a.t > MAX_GAP_S) { out.push(null); continue }
    const f = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0
    out.push([a.lat + (b.lat - a.lat) * f, a.lng + (b.lng - a.lng) * f])
  }
  return encodePlaces(from, step, out)
}

const outing = (p: Paddle) => ({ paddledAt: p.paddledAt, durationS: p.result.durationS, noGps: p.result.noGps, places: isMotionOnly(p.result) ? undefined : outingPlaces(p) })

/**
 * How far apart the two put the paddler at the same instants: the very
 * samples the rule judges by (`placesGap`), so Compare's numbers and its
 * "same outing" always agree.
 */
export function trackGap(a: Paddle, b: Paddle): OutingGap | null {
  return placesGap(outingPlaces(a), outingPlaces(b))
}

/** The one same-outing rule (`sameOuting`), for two full paddles. */
export function isSameOuting(a: Paddle, b: Paddle): boolean {
  return sameOuting(outing(a), outing(b))
}

/** Stroke rate from each, per minute of clock time where both have it. */
export function strokeRateSideBySide(a: Paddle, b: Paddle, binS = 60): { minute: number; a: number; b: number }[] {
  const bin = (p: Paddle) => {
    const m = new Map<number, number[]>()
    for (const pt of p.result.points) {
      if (pt.sr == null) continue
      const k = Math.floor((startMs(p) + pt.t * 1000) / (binS * 1000))
      m.set(k, [...(m.get(k) ?? []), pt.sr])
    }
    return m
  }
  const ma = bin(a), mb = bin(b)
  const first = Math.min(...[...ma.keys(), ...mb.keys()])
  const mean = (xs: number[]) => Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10
  return [...ma.keys()].filter(k => mb.has(k)).sort((x, y) => x - y)
    .map(k => ({ minute: k - first, a: mean(ma.get(k)!), b: mean(mb.get(k)!) }))
}
