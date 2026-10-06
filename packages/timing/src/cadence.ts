// Stroke rate from the tracker's raw motion sidecar (`track_<stamp>_imu.csv`).
//
// This is the thing the 1 Hz track CSV cannot give us: `describeDeviceData` is
// honest that a per-second accelerometer PEAK can never yield a 0.5-2 Hz cadence.
// The sidecar carries the underlying stream, and cadence falls straight out of it.
//
// The method, and why each step is there:
//
//  1. Pick the gyro axis with the most variance in the window. Which axis carries
//     the stroke depends entirely on how the device happens to be oriented — in a
//     pocket, strapped to a deck, face up or face down — so hardcoding one axis
//     works until the day someone mounts it differently.
//  2. Autocorrelate, and take the best LOCAL maximum in the band. The global
//     maximum inside a band sits on the band edge whenever there is broadband
//     high-frequency content, which reports the edge back as though it were a
//     measurement. (Observed: an early version confidently returned exactly the
//     band limit for every stationary window.)
//  3. Check the correlation at HALF that lag. Alternating left/right strokes
//     produce mirror-image deflections, so a real paddling cycle shows a strongly
//     NEGATIVE half-lag correlation, and the stroke rate is twice the cycle rate.
//     Measured at -0.82 to -0.88 on real paddling data. Without this test the
//     reported rate is out by a factor of two, which is worse than reporting
//     nothing.
//
// Verified against a 65-minute session (8.2 MB, 170k samples): ~25-29 cycles/min
// at r = 0.74-0.82, i.e. ~50-58 spm, stable across separate moving stretches.

export type CadenceWindow = {
  tMs: number             // window start, on the same millis() clock as the track CSV
  cyclesPerMin: number    // what was measured
  strokesPerMin: number   // cyclesPerMin, doubled when the stroke alternates
  alternating: boolean
  confidence: number      // |autocorrelation| at the chosen lag, 0..1
}

export type CadenceReport = {
  available: boolean
  reason: string
  sampleRateHz: number | null
  rows: number
  medianStrokesPerMin: number | null
  windows: CadenceWindow[]
}

export type MotionSample = { ms: number; ax: number; ay: number; az: number; gx: number; gy: number; gz: number }

// Paddling sits far inside this; the band only has to exclude DC wander and
// high-frequency hull slap.
const MIN_CYCLE_HZ = 0.2
const MAX_CYCLE_HZ = 2.0
// Below this the autocorrelation peak is not distinguishable from noise.
const MIN_CONFIDENCE = 0.35
// Alternating strokes mirror each other, so the half-lag correlation is not just
// negative but very nearly the full inverse of the peak. The test is the RATIO,
// not an absolute floor: a single-sided pulse train also correlates negatively at
// half its period (measured -0.67), so an absolute threshold calls everything
// alternating and silently doubles every reading.
//
//   measured, real alternating paddling   peak +0.82, half -0.88  ratio -1.07
//   synthetic single-sided pulse train    peak +0.96, half -0.67  ratio -0.69
//
// CALIBRATION DEBT: the alternating end is real data, the single-sided end is
// synthetic. Confirm against a genuine one-sided recording (canoe, SUP) before
// trusting this on anything but kayak.
const ALTERNATING_RATIO = -0.85
const WINDOW_S = 60
const STEP_S = 30
// Cadence needs nothing like 50 Hz (verified: identical results down to 5 Hz), and
// autocorrelation cost is quadratic in the sample count, so decimate first.
const WORK_HZ = 10

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Parses the sidecar CSV. Tolerates the header being present or absent. */
export function parseMotionCsv(csv: string): MotionSample[] {
  const out: MotionSample[] = []
  for (const line of csv.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    const p = t.split(',')
    if (p.length < 7) continue
    const ms = Number(p[0])
    if (!Number.isFinite(ms)) continue   // the header row lands here
    const v = p.slice(1, 7).map(Number)
    if (v.some(n => !Number.isFinite(n))) continue
    out.push({ ms, ax: v[0], ay: v[1], az: v[2], gx: v[3], gy: v[4], gz: v[5] })
  }
  out.sort((a, b) => a.ms - b.ms)
  return out
}

