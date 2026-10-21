// Tide predictions from our own harmonic fit of Environment Agency tide-gauge
// readings (OGL) — no paid or sign-up service (owner decision 2026-10-11; see
// docs/features/river-planner.md, "Tides"). Pure: the fit runs offline
// (scripts/waterways/fit-tides.ts) and the browser predicts from the result.
//
// The model is h(t) = z0 + Σ aᵢ cos(ωᵢt) + bᵢ sin(ωᵢt), t in hours from a
// fixed epoch. Nodal corrections (the 18.6-year modulation) are left out, so a
// fit is good for about a year: it's refitted yearly. Shallow-water terms
// (M4, MS4, MN4, M6, 2MS6, M8) carry the upper estuary's lopsided tide.
//
// Predicted astronomical tide only: surge, wind, pressure and the flow over
// Teddington weir move real times by tens of minutes. Not for navigation.

/** Speeds in degrees per hour. Chosen to be separable in ~1 year of data:
 *  no Sa or T2 (a full year apart from SSA and S2), no S1. */
export const CONSTITUENTS: Record<string, number> = {
  M2: 28.9841042, S2: 30.0, N2: 28.4397295, K2: 30.0821373, '2N2': 27.8953548, MU2: 27.9682084,
  NU2: 28.5125831, L2: 29.5284789, LAM2: 29.4556253,
  K1: 15.0410686, O1: 13.9430356, P1: 14.9589314, Q1: 13.3986609, J1: 15.5854433, OO1: 16.1391017, M1: 14.4966939,
  M3: 43.4761563, MK3: 44.0251729, '2MK3': 42.9271398,
  M4: 57.9682084, MS4: 58.9841042, MN4: 57.4238337, S4: 60.0,
  M6: 86.9523127, '2MS6': 87.9682084, M8: 115.9364166,
  MF: 1.0980331, MM: 0.5443747, MSF: 1.0158958, SSA: 0.0821373,
}

export type TideTerm = { name: string; speed: number; a: number; b: number }
export type TideModel = { epoch: string; z0: number; terms: TideTerm[] }
export type TideSample = { t: number; h: number }          // t: ms since 1970
export type TideExtreme = { type: 'high' | 'low'; at: string; height: number }

const RAD = Math.PI / 180
const hoursSince = (epochMs: number, t: number) => (t - epochMs) / 3_600_000

/** Least-squares fit of the constituents to the samples. */
export function fitTide(samples: TideSample[], names = Object.keys(CONSTITUENTS), epoch = '2026-01-01T00:00:00.000Z'): TideModel {
  const e = Date.parse(epoch)
  const w = names.map(n => CONSTITUENTS[n] * RAD)
  const k = 1 + 2 * names.length
  const ata = Array.from({ length: k }, () => new Float64Array(k))
  const atb = new Float64Array(k)
  const row = new Float64Array(k)
  for (const s of samples) {
    const t = hoursSince(e, s.t)
    row[0] = 1
    for (let i = 0; i < w.length; i++) { row[1 + 2 * i] = Math.cos(w[i] * t); row[2 + 2 * i] = Math.sin(w[i] * t) }
    for (let r = 0; r < k; r++) {
      const v = row[r]
      if (!v) continue
      atb[r] += v * s.h
      const ar = ata[r]
      for (let c = r; c < k; c++) ar[c] += v * row[c]
    }
  }
  for (let r = 0; r < k; r++) for (let c = 0; c < r; c++) ata[r][c] = ata[c][r]
  const x = solve(ata, atb)
  return { epoch, z0: x[0], terms: names.map((name, i) => ({ name, speed: CONSTITUENTS[name], a: x[1 + 2 * i], b: x[2 + 2 * i] })) }
}

/** Gaussian elimination with partial pivoting (the system is small and well-conditioned). */
function solve(a: Float64Array[], b: Float64Array): Float64Array {
  const n = b.length
  const m = a.map((r, i) => { const x = new Float64Array(n + 1); x.set(r); x[n] = b[i]; return x })
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r
    ;[m[c], m[p]] = [m[p], m[c]]
    for (let r = c + 1; r < n; r++) {
      const f = m[r][c] / m[c][c]
      if (!f) continue
      for (let j = c; j <= n; j++) m[r][j] -= f * m[c][j]
    }
  }
  const x = new Float64Array(n)
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r][n]
    for (let j = r + 1; j < n; j++) s -= m[r][j] * x[j]
    x[r] = s / m[r][r]
  }
  return x
}

/** Predicted height (metres, the gauge's datum) at time `t` (ms). */
export function tideAt(model: TideModel, t: number): number {
  const h = hoursSince(Date.parse(model.epoch), t)
  let v = model.z0
  for (const term of model.terms) {
    const x = term.speed * RAD * h
    v += term.a * Math.cos(x) + term.b * Math.sin(x)
  }
  return v
}

/** High and low waters between two times: scanned every 6 minutes, then
 *  refined to the minute. Ripples smaller than `minRange` metres are ignored. */
