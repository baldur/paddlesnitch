// Two paddles over the same water: where their lines differ, and who gained
// where (docs/features/buddies-and-compare.md, phase 1). Works for any two
// paddles at the same place, not only the same outing: A's line is the
// reference, and B's points are matched to it in order, so an out-and-back
// route, where the way back runs beside the way out, can't be matched to the
// wrong leg.
//
// Pure: works from the saved paddles' map points (t = seconds from the
// paddle's start). Distances are along A's line ("1.2 km in").

import { haversine } from '@paddlesnitch/timing/geo'
import type { AnalysisPoint } from './analysis'
import { gateAt, pointsToTrack, raceTrack } from './similar'

export type LinePoint = { t: number; lat: number; lng: number }

/** Slower than this between two points is standing still (a rest, waiting at
 *  the start): it doesn't count. The comparison is on MOVING time: on a real
 *  pair of paddles, 22 minutes waiting near the start read as "slower there". */
export const MOVING_MPS = 0.5
/** A gap in the points longer than this isn't counted as moving either. */
const MAX_STEP_S = 30

/** B further than this from A's line isn't on the same route there. */
export const CORRIDOR_M = 60
/** The comparison is reported in steps of this much of A's line. */
export const BIN_M = 50
/** B off A's route for more points than this, or more metres of its own, ends the pass. */
const MAX_SKIP_POINTS = 5
const MAX_SKIP_M = 150
/** A shared stretch shorter than this isn't worth comparing. */
export const MIN_SHARED_M = 200

type XY = { x: number; y: number }

export type LineBin = {
  fromM: number; toM: number
  gapM: number                // how far B's line was from A's (median)
  side: -1 | 0 | 1            // B to the left (-1) or right (1) of A, going A's way; 0 = together
  aSecs: number; bSecs: number
  aMetres: number; bMetres: number   // distance each actually covered here
}

export type LineCompare = {
  overlapShare: number        // share of B's points on A's route
  fromM: number; toM: number  // the shared stretch, along A's line
  bins: LineBin[]
  total: { aSecs: number; bSecs: number; aMetres: number; bMetres: number }
  // B's time minus A's at each bin end, from the start of the shared stretch:
  // negative = B ahead.
  ahead: { atM: number; secs: number }[]
  // A's line with its distance along it, to place things on the map.
  ref: { atM: number; lat: number; lng: number; t: number }[]
  // Moving-clock offsets so a replay starts both boats at the shared stretch.
  aStartT: number; bStartT: number
}

function projector(lat0: number, lng0: number) {
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111_320, ky = 110_540
  return (lat: number, lng: number): XY => ({ x: (lng - lng0) * kx, y: (lat - lat0) * ky })
}
const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y)

/** The nearest point on segment a→b to p: how far along (0..1), how far off, which side. */
function toSegment(p: XY, a: XY, b: XY) {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy
  const u = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0
  const q = { x: a.x + u * dx, y: a.y + u * dy }
  const cross = dx * (p.y - a.y) - dy * (p.x - a.x)   // > 0: p is left of a→b
  return { u, off: dist(p, q), side: cross > 0 ? -1 : cross < 0 ? 1 : 0 }
}

// Interpolate y over increasing xs.
function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0]
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1]
  let lo = 0, hi = xs.length - 1
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid }
  const f = xs[hi] > xs[lo] ? (x - xs[lo]) / (xs[hi] - xs[lo]) : 0
  return ys[lo] + (ys[hi] - ys[lo]) * f
}

/** Seconds spent moving, cumulative, at each point. */
export function movingClock(pts: LinePoint[]): number[] {
  const out = [0]
  for (let i = 1; i < pts.length; i++) {
    const dt = pts[i].t - pts[i - 1].t
    const d = Math.hypot((pts[i].lat - pts[i - 1].lat) * 110_540, (pts[i].lng - pts[i - 1].lng) * Math.cos(pts[i].lat * Math.PI / 180) * 111_320)
    out.push(out[i - 1] + (dt > 0 && dt <= MAX_STEP_S && d / dt >= MOVING_MPS ? dt : 0))
  }
  return out
}

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0 }