function variance(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length
}

/** Autocorrelation of a detrended series at one lag, normalised to lag 0. */
function autocorr(x: number[], lag: number, denom: number): number {
  let s = 0
  for (let i = 0; i + lag < x.length; i++) s += x[i] * x[i + lag]
  return denom > 0 ? s / denom : 0
}

function analyseWindow(samples: MotionSample[], fs: number, tMs: number): CadenceWindow | null {
  if (samples.length < 16) return null
  // Orientation-agnostic: whichever gyro axis actually carries the stroke.
  const axes: (keyof MotionSample)[] = ['gx', 'gy', 'gz']
  let best: number[] | null = null
  let bestVar = -1
  for (const a of axes) {
    const series = samples.map(s => s[a] as number)
    const v = variance(series)
    if (v > bestVar) { bestVar = v; best = series }
  }
  if (!best || bestVar <= 0) return null

  const mean = best.reduce((a, b) => a + b, 0) / best.length
  const x = best.map(v => v - mean)
  const denom = x.reduce((a, b) => a + b * b, 0)
  if (denom <= 0) return null

  const lo = Math.max(2, Math.floor(fs / MAX_CYCLE_HZ))
  const hi = Math.min(x.length - 2, Math.ceil(fs / MIN_CYCLE_HZ))
  if (hi <= lo + 2) return null

  const r: number[] = []
  for (let lag = lo; lag <= hi; lag++) r.push(autocorr(x, lag, denom))

  // Best LOCAL maximum — never the band edge. See the header note.
  let peakLag = -1
  let peakR = -1
  for (let i = 1; i < r.length - 1; i++) {
    if (r[i] > r[i - 1] && r[i] > r[i + 1] && r[i] > peakR) { peakR = r[i]; peakLag = lo + i }
  }
  if (peakLag < 0 || peakR < MIN_CONFIDENCE) return null

  // Sub-sample the peak. At the 5 Hz we upload, one lag step is ~10% of a stroke
  // period, so snapping to the nearest whole lag alone costs more accuracy than
  // the downsampling itself does (measured: 52.2 vs 57.1 spm against the same
  // 50 Hz source). Parabolic interpolation through the peak and its neighbours
  // recovers it for three lines of arithmetic.
  const i = peakLag - lo
  let refinedLag = peakLag
  if (i > 0 && i < r.length - 1) {
    const denomP = r[i - 1] - 2 * r[i] + r[i + 1]
    if (denomP !== 0) {
      const shift = (0.5 * (r[i - 1] - r[i + 1])) / denomP
      if (Math.abs(shift) <= 1) refinedLag = peakLag + shift
    }
  }

  const halfR = autocorr(x, Math.max(1, Math.round(peakLag / 2)), denom)
  const alternating = peakR > 0 && halfR / peakR < ALTERNATING_RATIO
  const cyclesPerMin = (60 * fs) / refinedLag

  return {
    tMs,
    cyclesPerMin: Math.round(cyclesPerMin * 10) / 10,
    strokesPerMin: Math.round(cyclesPerMin * (alternating ? 2 : 1) * 10) / 10,
    alternating,
    confidence: Math.round(peakR * 1000) / 1000,
  }
}

/**
 * Derives stroke rate from a motion sidecar.
 *
 * `movingRanges` (millis() spans where the boat was actually moving, from the
 * track CSV) matters more than it looks: a session usually opens with the device
 * sitting at the launch, and a stationary window produces a confident-looking
 * periodicity that is nothing to do with paddling.
 */
