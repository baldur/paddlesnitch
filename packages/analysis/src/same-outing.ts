// The same outing recorded by two sources: the tracker and a watch on Strava,
// say (docs/features/one-paddle.md, phase 4). They stay two paddles, linked,
// with a comparison: for QA ("does the tracker agree with my watch?") and for
// anyone who carries both.
//
// Pure. Whether two paddles are one outing is `sameOuting` in
// @paddlesnitch/core/paddles (one rule for the list, the paddle page and
// Compare), read from `outingPlaces`: where the paddle was at each whole minute
// of clock time, kept in its summary. `t` = seconds from the paddle's start,
// so paddledAt + t is the clock time.
import { haversine } from '@paddlesnitch/timing/geo'
import type { AnalysisPoint } from './analysis'
import {
  isMotionOnly, sameOuting, timeOverlapShare, MIN_TIME_OVERLAP, MIN_AGREEMENT, CORRIDOR_M, PLACES_EVERY_S,
  type OutingPlaces,
} from '@paddlesnitch/core/paddles'

export { timeOverlapShare, MIN_TIME_OVERLAP, MIN_AGREEMENT, CORRIDOR_M }

type Paddle = { paddledAt: string; result: { durationS: number; points: AnalysisPoint[]; noGps?: unknown } }

const startMs = (p: { paddledAt: string }) => Date.parse(p.paddledAt)

/** Where a paddle was at clock time `ms`, between its two nearest points. */
function positionAt(p: Paddle, ms: number): { lat: number; lng: number } | null {
  const pts = p.result.points
  const t = (ms - startMs(p)) / 1000
  if (pts.length < 2 || t < pts[0].t || t > pts[pts.length - 1].t) return null
  let lo = 0, hi = pts.length - 1
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].t <= t) lo = mid; else hi = mid }
  const a = pts[lo], b = pts[hi]
  const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0
  return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f }
}

export type OutingGap = { samples: number; medianM: number; worstM: number; agreement: number }

/**
 * How far apart the two put the paddler at the same moments: one sample every
 * 10 s through the time both were recording. `worstM` is the 95th percentile
 * (one wild fix shouldn't define it).
 */
export function trackGap(a: Paddle, b: Paddle, everyS = 10): OutingGap | null {
  const from = Math.max(startMs(a), startMs(b))
  const to = Math.min(startMs(a) + a.result.durationS * 1000, startMs(b) + b.result.durationS * 1000)
  const gaps: number[] = []
  for (let ms = from; ms <= to; ms += everyS * 1000) {
    const pa = positionAt(a, ms), pb = positionAt(b, ms)
    if (pa && pb) gaps.push(haversine([pa.lat, pa.lng], [pb.lat, pb.lng]))
  }
  if (gaps.length < 3) return null
  const s = [...gaps].sort((x, y) => x - y)
  return {
    samples: gaps.length,
    medianM: Math.round(s[Math.floor(s.length / 2)]),
    worstM: Math.round(s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]),
    agreement: gaps.filter(g => g <= CORRIDOR_M).length / gaps.length,
  }
}

const round5 = (x: number) => Math.round(x * 1e5) / 1e5

/** Where the paddle was at each whole minute of clock time it recorded
 *  (`OutingPlaces`): ~2 KB for two hours, small enough for its summary. */
export function outingPlaces(p: Paddle): OutingPlaces {
  const pts = p.result.points
  if (pts.length < 2) return { from: 0, pts: [] }
  const step = PLACES_EVERY_S
  const from = Math.ceil((startMs(p) / 1000 + pts[0].t) / step) * step
  const to = Math.floor((startMs(p) / 1000 + pts[pts.length - 1].t) / step) * step
  const out: [number, number][] = []
  for (let s = from; s <= to; s += step) {
    const at = positionAt(p, s * 1000) ?? pts[s === from ? 0 : pts.length - 1]
    out.push([round5(at.lat), round5(at.lng)])
  }
  return { from, pts: out }
}

/** The one same-outing rule (`sameOuting`), for two full paddles. */
export function isSameOuting(a: Paddle, b: Paddle): boolean {
  const outing = (p: Paddle) => ({ paddledAt: p.paddledAt, durationS: p.result.durationS, noGps: p.result.noGps, places: isMotionOnly(p.result) ? undefined : outingPlaces(p) })
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
