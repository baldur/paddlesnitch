// Boat attitude — how level the boat sat, and how evenly it rocked — from the
// motion sidecar. This is Phase 2 of docs/motion-capture-spec.md.
//
// What each discipline wants from this is different, so the report carries both
// rather than a single "good/bad" score:
//   - Rowing: the hull should stay LEVEL side to side. `rollRmsDeg` is the metric;
//     lower is better.
//   - Kayaking: the hull is SUPPOSED to rock with the stroke. What matters is that
//     it rocks EVENLY, so `symmetry.imbalancePct` is the metric; nearer zero is
//     better, and a large `rollRmsDeg` is not itself a fault.
//
// Three things make this harder than it looks, and each is handled explicitly:
//
//  1. The mounting is unknown. Device axes are not boat axes — the tracker may be
//     on a deck, in a pocket, any way up. So "down" is learned from the session's
//     own mean gravity vector, and the roll axis is learned by PCA over the tilt
//     rather than assumed to be some particular sensor axis.
//  2. The accelerometer alone is not enough. During paddling, stroke surge adds
//     linear acceleration that reads as tilt and inflates roll by ~40% (measured:
//     5.6 deg accel-only vs 4.0 deg fused on the same stretch). Gyro and accel are
//     fused: the gyro carries the stroke-rate oscillation, the accel anchors the
//     slow drift.
//  3. Sides cannot be named. With no magnetometer there is no heading, so which
//     side is port and which starboard is not recoverable. The report says side A
//     and side B, and the IMBALANCE between them, which is the part that means
//     something without a known mounting.
//
// One thing this deliberately does NOT claim to measure: a CONSTANT lean. A boat
// held 3 degrees down to one side the whole way is indistinguishable from a
// tracker mounted 3 degrees off, and nothing in the data separates them. Attitude
// is therefore measured about the session's own neutral, and `symmetry` describes
// whether the ROCKING is even — which is a real stroke fault — not whether the
// boat sat level in some absolute sense. Measuring a persistent list would need a
// known mounting or a deliberate calibration pose.

export type AttitudeSymmetry = {
  // Deliberately not "left"/"right": see note 3 above.
  sideADeg: number
  sideBDeg: number
  imbalancePct: number
}

// One time bucket of the whole session: the RANGE the boat swung through, not a
// sampled instant. Plain decimation would alias badly — the rocking is ~0.5 Hz,
// so any chart-sized downsample of it draws a waveform that was never there.
// Min/max per bucket is honest at every zoom level.
export type AttitudeBucket = {
  t: number        // ms, on the track CSV's own millis() clock
  rollMin: number
  rollMax: number
  pitchMin: number
  pitchMax: number
}

// A short window at FULL rate, so the actual shape of the stroke is visible —
// the envelope shows how much, this shows what it looks like.
export type AttitudeSample = { t: number; roll: number; pitch: number }

// Roll values binned for a distribution plot. Drawn mirrored, this is where an
// uneven stroke is obvious at a glance: the two lobes don't match.
export type RollHistogram = { binWidthDeg: number; bins: { centreDeg: number; count: number }[] }

export type AttitudeReport = {
  available: boolean
  reason: string
  sampleRateHz: number | null
  samples: number
  envelope: AttitudeBucket[]
  excerpt: AttitudeSample[]
  rollHistogram: RollHistogram | null
  rollRmsDeg: number | null
  pitchRmsDeg: number | null
  rollP5Deg: number | null
  rollP95Deg: number | null
  // A robust bound for plotting: the axis charts should scale to, so one lurch
  // doesn't flatten the rocking everything else is about.
  plotBoundDeg: number | null
  rollToPitchRatio: number | null
  // False when roll and pitch are too similar in magnitude to tell apart, which
  // makes the roll/pitch split guesswork. The rms figures still describe real
  // motion; only their LABELS become unreliable.
  axisConfident: boolean
  symmetry: AttitudeSymmetry | null
}

type Vec = [number, number, number]

const norm = (v: Vec): Vec => {
  const m = Math.hypot(v[0], v[1], v[2])
  return m > 0 ? [v[0] / m, v[1] / m, v[2] / m] : [0, 0, 0]
}
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const rms = (xs: number[]) => Math.sqrt(xs.reduce((a, b) => a + b * b, 0) / xs.length)
const pct = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))]
const r2 = (n: number) => Math.round(n * 100) / 100