export function deriveCadence(
  csv: string,
  opts: { movingRanges?: [number, number][] } = {},
): CadenceReport {
  const prep = prepareMotion(csv)
  if ('reason' in prep) return { available: false, ...prep, medianStrokesPerMin: null, windows: [] }
  const { fsRaw, rows } = prep

  const windows = windowsOver(prep, WINDOW_S, STEP_S, opts.movingRanges)

  if (windows.length === 0) {
    return { available: false, reason: 'No window showed a clear repeating stroke pattern — the device may have been stationary, or carried somewhere the stroke does not reach it.', sampleRateHz: Math.round(fsRaw * 10) / 10, rows, medianStrokesPerMin: null, windows: [] }
  }

  const med = median(windows.map(w => w.strokesPerMin))
  return {
    available: true,
    reason: `Derived from ${windows.length} window${windows.length === 1 ? '' : 's'} of ${WINDOW_S}s at ${Math.round(fsRaw)} Hz.`,
    sampleRateHz: Math.round(fsRaw * 10) / 10,
    rows,
    medianStrokesPerMin: med == null ? null : Math.round(med * 10) / 10,
    windows,
  }
}

type Prepared = { work: MotionSample[]; fs: number; fsRaw: number; rows: number }

/** Parses and decimates a sidecar, or says why it can't give a stroke rate. */
function prepareMotion(csv: string): Prepared | { reason: string; sampleRateHz: number | null; rows: number } {
  const all = parseMotionCsv(csv)
  if (all.length < 64) {
    return { reason: 'Motion file has too few samples to derive cadence.', sampleRateHz: null, rows: all.length }
  }

  const deltas: number[] = []
  for (let i = 1; i < Math.min(all.length, 2000); i++) deltas.push(all[i].ms - all[i - 1].ms)
  const step = median(deltas.filter(d => d > 0))
  const fsRaw = step && step > 0 ? 1000 / step : null
  if (!fsRaw || fsRaw < 2) {
    return { reason: `Motion data is sampled at ${fsRaw ? fsRaw.toFixed(1) : '?'} Hz — too slow for a 0.5–2 Hz stroke.`, sampleRateHz: fsRaw, rows: all.length }
  }

  const factor = Math.max(1, Math.round(fsRaw / WORK_HZ))
  const work = factor > 1 ? all.filter((_, i) => i % factor === 0) : all
  return { work, fs: fsRaw / factor, fsRaw, rows: all.length }
}

/** Every window of `windowS` seconds, `stepS` apart, that shows a stroke. */
function windowsOver({ work, fs }: Prepared, windowS: number, stepS: number, movingRanges?: [number, number][]): CadenceWindow[] {
  // The WHOLE window must be moving, not just its midpoint: a window that is half
  // parked at the launch and half paddling averages the two into a worse estimate
  // than either.
  const inMoving = (from: number, to: number) =>
    !movingRanges?.length || movingRanges.some(([a, b]) => from >= a && to <= b)

  const windows: CadenceWindow[] = []
  const lastMs = work[work.length - 1].ms
  let lo = 0
  for (let t = work[0].ms; t + windowS * 1000 <= lastMs; t += stepS * 1000) {
    if (!inMoving(t, t + windowS * 1000)) continue
    while (lo < work.length && work[lo].ms < t) lo++
    let hi = lo
    while (hi < work.length && work[hi].ms < t + windowS * 1000) hi++
    const w = analyseWindow(work.slice(lo, hi), fs, t)
    if (w) windows.push(w)
  }
  return windows
}

/** Stroke rate at one moment of a paddle: the centre of one short window. */
export type StrokeRatePoint = { ms: number; strokesPerMin: number; confidence: number }

// Through-the-paddle stroke rate (docs/features/one-paddle.md, phase 1): short
// windows close together, so efforts and rests show. Chosen by the sweep in
// docs/features/device-data.md against the 13 Sep reference capture.
export const SERIES_WINDOW_S = 15
export const SERIES_STEP_S = 5
// Moving stretches this short still hold a whole window; the 90 s the session
// figure uses would drop most interval pieces (measured: 237 windows instead of
// 137 on the reference capture, median 57.0 against 57.6).
export const SERIES_MIN_RUN_S = 20

/**
 * Stroke rate through the paddle, one value per `stepS`, on the tracker's
 * millis() clock. Windows with no clear stroke give NO value (a rest is a gap,
 * not a zero, and never a guess).
 */