export function tideExtremes(model: TideModel, from: number, to: number, minRange = 0.3): TideExtreme[] {
  const step = 6 * 60_000
  const out: TideExtreme[] = []
  let prev = tideAt(model, from - step), cur = tideAt(model, from)
  for (let t = from; t <= to; t += step) {
    const next = tideAt(model, t + step)
    const high = cur >= prev && cur > next, low = cur <= prev && cur < next
    if (high || low) {
      // Refine within ±6 minutes at one-minute steps.
      let best = t, bestH = cur
      for (let u = t - step; u <= t + step; u += 60_000) {
        const h = tideAt(model, u)
        if (high ? h > bestH : h < bestH) { best = u; bestH = h }
      }
      const last = out.at(-1)
      if (!last || Math.abs(last.height - bestH) >= minRange || last.type !== (high ? 'high' : 'low')) {
        if (last && last.type === (high ? 'high' : 'low')) {
          // Two of a kind in a row (a stand): keep the more extreme.
          if (high ? bestH > last.height : bestH < last.height) out[out.length - 1] = { type: last.type, at: new Date(best).toISOString(), height: round3(bestH) }
        } else out.push({ type: high ? 'high' : 'low', at: new Date(best).toISOString(), height: round3(bestH) })
      }
    }
    prev = cur; cur = next
  }
  return out.filter(x => Date.parse(x.at) >= from && Date.parse(x.at) <= to)
}

const round3 = (v: number) => Math.round(v * 1000) / 1000

/** Observed high waters in a series of samples (15-minute readings): the
 *  highest reading in each run above the series' mean, at least 8 h apart,
 *  its time refined by a parabola through it and its neighbours (a reading
 *  every 15 minutes would otherwise put the peak up to 7.5 minutes out). */
export function observedHighs(samples: TideSample[]): TideSample[] {
  if (!samples.length) return []
  const mean = samples.reduce((n, s) => n + s.h, 0) / samples.length
  const out: TideSample[] = []
  let run = -1
  const close = () => {
    if (run < 0) return
    const peak = refine(samples, run)
    if (!out.length || peak.t - out.at(-1)!.t > 8 * 3_600_000) out.push(peak)
    run = -1
  }
  samples.forEach((s, i) => {
    if (s.h > mean) { if (run < 0 || s.h > samples[run].h) run = i }
    else close()
  })
  return out
}

function refine(s: TideSample[], i: number): TideSample {
  const a = s[i - 1], b = s[i], c = s[i + 1]
  if (!a || !c || c.t - b.t !== b.t - a.t) return b
  const denom = a.h - 2 * b.h + c.h
  if (!denom) return b
  const off = (0.5 * (a.h - c.h)) / denom          // in steps, within ±0.5
  return { t: b.t + off * (b.t - a.t), h: b.h - 0.25 * (a.h - c.h) * off }
}

/** A "high water" observed this far from the predicted height is a gauge
 *  fault (11 October 2026: all three gauges read 2.6–3.2 m low), not a tide. */
export const GAUGE_FAULT_M = 1.5

/** Backtest: for each observed high water, minutes to the nearest predicted
 *  one, and the height error; observations that are gauge faults are counted
 *  out (`faults`), never quietly dropped. */
