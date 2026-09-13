// "Compare similar sections across paddles" — the deterministic core.
// See docs/features/similar-sections-compare.md.
//
// The user clicks two points on a saved paddle. We turn them into a start line
// and a finish line across the river (each perpendicular to the local track
// heading) — an on-the-fly ATT `point_to_point` course — and race every other
// own paddle through it. A paddle "counts" if it crosses the start line then the
// finish line IN ORDER (same travel direction); its result is the elapsed time
// between the crossings. All of that is ATT's line-crossing timing, reused:
// `processTrace(..., 'point_to_point', ..., tryReverse=false)`. Disabling the
// reverse fallback is what enforces same-direction — an opposite-way paddle
// crosses the finish gate first, so no forward start→finish pair exists.
//
// The only new maths here is deriving the two gate lines and a path-similarity
// score that rejects a candidate which clips both gates via a different channel.
import { haversine, processTrace } from '@paddlesnitch/timing/geo'
import type { LatLng, Line, TrackPoint, Split } from '@paddlesnitch/timing/types'
import type { AnalysisPoint, Conditions } from './analysis'
import type { AnalysisSession, AnalysisSource } from './analysis-store'

// Heuristic thresholds — tuned against real overlapping traces. The gate-crossing
// test is exact; these govern the *quality* filter and are the seam a smarter
// (model-ranked) version would replace. See the spec. Deliberately broad so a
// paddle on a slightly different line — different river lane, GPS drift — still
// registers as a candidate; the path-similarity score then rejects genuinely
// different water.
export const GATE_M = 120         // length of each derived cross-river gate line
export const CORRIDOR_M = 40      // max distance from the reference path to count as "on it"
export const COVERAGE_MIN = 0.6   // min path-similarity score to keep a gate-matched candidate
export const MIN_SECTION_M = 200  // shortest selectable section (matching is noisy below this)

const M_PER_DEG_LAT = 111320
const mPerDegLng = (lat: number) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)

export type Racer = {
  sessionId: string
  paddledAt: string
  source: AnalysisSource
  isSource: boolean
  elapsedS: number
  sectionM: number
  cruiseSpeed: number          // m/s over the section
  avgSR: number | null
  avgDps: number | null
  splits: Split[]              // per-500 m within the section
  score: number               // path-similarity 0..1 (1 for the source)
  trackSegment: LatLng[]       // start→finish path, for the map overlay
  conditions: Conditions | null // the paddle's wind + river flow (whole-session)
}

export type SectionRace = {
  startLine: Line
  finishLine: Line
  sectionM: number
  racers: Racer[]
  insight?: string             // coach narrative over the race (LLM or template)
  insightModel?: string        // which model wrote it (empty for the template)
}

// Saved analysis points → the TrackPoint shape the timing engine wants. `t` is
// seconds from the paddle start; relative timestamps are enough for elapsed
// timing (the race only ever measures differences).
export function pointsToTrack(points: AnalysisPoint[]): TrackPoint[] {
  return points.map(p => ({ lat: p.lat, lng: p.lng, timestamp: new Date(p.t * 1000), strokeRate: p.sr ?? undefined }))
}

// A gate: a line of length GATE_M centred on the track point at `idx`,
// perpendicular to the local heading there. Built in a local metric frame so the
// line is a true ~60 m cross-river segment regardless of latitude.
export function gateAt(points: AnalysisPoint[], idx: number): Line {
  const c = points[idx]
  const a = points[Math.max(0, idx - 1)]
  const b = points[Math.min(points.length - 1, idx + 1)]
  const kx = mPerDegLng(c.lat)
  const hx = (b.lng - a.lng) * kx          // heading, metres (east)
  const hy = (b.lat - a.lat) * M_PER_DEG_LAT // heading, metres (north)
  const len = Math.hypot(hx, hy) || 1
  const px = -hy / len, py = hx / len       // unit perpendicular (rotate +90°)
  const half = GATE_M / 2
  const dLng = (px * half) / kx
  const dLat = (py * half) / M_PER_DEG_LAT
  return [[c.lat + dLat, c.lng + dLng], [c.lat - dLat, c.lng - dLng]]
}

// Distance (m) from point p to segment v→w, in a local metric frame around p.
function distToSegmentM(p: LatLng, v: LatLng, w: LatLng): number {
  const kx = mPerDegLng(p[0])
  const px = 0, py = 0
  const vx = (v[1] - p[1]) * kx, vy = (v[0] - p[0]) * M_PER_DEG_LAT
  const wx = (w[1] - p[1]) * kx, wy = (w[0] - p[0]) * M_PER_DEG_LAT
  const dx = wx - vx, dy = wy - vy
  const l2 = dx * dx + dy * dy
  let t = l2 ? ((px - vx) * dx + (py - vy) * dy) / l2 : 0
  t = Math.max(0, Math.min(1, t))
  const cx = vx + t * dx, cy = vy + t * dy
  return Math.hypot(px - cx, py - cy)
}