export function strokeRateSeries(
  csv: string,
  opts: { movingRanges?: [number, number][]; windowS?: number; stepS?: number } = {},
): StrokeRatePoint[] {
  const prep = prepareMotion(csv)
  if ('reason' in prep) return []
  const windowS = opts.windowS ?? SERIES_WINDOW_S
  const stepS = opts.stepS ?? SERIES_STEP_S
  const windows = windowsOver(prep, windowS, stepS, opts.movingRanges)
  // Left/right is decided ONCE for the paddle, by majority. On a 15 s window
  // the half-lag test flips back and forth while the cycle rate holds steady
  // (measured on a real 81 min paddle: ~31 cycles/min throughout, 234 of 316
  // windows alternating), and every flip read as half the stroke rate. Nobody
  // changes paddling style mid-outing, so one decision is right for all of it.
  //
  // Only alternating paddles get a series for now. Single-sided strokes (canoe,
  // SUP) are calibrated on synthetic data alone, and a real recording read as
  // single-sided swung between 35 and 87: no number is better than that.
  if (windows.length < MIN_SERIES_WINDOWS) return []
  const alternating = windows.filter(w => w.alternating).length / windows.length >= MIN_ALTERNATING_SHARE
  if (!alternating) return []
  const pts = windows.map(w => ({
    ms: w.tMs + windowS * 500,
    strokesPerMin: Math.round(w.cyclesPerMin * 2 * 10) / 10,
    confidence: w.confidence,
  }))
  return pts.filter((p, i) => agreesWithNeighbours(pts, i, stepS * 1000))
}

// Too few windows to decide left/right by majority (a 9-minute test recording
// gave 2, both reading half the rate).
const MIN_SERIES_WINDOWS = 6
const MIN_ALTERNATING_SHARE = 0.6

// Neighbouring windows overlap by two thirds, so a real change of rate moves
// through several of them. A lone window far from both its neighbours is the
// alternating test missing once (measured on the reference capture: 22.5 spm
// between 56.2 and 54.6, exactly half), and a window with no neighbour at all
// is too little to trust. Both are dropped: a gap, never a wrong number.
const NEIGHBOUR_TOLERANCE = 0.3

function agreesWithNeighbours(pts: StrokeRatePoint[], i: number, stepMs: number): boolean {
  const near = [pts[i - 1], pts[i + 1]].filter(q => q && Math.abs(q.ms - pts[i].ms) <= stepMs * 1.5)
  if (near.length === 0) return false
  const ref = near.reduce((a, q) => a + q.strokesPerMin, 0) / near.length
  return Math.abs(pts[i].strokesPerMin - ref) <= ref * NEIGHBOUR_TOLERANCE
}

/**
 * Millisecond spans where the boat was actually moving, from the track CSV
 * (its `ms` and `speed_kmh` columns): at least 4 km/h for `minRunS` rows in a
 * row (the track is 1 Hz).
 *
 * Without this the cadence search runs over the parked minutes at the start of a
 * session too, where a stationary device produces a confident-looking periodicity
 * that has nothing to do with paddling.
 */
export function movingRangesFromTrack(csv: string, minRunS = 90): [number, number][] {
  // The header is the first line naming the columns: a serial capture opens
  // with a <<<CAT …>>> marker before it.
  const lines = csv.split(/\r?\n/)
  const hi = lines.findIndex(l => /(^|,)\s*ms\s*,/i.test(l))
  if (hi < 0) return []
  const head = lines[hi].split(',').map(h => h.trim().toLowerCase().replace(/[\s_]/g, ''))
  const msI = head.indexOf('ms')
  const spI = head.findIndex(h => h === 'speedkmh' || h === 'speed')
  if (msI < 0 || spI < 0) return []

  const ranges: [number, number][] = []
  let run: number[] = []
  for (const line of lines.slice(hi + 1)) {
    const p = line.split(',')
    if (p.length <= Math.max(msI, spI)) continue
    const ms = Number(p[msI]), sp = Number(p[spI])
    if (!Number.isFinite(ms) || !Number.isFinite(sp)) continue
    if (sp >= 4) run.push(ms)
    else {
      if (run.length >= minRunS) ranges.push([run[0], run[run.length - 1]])
      run = []
    }
  }
  if (run.length >= minRunS) ranges.push([run[0], run[run.length - 1]])
  return ranges
}