export function backtest(model: TideModel, samples: TideSample[]): { n: number; faults: number; medianMin: number; p95Min: number; medianHeightM: number } {
  const highs = observedHighs(samples)
  if (!highs.length) return { n: 0, faults: 0, medianMin: NaN, p95Min: NaN, medianHeightM: NaN }
  const pred = tideExtremes(model, highs[0].t - 6 * 3_600_000, highs.at(-1)!.t + 6 * 3_600_000).filter(x => x.type === 'high')
  const dt: number[] = [], dh: number[] = []
  let faults = 0
  for (const o of highs) {
    let best: TideExtreme | null = null
    for (const p of pred) if (!best || Math.abs(Date.parse(p.at) - o.t) < Math.abs(Date.parse(best.at) - o.t)) best = p
    if (!best || Math.abs(Date.parse(best.at) - o.t) > 3 * 3_600_000) continue
    if (Math.abs(best.height - o.h) > GAUGE_FAULT_M) { faults++; continue }
    dt.push((Date.parse(best.at) - o.t) / 60_000)
    dh.push(best.height - o.h)
  }
  const q = (xs: number[], p: number) => { const s = [...xs].map(Math.abs).sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
  return { n: dt.length, faults, medianMin: Math.round(q(dt, 0.5)), p95Min: Math.round(q(dt, 0.95)), medianHeightM: Math.round(q(dh, 0.5) * 100) / 100 }
}

/** packages/waterways/data/tides.json, written by scripts/waterways/fit-tides.ts. */
export type TidesFile = {
  fittedAt: string
  credit: string
  gauges: Record<string, {
    label: string
    at: [number, number]
    datum?: 'NAP'                 // heights above NAP (Dutch gauges); otherwise Ordnance Datum
    lows: boolean                 // false: high waters only (Richmond's half-tide lock holds the low water up)
    from: string; to: string      // the readings fitted
    backtest: { n: number; faults: number; medianMin: number; p95Min: number; medianHeightM: number }
    model: TideModel
  }>
}

/** A fit we're willing to show: enough held-out high waters, their median
 *  error and 95th percentile within these. The upper Thames's neap high water
 *  is a long flat stand, so its moment is loosely defined: the 95th percentile
 *  is mostly neaps. Every view shows the real figure next to the prediction. */
export const SHOW_MEDIAN_MIN = 15
export const SHOW_P95_MIN = 45
export const showable = (g: Pick<TidesFile['gauges'][string], 'backtest'>) =>
  g.backtest.n >= 20 && g.backtest.medianMin <= SHOW_MEDIAN_MIN && g.backtest.p95Min <= SHOW_P95_MIN

/** Dutch tide gauges fitted from Rijkswaterstaat's measured water heights
 *  (scripts/waterways/download-rws-tides.ts, then fit-tides.ts): the
 *  Westerschelde, Oosterschelde, the Maas mouth up to Dordrecht, the North Sea
 *  coast and the Wadden Sea. Rijkswaterstaat location codes. */
export const RWS_TIDE_GAUGES: Record<string, { code: string; label: string; at: [number, number] }> = {
  vlissingen: { code: 'vlissingen', label: 'Vlissingen', at: [51.442, 3.6] },
  terneuzen: { code: 'terneuzen', label: 'Terneuzen', at: [51.3362, 3.8198] },
  hansweert: { code: 'hansweert', label: 'Hansweert', at: [51.4457, 3.9974] },
  bath: { code: 'rilland.bath', label: 'Bath', at: [51.3988, 4.2101] },
  stavenisse: { code: 'stavenisse', label: 'Stavenisse', at: [51.598, 4.004] },
  hoekVanHolland: { code: 'hoekvanholland', label: 'Hoek van Holland', at: [51.9769, 4.1198] },
  maassluis: { code: 'maassluis', label: 'Maassluis', at: [51.9175, 4.2498] },
  rotterdam: { code: 'rotterdam.nieuwemaas.boerengat', label: 'Rotterdam (Boerengat)', at: [51.9184, 4.5003] },   // Boompjes has no measured series
  dordrecht: { code: 'dordrecht.oudemaas.benedenmerwede', label: 'Dordrecht', at: [51.82, 4.671] },
  scheveningen: { code: 'scheveningen', label: 'Scheveningen', at: [52.099, 4.2636] },
  ijmuiden: { code: 'ijmuiden.buitenhaven', label: 'IJmuiden', at: [52.463, 4.555] },
  denHelder: { code: 'denhelder.marsdiep', label: 'Den Helder', at: [52.9644, 4.745] },
  harlingen: { code: 'harlingen.waddenzee', label: 'Harlingen', at: [53.1756, 5.4093] },
  terschelling: { code: 'terschelling.west', label: 'West-Terschelling', at: [53.363, 5.22] },
  lauwersoog: { code: 'lauwersoog.waddenzee', label: 'Lauwersoog', at: [53.4083, 6.196] },
  delfzijl: { code: 'delfzijl', label: 'Delfzijl', at: [53.328, 6.931] },
}

/** Rijkswaterstaat's own predicted high and low waters ("getijextreem
 *  berekend", GETETBRKD2) for the Dutch gauges, fetched at build time and
 *  published with each data version as `tides-nl`, so a plan never sends its
 *  whereabouts anywhere. Compact: per gauge a base time (ms) and
 *  [minutes after base, cm above NAP] pairs. */
export type OfficialTides = {
  fetchedAt: string
  credit: string
  gauges: Record<string, { label: string; at: [number, number]; base: number; ext: [number, number][] }>
}

export function compactExtremes(list: { t: number; h: number }[]): { base: number; ext: [number, number][] } {
  const sorted = [...list].sort((a, b) => a.t - b.t)
  const base = sorted[0]?.t ?? 0
  return { base, ext: sorted.map(e => [Math.round((e.t - base) / 60_000), Math.round(e.h * 100)]) }
}

/** The predicted extremes between two times. Highs and lows are told apart by
 *  their neighbours (Hoek van Holland's double low water is two lows). */
export function officialExtremes(g: OfficialTides['gauges'][string], from: number, to: number): TideExtreme[] {
  const out: TideExtreme[] = []
  g.ext.forEach(([m, cm], i) => {
    const t = g.base + m * 60_000
    if (t < from || t > to) return
    const prev = g.ext[i - 1]?.[1], next = g.ext[i + 1]?.[1]
    const high = (prev === undefined || cm > prev) && (next === undefined || cm > next)
    out.push({ type: high ? 'high' : 'low', at: new Date(t).toISOString(), height: cm / 100 })
  })
  return out
}