export function compareLines(a: LinePoint[], b: LinePoint[]): LineCompare | null {
  if (a.length < 2 || b.length < 2) return null
  const proj = projector(a[0].lat, a[0].lng)
  const A = a.map(p => proj(p.lat, p.lng)), B = b.map(p => proj(p.lat, p.lng))
  const sA: number[] = [0]
  for (let i = 1; i < A.length; i++) sA.push(sA[i - 1] + dist(A[i - 1], A[i]))

  // Match B to A's line, in order. Each B point could sit at several places on
  // A's line (an out-and-back's two legs run side by side; a club outing starts
  // and ends at the same spot), so take every place it's close to, then choose
  // the longest chain of believable steps through them (below). A greedy
  // "nearest first" match picked the wrong end on a real club outing and
  // matched nothing after.
  type Cand = { j: number; s: number; off: number; side: number }
  const cands: Cand[] = []
  for (let j = 0; j < B.length; j++) {
    // Every place A's line comes closest to B[j] (each local minimum of the
    // distance, within the corridor) is a candidate. Merging nearby ones lost
    // the right leg at a turn, where both legs are within the corridor.
    const here: Cand[] = []
    const fit = A.slice(0, -1).map((_, i) => toSegment(B[j], A[i], A[i + 1]))
    for (let i = 0; i < fit.length; i++) {
      const r = fit[i]
      if (r.off > CORRIDOR_M) continue
      if (i > 0 && fit[i - 1].off < r.off) continue
      if (i < fit.length - 1 && fit[i + 1].off <= r.off) continue
      here.push({ j, s: sA[i] + r.u * (sA[i + 1] - sA[i]), off: r.off, side: r.side })
    }
    cands.push(...here)
  }
  // The longest pass: a chain of candidates, one per B point, where each step
  // is a believable move: within a few of B's points, never backwards along A
  // (beyond a resting boat's jitter), and not further along A than B itself
  // moved (an out-and-back's legs lie side by side: jumping legs would be km
  // along A for metres of B, which made a real pair 8 m/s). Longest path in a
  // small graph: each candidate looks back at the last few points' candidates.
  const bCum: number[] = [0]
  for (let j = 1; j < B.length; j++) bCum.push(bCum[j - 1] + dist(B[j - 1], B[j]))
  const byJ = new Map<number, number[]>()
  cands.forEach((c, k) => { const l = byJ.get(c.j); if (l) l.push(k); else byJ.set(c.j, [k]) })
  const best: number[] = new Array(cands.length).fill(1), from: number[] = new Array(cands.length).fill(-1)
  // The furthest along A each chain has got: jitter is allowed against that,
  // not against the last step, or a boat going back down 4 m a point passes.
  const reach: number[] = cands.map(c => c.s)
  for (let k = 0; k < cands.length; k++) {
    const c = cands[k]
    for (let pj = c.j - 1; pj >= c.j - 1 - MAX_SKIP_POINTS && pj >= 0; pj--) {
      for (const q of byJ.get(pj) ?? []) {
        const p = cands[q], own = bCum[c.j] - bCum[p.j]
        if (c.s < reach[q] - 20 || c.s - reach[q] > own + MAX_SKIP_M || own > MAX_SKIP_M) continue
        if (best[q] + 1 > best[k]) { best[k] = best[q] + 1; from[k] = q; reach[k] = Math.max(reach[q], c.s) }
      }
    }
  }
  let end = -1
  for (let k = 0; k < cands.length; k++) if (end < 0 || best[k] > best[end]) end = k
  const matched: Cand[] = []
  for (let k = end; k >= 0; k = from[k]) matched.push(cands[k])
  matched.reverse()
  if (matched.length < 2) return null
  const overlapShare = matched.length / B.length
  // Along A's line, B only moves forward (small GPS jitter backwards is held).
  const sB: number[] = []
  for (const m of matched) sB.push(Math.max(sB.length ? sB[sB.length - 1] : -Infinity, m.s))
  const fromM = sB[0], toM = sB[sB.length - 1]
  if (toM - fromM < MIN_SHARED_M) return null

  // Times each boat passes a point along A's line, on each one's moving clock.
  const clockA = movingClock(a), clockB = movingClock(b)
  const tA = (s: number) => interp(sA, clockA, s)
  const bS: number[] = [], bT: number[] = []
  for (let k = 0; k < matched.length; k++) {
    if (k > 0 && sB[k] <= bS[bS.length - 1]) continue
    bS.push(sB[k]); bT.push(clockB[matched[k].j])
  }
  const tB = (s: number) => interp(bS, bT, s)
  // B's own distance covered up to each matched point.
  const bOwn: number[] = [0]
  for (let k = 1; k < matched.length; k++) bOwn.push(bOwn[k - 1] + dist(B[matched[k - 1].j], B[matched[k].j]))
  const bOwnAt = (s: number) => interp(sB, bOwn, s)

  const bins: LineBin[] = []
  const ahead: { atM: number; secs: number }[] = []
  const a0 = tA(fromM), b0 = tB(fromM)
  for (let s0 = fromM; s0 < toM - 1; s0 += BIN_M) {
    const s1 = Math.min(toM, s0 + BIN_M)
    const inBin = matched.filter((_, k) => sB[k] >= s0 && sB[k] < s1)
    const gapM = median(inBin.map(m => m.off))
    const sides = inBin.filter(m => m.off >= 5).map(m => m.side)
    const lean = sides.reduce((x, y) => x + y, 0)
    bins.push({
      fromM: s0, toM: s1, gapM,
      side: gapM < 5 || !sides.length ? 0 : lean > 0 ? 1 : lean < 0 ? -1 : 0,
      aSecs: tA(s1) - tA(s0), bSecs: tB(s1) - tB(s0),
      aMetres: s1 - s0, bMetres: bOwnAt(s1) - bOwnAt(s0),
    })
    ahead.push({ atM: s1, secs: (tB(s1) - b0) - (tA(s1) - a0) })
  }
  const total = bins.reduce((t, x) => ({ aSecs: t.aSecs + x.aSecs, bSecs: t.bSecs + x.bSecs, aMetres: t.aMetres + x.aMetres, bMetres: t.bMetres + x.bMetres }),
    { aSecs: 0, bSecs: 0, aMetres: 0, bMetres: 0 })
  return {
    overlapShare, fromM, toM, bins, total, ahead,
    ref: a.map((p, i) => ({ atM: sA[i], lat: p.lat, lng: p.lng, t: p.t })),
    aStartT: a0, bStartT: b0,
  }
}