/**
 * Milliseconds to add to the tracker's millis() clock to get UTC, from the
 * track CSV rows that carry both (`ms` and the GPS `timestamp`). The median
 * absorbs the sub-second jitter of when each row was written. Null when the
 * file has no such rows.
 */
export function trackClockOffset(csv: string): number | null {
  const lines = csv.split(/\r?\n/)
  const hi = lines.findIndex(l => /(^|,)\s*ms\s*,/i.test(l))
  if (hi < 0) return null
  const head = lines[hi].split(',').map(h => h.trim().toLowerCase())
  const msI = head.indexOf('ms'), tI = head.indexOf('timestamp')
  if (msI < 0 || tI < 0) return null
  const offsets: number[] = []
  for (const line of lines.slice(hi + 1)) {
    const p = line.split(',')
    const ms = Number(p[msI]), t = Date.parse(p[tI] ?? '')
    if (p[tI] && Number.isFinite(ms) && Number.isFinite(t)) offsets.push(t - ms)
  }
  return median(offsets)
}

/**
 * Puts the stroke rate series onto the track's points: each point gets the
 * value of the window centred nearest it, within half a step. Points in a gap
 * (a rest, an unclear stretch) get none. A rate the source file already
 * carries is never replaced.
 */
export function withStrokeRate<T extends { timestamp: Date; strokeRate?: number }>(
  track: T[], series: StrokeRatePoint[], clockOffsetMs: number, stepS = SERIES_STEP_S,
): T[] {
  if (series.length === 0) return track
  const half = (stepS * 1000) / 2
  let j = 0
  return track.map(p => {
    if (p.strokeRate != null) return p
    const ms = p.timestamp.getTime() - clockOffsetMs
    while (j + 1 < series.length && Math.abs(series[j + 1].ms - ms) <= Math.abs(series[j].ms - ms)) j++
    return Math.abs(series[j].ms - ms) <= half ? { ...p, strokeRate: series[j].strokesPerMin } : p
  })
}

/**
 * Decimates a sidecar to `targetHz`, preserving the header.
 *
 * The device keeps the full 50 Hz stream on its card; only this reduction is
 * uploaded, which is what keeps an hour-long paddle inside the upload cap instead
 * of needing a chunked or presigned-S3 path for 8 MB.
 *
 * 10 Hz is not an arbitrary round number. Measured against a real 65-minute
 * session (reference: 58.0 spm from the full 50 Hz stream):
 *
 *   25 Hz   3.78 MB/h   58.1 spm   +0.2%   (over the upload cap)
 *   10 Hz   1.51 MB/h   57.7 spm   -0.5%   <- chosen
 *    8 Hz   1.26 MB/h   46.5 spm  -19.8%
 *    5 Hz   0.76 MB/h   50.6 spm  -12.8%
 *
 * The collapse below 10 Hz is lag quantisation, not lost signal: at 5 Hz one
 * autocorrelation lag step is ~10% of a stroke period, and the peak can no longer
 * be located between steps. Do not lower this to save bytes without re-running
 * that sweep.
 */
export function decimateMotionCsv(csv: string, targetHz = 10): string {
  const lines = csv.split(/\r?\n/).filter(l => l.trim() !== '')
  if (lines.length === 0) return ''
  const head = Number(lines[0].split(',')[0])
  const hasHeader = !Number.isFinite(head)
  const header = hasHeader ? lines[0] : null
  const body = hasHeader ? lines.slice(1) : lines

  const ms = (l: string) => Number(l.split(',')[0])
  const deltas: number[] = []
  for (let i = 1; i < Math.min(body.length, 2000); i++) {
    const d = ms(body[i]) - ms(body[i - 1])
    if (Number.isFinite(d) && d > 0) deltas.push(d)
  }
  const step = median(deltas)
  const fs = step && step > 0 ? 1000 / step : targetHz
  const factor = Math.max(1, Math.round(fs / targetHz))

  const kept = factor > 1 ? body.filter((_, i) => i % factor === 0) : body
  return [...(header ? [header] : []), ...kept].join('\n') + '\n'
}