function distToPolylineM(p: LatLng, poly: LatLng[]): number {
  if (poly.length === 0) return Infinity
  if (poly.length === 1) return haversine(p, poly[0])
  let best = Infinity
  for (let i = 0; i < poly.length - 1; i++) best = Math.min(best, distToSegmentM(p, poly[i], poly[i + 1]))
  return best
}

// Fraction of the reference path that the candidate's segment runs close to.
// Rejects a candidate that crosses both gates but via a different channel.
export function pathSimilarity(refPath: LatLng[], candidateSegment: LatLng[]): number {
  if (refPath.length === 0) return 0
  const near = refPath.filter(p => distToPolylineM(p, candidateSegment) <= CORRIDOR_M).length
  return near / refPath.length
}

function polylineLengthM(poly: LatLng[]): number {
  let d = 0
  for (let i = 1; i < poly.length; i++) d += haversine(poly[i - 1], poly[i])
  return d
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
const slope = (xs: number[], ys: number[]) => {
  const mx = mean(xs), my = mean(ys); let n = 0, d = 0
  xs.forEach((x, i) => { n += (x - mx) * (ys[i] - my); d += (x - mx) ** 2 })
  return d ? n / d : 0
}

export type SectionStats = {
  sectionM: number
  elapsedS: number
  cruiseSpeed: number          // m/s over the section
  avgSR: number | null
  avgDps: number | null
  strokeRateDoubled: boolean
  splits: { distance: number; elapsedSeconds: number }[] // per-500 m within the section
  firstHalfSpeed: number       // m/s over the first half (by time)
  secondHalfSpeed: number      // m/s over the second half
  srSlopePerMin: number | null // stroke-rate trend, spm/min (null if no SR)
  conditions: Conditions | null
}

// Stats for the paddler's OWN selected stretch — the literal slice points[lo..hi]
// (NOT gate-racing, so an out-and-back reflects exactly what was picked). Speed
// is re-derived over the slice; SR/dps use the already-scaled saved values so it
// respects the current SUP→kayak doubling.
export function sectionStats(source: AnalysisSession, aIdx: number, bIdx: number): SectionStats | null {
  const pts = source.result.points
  const lo = Math.min(aIdx, bIdx), hi = Math.max(aIdx, bIdx)
  if (lo < 0 || hi >= pts.length || hi - lo < 1) return null
  const slice = pts.slice(lo, hi + 1)
  const sectionM = polylineLengthM(slice.map(p => [p.lat, p.lng] as LatLng))
  const elapsedS = slice[slice.length - 1].t - slice[0].t
  const cruiseSpeed = elapsedS > 0 ? sectionM / elapsedS : 0

  const srs = slice.filter(p => p.sr != null && p.sr > 0).map(p => p.sr as number)
  const dpsv = slice.filter(p => p.dps != null).map(p => p.dps as number)
  const avgSR = srs.length ? mean(srs) : null
  const avgDps = dpsv.length ? mean(dpsv) : null
  const srSlopePerMin = srs.length > 2 ? slope(slice.filter(p => p.sr != null && p.sr > 0).map(p => p.t), srs) * 60 : null

  // first vs second half by time → a simple held/faded/built read. Uses MOVING
  // speed (>0.8 m/s), like the app's other averages, so a rest inside the
  // section doesn't dominate the trend and make it read as a huge slow-down.
  const midT = slice[0].t + elapsedS / 2
  const movingMean = (a: typeof slice) => { const sp = a.filter(p => p.speed > 0.8).map(p => p.speed); return sp.length ? mean(sp) : 0 }
  const firstHalfSpeed = movingMean(slice.filter(p => p.t <= midT))
  const secondHalfSpeed = movingMean(slice.filter(p => p.t >= midT))

  // per-500 m splits within the section (elapsed from the section start)
  const splits: { distance: number; elapsedSeconds: number }[] = []
  let acc = 0, next = 500
  for (let i = 1; i < slice.length; i++) {
    const seg = haversine([slice[i - 1].lat, slice[i - 1].lng], [slice[i].lat, slice[i].lng])
    while (acc + seg >= next && seg > 0) {
      const f = (next - acc) / seg
      const ms = slice[i - 1].t + f * (slice[i].t - slice[i - 1].t)
      splits.push({ distance: next, elapsedSeconds: ms - slice[0].t })
      next += 500
    }
    acc += seg
  }

  return {
    sectionM, elapsedS, cruiseSpeed, avgSR, avgDps,
    strokeRateDoubled: source.result.strokeRateDoubled,
    splits, firstHalfSpeed, secondHalfSpeed, srSlopePerMin,
    conditions: source.result.conditions ?? null,
  }
}

// Race one paddle through the gates. Same-direction only: point_to_point with
// the reverse fallback DISABLED. Returns the fastest forward start→finish run,
// or null if it never crossed both gates in order.
export function raceTrack(track: TrackPoint[], startLine: Line, finishLine: Line) {
  return processTrace(track, startLine, finishLine, 'point_to_point', 0, undefined, undefined, false)
}

function toRacer(session: AnalysisSession, startLine: Line, finishLine: Line, refPath: LatLng[], isSource: boolean): Racer | null {
  const track = pointsToTrack(session.result.points)
  const res = raceTrack(track, startLine, finishLine)
  if (!res || !res.trackSegment) return null
  const seg = res.trackSegment
  const score = isSource ? 1 : pathSimilarity(refPath, seg)
  if (!isSource && score < COVERAGE_MIN) return null
  const sectionM = polylineLengthM(seg)
  const elapsedS = res.totalElapsedSeconds
  const cruiseSpeed = elapsedS > 0 ? sectionM / elapsedS : 0
  const avgSR = res.avgStrokeRate ?? null
  const avgDps = avgSR && avgSR > 0 ? cruiseSpeed / (avgSR / 60) : null
  return {
    sessionId: session.id, paddledAt: session.paddledAt, source: session.source, isSource,
    elapsedS, sectionM, cruiseSpeed, avgSR, avgDps, splits: res.splits, score, trackSegment: seg,
    conditions: session.result.conditions ?? null,
  }
}

export type FindResult =
  | { ok: true; startLine: Line; finishLine: Line; sectionM: number; matches: Racer[] }
  | { ok: false; reason: 'section_too_short'; sectionM: number }

// Find the user's other paddles that raced the selected stretch of `source`.
// `aIdx`/`bIdx` are indices into source.result.points (the two clicked points).
// Matches are returned newest-first; the source is NOT in the list.
export function findSimilar(source: AnalysisSession, others: AnalysisSession[], aIdx: number, bIdx: number): FindResult {
  const pts = source.result.points
  const lo = Math.min(aIdx, bIdx), hi = Math.max(aIdx, bIdx)
  const startLine = gateAt(pts, lo)
  const finishLine = gateAt(pts, hi)
  const refPath: LatLng[] = pts.slice(lo, hi + 1).map(p => [p.lat, p.lng])
  const sectionM = polylineLengthM(refPath)
  if (sectionM < MIN_SECTION_M) return { ok: false, reason: 'section_too_short', sectionM }

  const matches = others
    .filter(s => s.id !== source.id)
    .map(s => toRacer(s, startLine, finishLine, refPath, false))
    .filter((r): r is Racer => r !== null)
    .sort((a, b) => (b.paddledAt > a.paddledAt ? 1 : b.paddledAt < a.paddledAt ? -1 : 0))

  return { ok: true, startLine, finishLine, sectionM, matches }
}

// Build the race board for a chosen subset. The source is always included as a
// racer (the reference). Order: source first, then the picked sessions in the
// order given.
export function buildRace(source: AnalysisSession, picked: AnalysisSession[], aIdx: number, bIdx: number): SectionRace | { ok: false; reason: 'section_too_short'; sectionM: number } {
  const pts = source.result.points
  const lo = Math.min(aIdx, bIdx), hi = Math.max(aIdx, bIdx)
  const startLine = gateAt(pts, lo)
  const finishLine = gateAt(pts, hi)
  const refPath: LatLng[] = pts.slice(lo, hi + 1).map(p => [p.lat, p.lng])
  const sectionM = polylineLengthM(refPath)
  if (sectionM < MIN_SECTION_M) return { ok: false, reason: 'section_too_short', sectionM }

  const racers: Racer[] = []
  const sourceRacer = toRacer(source, startLine, finishLine, refPath, true)
  if (sourceRacer) racers.push(sourceRacer)
  for (const s of picked) {
    if (s.id === source.id) continue
    const r = toRacer(s, startLine, finishLine, refPath, false)
    if (r) racers.push(r)
  }
  return { startLine, finishLine, sectionM, racers }
}