const km = (m: number) => `${(m / 1000).toFixed(1)} km`

/**
 * The comparison in a few plain sentences: the result over the shared
 * stretch, where the lines differed most, and where each gained most.
 * Grounded in the numbers only; it never says why.
 */
export function lineSummary(c: LineCompare, aName = 'A', bName = 'B'): string[] {
  const out: string[] = []
  const d = c.total.bSecs - c.total.aSecs
  out.push(Math.abs(d) < 2
    ? `Over the shared ${km(c.toM - c.fromM)}, the two took the same time.`
    : `Over the shared ${km(c.toM - c.fromM)}, ${d < 0 ? bName : aName} was ${Math.round(Math.abs(d))} s faster.`)
  // The lines: the widest stretch apart (at least 10 m).
  const wide = [...c.bins].filter(x => x.gapM >= 10).sort((x, y) => y.gapM - x.gapM)[0]
  if (wide) {
    const shorter = wide.bMetres - wide.aMetres
    const side = wide.side === 1 ? 'right' : wide.side === -1 ? 'left' : 'off'
    out.push(`The lines were furthest apart at ${km(wide.fromM)}: ${bName} was ${Math.round(wide.gapM)} m to the ${side} of ${aName}` +
      (Math.abs(shorter) >= 3 ? `, and covered ${Math.round(Math.abs(shorter))} m ${shorter < 0 ? 'less' : 'more'} there.` : '.'))
  } else {
    out.push(`The two lines stayed within 10 m of each other.`)
  }
  // Gains over 150 m windows (three steps).
  let bestB = { at: 0, secs: 0 }, bestA = { at: 0, secs: 0 }
  for (let i = 0; i + 3 <= c.bins.length; i++) {
    const g = c.bins.slice(i, i + 3).reduce((x, y) => x + (y.aSecs - y.bSecs), 0)   // > 0: B gained
    if (g > bestB.secs) bestB = { at: i, secs: g }
    if (-g > bestA.secs) bestA = { at: i, secs: -g }
  }
  const where = (i: number) => `between ${km(c.bins[i].fromM)} and ${km(c.bins[Math.min(c.bins.length - 1, i + 2)].toM)}`
  if (bestB.secs >= 2) out.push(`${bName} gained most ${where(bestB.at)} (${Math.round(bestB.secs)} s).`)
  if (bestA.secs >= 2) out.push(`${aName} gained most ${where(bestA.at)} (${Math.round(bestA.secs)} s).`)
  return out
}

