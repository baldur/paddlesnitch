// The same outing recorded by two sources: the tracker and a watch on Strava,
// say (docs/features/one-paddle.md, phase 4). They stay two paddles, linked,
// with a comparison: for QA ("does the tracker agree with my watch?") and for
// anyone who carries both.
//
// Pure. Works from the saved paddles' own points (`t` = seconds from the
// paddle's start, so paddledAt + t is the clock time), so no stored link and
// no backfill: it's worked out when a paddle is opened.
import { haversine } from '@paddlesnitch/timing/geo'
import type { AnalysisPoint } from './analysis'

type Paddle = { paddledAt: string; result: { durationS: number; points: AnalysisPoint[] } }
type Window = { paddledAt: string; durationS: number }

// The shorter paddle must lie at least this much inside the other in time...
export const MIN_TIME_OVERLAP = 0.5
// ...and at least this share of the moments both recorded must put the two
// within CORRIDOR_M of each other (the corridor `similar.ts` uses for sections).
export const MIN_AGREEMENT = 0.7
export const CORRIDOR_M = 40

const startMs = (p: { paddledAt: string }) => Date.parse(p.paddledAt)

/** Seconds both paddles were recording, over the shorter one's duration. */
export function timeOverlapShare(a: Window, b: Window): number {
  const from = Math.max(startMs(a), startMs(b))
  const to = Math.min(startMs(a) + a.durationS * 1000, startMs(b) + b.durationS * 1000)
  const shorter = Math.min(a.durationS, b.durationS)
  return shorter > 0 ? Math.max(0, to - from) / 1000 / shorter : 0
}

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

/** Two paddles are the same outing: they overlap in time and in place. */
export function isSameOuting(a: Paddle, b: Paddle): boolean {
  if (timeOverlapShare({ paddledAt: a.paddledAt, durationS: a.result.durationS }, { paddledAt: b.paddledAt, durationS: b.result.durationS }) < MIN_TIME_OVERLAP) return false
  const g = trackGap(a, b)
  return !!g && g.agreement >= MIN_AGREEMENT
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
