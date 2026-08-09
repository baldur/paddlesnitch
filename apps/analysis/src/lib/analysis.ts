// Paddle-session analysis engine (playable prototype; will move to
// packages/analysis when apps/analysis is scaffolded). Deterministic: derives
// metrics, then segments the session by its own cruising baseline + departures
// (down = rests, up = surges), trends each surge, and groups surges into sets.
// The LLM only narrates this output later — the metrics stand alone.
import { haversine } from '@paddlesnitch/timing/geo'
import type { TrackPoint } from '@paddlesnitch/timing/types'

export type AnalysisPoint = { t: number; lat: number; lng: number; speed: number; sr: number | null; dps: number | null }

// Round a map point to sane precision before it goes on the wire / to storage.
// Full-precision GPS floats dominate the payload and are ~incompressible; these
// bounds are all below anything meaningful for paddle analysis — lat/lng to 6dp
// (~0.1 m, well under GPS noise), speed/dps to mm-scale, t to 0.1 s, sr to 0.1
// SPM — and cut the analyse payload ~3× after gzip. See docs (payload sizing).
const q = (x: number, dp: number) => Math.round(x * 10 ** dp) / 10 ** dp
const qn = (x: number | null, dp: number) => (x == null ? null : q(x, dp))
function roundPoint(p: AnalysisPoint): AnalysisPoint {
  return { t: q(p.t, 1), lat: q(p.lat, 6), lng: q(p.lng, 6), speed: q(p.speed, 3), sr: qn(p.sr, 1), dps: qn(p.dps, 3) }
}
export type Segment = {
  kind: 'rest' | 'cruise' | 'surge'
  fromT: number; toT: number; durS: number; distM: number
  avgSpeed: number; splitPer500: number
  avgSR: number | null; srCv: number | null; avgDps: number | null
  trend?: string
}
export type SessionSet = { count: number; avgDurS: number; avgSpeed: number; avgSR: number | null }
export type Conditions = { windKmh?: number; windDir?: number; flowM3s?: number; flowStation?: string }
export type AnalysisResult = {
  durationS: number; distanceKm: number
  avgSpeed: number; avgSR: number | null; avgDps: number | null
  // Overall stroke-rate consistency, as a coefficient of variation in %
  // (lower = steadier rhythm). Scale-invariant, so unaffected by SUP×2. Null
  // when the trace carried no usable stroke-rate data. A "good technique" signal
  // the coach narrative reads alongside distance-per-stroke. Optional so
  // pre-existing sessions / fixtures without it still type-check.
  srCv?: number | null
  cruiseSpeed: number
  strokeRateDoubled: boolean
  points: AnalysisPoint[]
  stops: Segment[]
  surges: Segment[]
  sets: SessionSet[]
  insight: string
  insightModel?: string   // which LLM wrote the insight (empty for the template)
  conditions?: Conditions
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
const std = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))) }
const cv = (a: number[]) => (a.length < 2 || mean(a) === 0 ? 0 : std(a) / mean(a))
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0 }
const slope = (xs: number[], ys: number[]) => { const mx = mean(xs), my = mean(ys); let n = 0, d = 0; xs.forEach((x, i) => { n += (x - mx) * (ys[i] - my); d += (x - mx) ** 2 }); return d ? n / d : 0 }
export const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
// A duration in plain words: 3600 → "1 hour", 3720 → "1 hour 2 minutes",
// 120 → "2 minutes", 82 → "1 minute 22 seconds", 45 → "45 seconds".
// Sessions never exceed a few hours, so hours are the largest unit (no days).
export function fmtDurWords(s: number): string {
  const total = Math.round(s)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  const parts: string[] = []
  if (h > 0) parts.push(`${h} hour${h === 1 ? '' : 's'}`)
  if (m > 0) parts.push(`${m} minute${m === 1 ? '' : 's'}`)
  if (sec > 0 || (h === 0 && m === 0)) parts.push(`${sec} second${sec === 1 ? '' : 's'}`)
  return parts.join(' ')
}
export const split500 = (spd: number) => (spd > 0.2 ? fmtDur(500 / spd) : '—')
// An adjectival duration for "a ___ paddle": short sessions stay in minutes
// ("45-min"), but past an hour we frame the hours out ("1 hr 20 min") — saying
// "80-min" reads strangely. See issue #170.
export function fmtDurAdj(s: number): string {
  const totalMin = Math.round(s / 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m}-min`
  if (m === 0) return `${h}-hr`
  return `${h} hr ${m} min`
}

// Toggle the SUP→kayak doubling on an already-analysed result WITHOUT re-running
// the pipeline. Doubling only scales stroke-rate-derived fields (sr, dps, and
// their averages); speed and segmentation are untouched, and stroke-rate CV is
// scale-invariant. So this is an exact rescale by 2 or ½ from the current state.
export function rescaleDoubling(r: AnalysisResult, target: boolean): AnalysisResult {
  const f = (target ? 2 : 1) / (r.strokeRateDoubled ? 2 : 1)
  if (f === 1) return { ...r, strokeRateDoubled: target }
  const sr = (v: number | null) => (v == null ? null : v * f)
  const dps = (v: number | null) => (v == null ? null : v / f)
  const seg = (s: Segment): Segment => ({ ...s, avgSR: sr(s.avgSR), avgDps: dps(s.avgDps) })
  return {
    ...r,
    strokeRateDoubled: target,
    avgSR: sr(r.avgSR), avgDps: dps(r.avgDps),
    points: r.points.map(p => roundPoint({ ...p, sr: sr(p.sr), dps: dps(p.dps) })),
    stops: r.stops.map(seg), surges: r.surges.map(seg),
    sets: r.sets.map(s => ({ ...s, avgSR: sr(s.avgSR) })),
  }
}

export function analyseTrack(track: TrackPoint[], opts: { doubleStrokeRate?: boolean; conditions?: Conditions } = {}): AnalysisResult {
  const t0 = track[0].timestamp.getTime()
  const dbl = opts.doubleStrokeRate ? 2 : 1
  // per-point speed (assigned to the later point), smoothed over ~7 samples
  const raw = track.map((p, i) => {
    let sp = 0
    if (i > 0) { const dt = (p.timestamp.getTime() - track[i - 1].timestamp.getTime()) / 1000; if (dt > 0) sp = haversine([track[i - 1].lat, track[i - 1].lng], [p.lat, p.lng]) / dt }
    return { t: (p.timestamp.getTime() - t0) / 1000, lat: p.lat, lng: p.lng, sp, sr: p.strokeRate != null ? p.strokeRate * dbl : null }
  })
  const P: AnalysisPoint[] = raw.map((p, i) => {
    const speed = mean(raw.slice(Math.max(0, i - 3), i + 4).map(q => q.sp))
    return { t: p.t, lat: p.lat, lng: p.lng, speed, sr: p.sr, dps: p.sr && p.sr > 0 ? speed / (p.sr / 60) : null }
  })

  const moving = P.filter(p => p.speed > 0.8).map(p => p.speed)
  const cruise = pct(moving, 55)
  const label = (p: AnalysisPoint): Segment['kind'] => (p.speed < 0.8 ? 'rest' : p.speed > cruise * 1.06 ? 'surge' : 'cruise')

  // contiguous runs, merge <12s blips, coalesce neighbours
  type Run = { kind: Segment['kind']; rows: AnalysisPoint[] }
  let runs: Run[] = []
  for (const p of P) { const last = runs[runs.length - 1]; const k = label(p); if (last && last.kind === k) last.rows.push(p); else runs.push({ kind: k, rows: [p] }) }
  const durOf = (r: Run) => r.rows[r.rows.length - 1].t - r.rows[0].t
  for (let i = 1; i < runs.length; i++) if (durOf(runs[i]) < 12) { runs[i - 1].rows.push(...runs[i].rows); runs[i].rows = [] }
  runs = runs.filter(r => r.rows.length)
  const merged: Run[] = []
  for (const r of runs) { const last = merged[merged.length - 1]; if (last && last.kind === r.kind) last.rows.push(...r.rows); else merged.push(r) }

  const toSeg = (r: Run): Segment => {
    const rows = r.rows, durS = durOf(r)
    const avgSpeed = mean(rows.map(p => p.speed))
    const srs = rows.filter(p => p.sr != null && p.sr > 0).map(p => p.sr as number)
    const dpsv = rows.filter(p => p.dps != null).map(p => p.dps as number)
    let trend: string | undefined
    if (r.kind === 'surge') {
      const ts = rows.filter(p => p.sr != null).map(p => p.t)
      const srSlope = srs.length > 2 ? slope(ts, srs) * 60 : 0
      const spSlope = slope(rows.map(p => p.t), rows.map(p => p.speed)) * 60
      trend = srSlope > 3 ? `built +${srSlope.toFixed(0)} spm/min` : spSlope < -0.1 && Math.abs(srSlope) < 3 ? `faded (fatigue)` : spSlope > 0.08 ? `negative split` : 'held'
    }
    return { kind: r.kind, fromT: rows[0].t, toT: rows[rows.length - 1].t, durS, distM: avgSpeed * durS, avgSpeed, splitPer500: avgSpeed > 0.2 ? 500 / avgSpeed : 0, avgSR: srs.length ? mean(srs) : null, srCv: srs.length ? cv(srs) * 100 : null, avgDps: dpsv.length ? mean(dpsv) : null, trend }
  }
  const segs = merged.map(toSeg)
  const stops = segs.filter(s => s.kind === 'rest' && s.durS >= 15)
  const surges = segs.filter(s => s.kind === 'surge' && s.durS >= 20)

  // group surges into sets by similar duration + pace
  const sets: SessionSet[] = []
  for (const s of surges) {
    const g = sets.find(g => Math.abs(g.avgDurS - s.durS) / g.avgDurS < 0.35 && Math.abs(g.avgSpeed - s.avgSpeed) / g.avgSpeed < 0.06)
    if (g) { g.count++; g.avgDurS = (g.avgDurS * (g.count - 1) + s.durS) / g.count; g.avgSpeed = (g.avgSpeed * (g.count - 1) + s.avgSpeed) / g.count; if (s.avgSR != null) g.avgSR = s.avgSR }
    else sets.push({ count: 1, avgDurS: s.durS, avgSpeed: s.avgSpeed, avgSR: s.avgSR })
  }

  const durationS = P[P.length - 1].t
  const distanceKm = track.reduce((d, p, i) => d + (i ? haversine([track[i - 1].lat, track[i - 1].lng], [p.lat, p.lng]) : 0), 0) / 1000
  const allSR = P.filter(p => p.sr != null && p.sr > 0).map(p => p.sr as number)
  const allDps = P.filter(p => p.dps != null).map(p => p.dps as number)

  // downsample points for the map (≤900) + round to keep the payload small
  const step = Math.max(1, Math.ceil(P.length / 900))
  const points = P.filter((_, i) => i % step === 0).map(roundPoint)

  return {
    durationS, distanceKm,
    avgSpeed: mean(moving), avgSR: allSR.length ? mean(allSR) : null, avgDps: allDps.length ? mean(allDps) : null,
    srCv: allSR.length >= 2 ? cv(allSR) * 100 : null,
    cruiseSpeed: cruise, strokeRateDoubled: !!opts.doubleStrokeRate,
    points, stops, surges, sets,
    insight: buildInsight({ durationS, distanceKm, surges, stops, sets, allSR, cruise, conditions: opts.conditions }),
    conditions: opts.conditions,
  }
}

// Deterministic templated insight (the LLM replaces this later, narrating the
// same structured facts). Kept in engine so the page is useful before Bedrock.
function buildInsight(a: { durationS: number; distanceKm: number; surges: Segment[]; stops: Segment[]; sets: SessionSet[]; allSR: number[]; cruise: number; conditions?: Conditions }): string {
  const dur = fmtDurAdj(a.durationS)
  const nS = a.surges.length, nR = a.stops.length
  const srTxt = a.allSR.length ? ` at ~${Math.round(mean(a.allSR))} spm` : ''
  const cruiseTxt = `~${split500(a.cruise)}/500`
  const flow = a.conditions?.flowM3s != null ? ` Flow was ${a.conditions.flowM3s.toFixed(1)} m³/s.` : ''
  if (nS === 0) return `A steady ${dur} paddle, cruising ${cruiseTxt}${srTxt}${nR ? ` with ${nR} short ${nR === 1 ? 'break' : 'breaks'}` : ' — no stops'}.${flow}`
  const set = a.sets.find(s => s.count >= 2)
  const consist = a.surges.map(s => s.srCv).filter((x): x is number => x != null)
  const consistTxt = consist.length ? (Math.max(...consist) < 5 ? ' Rate held tight throughout.' : Math.min(...consist) < 5 ? ' Some efforts were rock-steady, others drifted.' : ' Stroke rate wandered within the efforts.') : ''
  const setTxt = set ? ` Looks like a set of ${set.count} × ~${fmtDur(set.avgDurS)} @ ${split500(set.avgSpeed)}/500.` : ''
  return `A ${dur} paddle, mostly cruising ${cruiseTxt}${srTxt} — but not flat: ${nS} ${nS === 1 ? 'dig' : 'digs'}${nR ? ` and ${nR} ${nR === 1 ? 'breather' : 'breathers'}` : ''}.${setTxt}${consistTxt}${flow}`
}