/** Where each boat was `secs` of moving time after it reached the shared
 *  stretch, for a replay (rests are skipped, so the boats stay comparable). */
export function replayAt(a: LinePoint[], b: LinePoint[], c: LineCompare, secs: number) {
  const at = (pts: LinePoint[], clock: number[], t: number) => {
    if (t < clock[0] || t > clock[clock.length - 1]) return null
    return { lat: interp(clock, pts.map(p => p.lat), t), lng: interp(clock, pts.map(p => p.lng), t) }
  }
  return { a: at(a, movingClock(a), c.aStartT + secs), b: at(b, movingClock(b), c.bStartT + secs) }
}

/** How long the replay runs: the longer of the two through the shared stretch. */
export function replayLength(c: LineCompare): number {
  return Math.max(c.total.aSecs, c.total.bSecs)
}

export type SectionCompare =
  | { ok: true; compare: LineCompare; startLine: [number, number][]; finishLine: [number, number][]; aPass: AnalysisPoint[]; bPass: AnalysisPoint[] }
  | { ok: false; reason: 'too_short' | 'a_missed' | 'b_missed' | 'no_shared_line' }

/**
 * Compare one stretch: gates across A's line at its points `aIdx` and `bIdx`
 * (in paddling order), each paddle's fastest pass through them in that
 * direction, and the line comparison on those two passes. For pairs that went
 * round in a different order (laps, the other way first), where the whole
 * paddles can't be compared but a stretch both paddled can.
 */
export function compareSection(a: AnalysisPoint[], b: AnalysisPoint[], aIdx: number, bIdx: number): SectionCompare {
  const [i0, i1] = aIdx < bIdx ? [aIdx, bIdx] : [bIdx, aIdx]
  let lenM = 0
  for (let i = i0 + 1; i <= i1; i++) lenM += haversine([a[i - 1].lat, a[i - 1].lng], [a[i].lat, a[i].lng])
  if (lenM < MIN_SHARED_M) return { ok: false, reason: 'too_short' }
  const startLine = gateAt(a, i0), finishLine = gateAt(a, i1)
  const pass = (pts: AnalysisPoint[]) => {
    const r = raceTrack(pointsToTrack(pts), startLine, finishLine)
    if (!r) return null
    const t0 = Date.parse(r.startTimestamp) / 1000, t1 = Date.parse(r.finishTimestamp) / 1000
    return pts.filter(p => p.t >= t0 - 1 && p.t <= t1 + 1)
  }
  const pa = pass(a), pb = pass(b)
  if (!pa || pa.length < 2) return { ok: false, reason: 'a_missed' }
  if (!pb || pb.length < 2) return { ok: false, reason: 'b_missed' }
  const compare = compareLines(pa, pb)
  return compare ? { ok: true, compare, startLine, finishLine, aPass: pa, bPass: pb } : { ok: false, reason: 'no_shared_line' }
}