// Complementary-filter time constant. Well below the ~0.5 Hz stroke oscillation,
// so the gyro carries the rocking and the accelerometer only corrects slow drift.
const TAU_S = 2.0
// Below this roll/pitch ratio the two axes are not meaningfully distinguishable.
const MIN_ANISOTROPY = 1.2
// Chart-sized, and small enough that the payload stays a few tens of KB.
const ENVELOPE_BUCKETS = 240
const EXCERPT_S = 30
const HISTOGRAM_BINS = 41   // odd, so one bin is centred on level

import { parseMotionCsv } from './cadence'

export function deriveAttitude(
  csv: string,
  opts: { movingRanges?: [number, number][] } = {},
): AttitudeReport {
  const none = (reason: string, fs: number | null, n: number): AttitudeReport => ({
    available: false, reason, sampleRateHz: fs, samples: n,
    envelope: [], excerpt: [], rollHistogram: null,
    rollRmsDeg: null, pitchRmsDeg: null, rollP5Deg: null, rollP95Deg: null, plotBoundDeg: null,
    rollToPitchRatio: null, axisConfident: false, symmetry: null,
  })

  const all = parseMotionCsv(csv)
  if (all.length < 128) return none('Motion file has too few samples to describe attitude.', null, all.length)

  const steps: number[] = []
  for (let i = 1; i < Math.min(all.length, 2000); i++) steps.push(all[i].ms - all[i - 1].ms)
  const positive = steps.filter(d => d > 0).sort((a, b) => a - b)
  const step = positive.length ? positive[Math.floor(positive.length / 2)] : 0
  const fs = step > 0 ? 1000 / step : 0
  if (fs < 2) return none('Motion data is sampled too slowly to describe attitude.', fs || null, all.length)

  // Only where the boat was actually moving: attitude while parked at the launch
  // describes someone shifting their weight on a stationary hull, not paddling.
  const ranges = opts.movingRanges
  const seg = ranges?.length ? all.filter(s => ranges.some(([a, b]) => s.ms >= a && s.ms <= b)) : all
  if (seg.length < 128) return none('No moving stretch long enough to describe attitude.', fs, seg.length)

  // "Down" for this mounting, learned from the session itself.
  const g0 = norm([mean(seg.map(s => s.ax)), mean(seg.map(s => s.ay)), mean(seg.map(s => s.az))])
  if (Math.hypot(g0[0], g0[1], g0[2]) === 0) return none('No usable gravity reference in the motion data.', fs, seg.length)

  // Any orthonormal basis for the plane perpendicular to gravity. Which one does
  // not matter — PCA below finds the real roll axis inside it.
  const ref: Vec = Math.abs(g0[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const e1 = norm(cross(g0, ref))
  const e2 = norm(cross(g0, e1))

  const dt = 1 / fs
  const alpha = TAU_S / (TAU_S + dt)
  const tilt: [number, number][] = []
  let fx = 0, fy = 0
  for (const s of seg) {
    const a = norm([s.ax, s.ay, s.az])
    const t = cross(g0, a)                       // small-angle tilt, perpendicular to g0
    const ax = dot(t, e1), ay = dot(t, e2)
    const w: Vec = [(s.gx * Math.PI) / 180, (s.gy * Math.PI) / 180, (s.gz * Math.PI) / 180]
    // d(tilt)/dt = -omega_perp, componentwise on this basis.
    fx = alpha * (fx - dot(w, e1) * dt) + (1 - alpha) * ax
    fy = alpha * (fy - dot(w, e2) * dt) + (1 - alpha) * ay
    tilt.push([fx, fy])
  }

  // PCA: the axis the tilt swings along hardest is the roll axis.
  const mx = mean(tilt.map(p => p[0])), my = mean(tilt.map(p => p[1]))
  let sxx = 0, syy = 0, sxy = 0
  for (const [x, y] of tilt) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my) }
  sxx /= tilt.length; syy /= tilt.length; sxy /= tilt.length
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const half = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy ** 2)
  const l1 = (sxx + syy) / 2 + half
  const l2 = (sxx + syy) / 2 - half
  const anisotropy = l2 > 0 ? Math.sqrt(l1 / l2) : Infinity

  const c = Math.cos(th), s = Math.sin(th)
  const clamp = (v: number) => Math.max(-1, Math.min(1, v))
  const deg = (v: number) => (Math.asin(clamp(v)) * 180) / Math.PI
  const roll = tilt.map(([x, y]) => deg((x - mx) * c + (y - my) * s))
  const pitchArr = tilt.map(([x, y]) => deg(-(x - mx) * s + (y - my) * c))

  const rollSorted = [...roll].sort((a, b) => a - b)
  const pitchSorted = [...pitchArr].sort((a, b) => a - b)
  const posv = roll.filter(v => v > 0).sort((a, b) => a - b)
  const negv = roll.filter(v => v < 0).sort((a, b) => a - b)
  let symmetry: AttitudeSymmetry | null = null
  if (posv.length > 20 && negv.length > 20) {
    // p95 of each side's excursion, not the max: a single lurch is not a habit.
    const sideA = pct(posv, 0.95)
    const sideB = -pct(negv, 0.05)
    const avg = (sideA + sideB) / 2
    symmetry = {
      sideADeg: r2(sideA),
      sideBDeg: r2(sideB),
      imbalancePct: avg > 0 ? r2(((sideA - sideB) / avg) * 100) : 0,
    }
  }

  const rollRms = rms(roll)
  const pitchRms = rms(pitchArr)

  // --- Envelope: min/max per bucket across the whole session.
  const buckets = Math.min(ENVELOPE_BUCKETS, seg.length)
  const per = Math.ceil(seg.length / buckets)
  const envelope: AttitudeBucket[] = []
  for (let i = 0; i < seg.length; i += per) {
    const end = Math.min(seg.length, i + per)
    let rMin = Infinity, rMax = -Infinity, pMin = Infinity, pMax = -Infinity
    for (let j = i; j < end; j++) {
      if (roll[j] < rMin) rMin = roll[j]
      if (roll[j] > rMax) rMax = roll[j]
      if (pitchArr[j] < pMin) pMin = pitchArr[j]
      if (pitchArr[j] > pMax) pMax = pitchArr[j]
    }
    envelope.push({ t: seg[i].ms, rollMin: r2(rMin), rollMax: r2(rMax), pitchMin: r2(pMin), pitchMax: r2(pMax) })
  }

  // --- Excerpt: the most REPRESENTATIVE window, not simply the middle. The
  // middle of a session can land on a turn or a drink break, which then reads as
  // "this is what your stroke looks like".
  const excerptLen = Math.min(seg.length, Math.round(EXCERPT_S * fs))
  let bestStart = 0
  let bestDelta = Infinity
  for (let i = 0; i + excerptLen <= seg.length; i += Math.max(1, Math.floor(excerptLen / 2))) {
    const windowRms = rms(roll.slice(i, i + excerptLen))
    const delta = Math.abs(windowRms - rollRms)
    if (delta < bestDelta) { bestDelta = delta; bestStart = i }
  }
  const excerpt: AttitudeSample[] = []
  for (let i = bestStart; i < bestStart + excerptLen; i++) {
    excerpt.push({ t: seg[i].ms, roll: r2(roll[i]), pitch: r2(pitchArr[i]) })
  }

  // --- Roll distribution. Drawn mirrored, an uneven stroke shows as lobes that
  // don't match.
  //
  // Binned across a ROBUST range, not the extremes. A real session contains the
  // odd lurch — a wobble, a passing wash — and on a 65-minute trace one 20 deg
  // spike against a 6 deg working range would squeeze the whole distribution into
  // a third of the axis and hide the thing being looked at. Values beyond the
  // range land in the end bins, so nothing is discarded, only the scale is sane.
  const absMax = Math.max(
    Math.abs(pct(rollSorted, 0.01)),
    Math.abs(pct(rollSorted, 0.99)),
    1,
  )
  const binWidth = (2 * absMax) / HISTOGRAM_BINS
  const counts = new Array(HISTOGRAM_BINS).fill(0)
  for (const v of roll) {
    const idx = Math.min(HISTOGRAM_BINS - 1, Math.max(0, Math.floor((v + absMax) / binWidth)))
    counts[idx]++
  }
  const rollHistogram: RollHistogram = {
    binWidthDeg: r2(binWidth),
    bins: counts.map((count, i) => ({ centreDeg: r2(-absMax + (i + 0.5) * binWidth), count })),
  }

  return {
    envelope,
    excerpt,
    rollHistogram,
    available: true,
    reason: `From ${seg.length.toLocaleString('en-GB')} moving samples at ${Math.round(fs)} Hz.`,
    sampleRateHz: r2(fs),
    samples: seg.length,
    rollRmsDeg: r2(rollRms),
    pitchRmsDeg: r2(pitchRms),
    rollP5Deg: r2(pct(rollSorted, 0.05)),
    rollP95Deg: r2(pct(rollSorted, 0.95)),
    plotBoundDeg: r2(Math.max(absMax, Math.abs(pct(pitchSorted, 0.01)), Math.abs(pct(pitchSorted, 0.99)), 1) * 1.1),
    rollToPitchRatio: pitchRms > 0 ? r2(rollRms / pitchRms) : null,
    axisConfident: anisotropy >= MIN_ANISOTROPY,
    symmetry,
  }
}
