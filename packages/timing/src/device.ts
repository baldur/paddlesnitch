// Diagnostics for a raw paddle-tracker CSV (see docs/features/device-data.md).
// This does NOT replace parseCsv (which extracts the track for analysis) — it
// describes what the file contains and, honestly, what can and can't be derived
// from it, so the Devices page can surface all the data and the true stroke-rate
// picture without inventing anything.
import { haversine } from './geo'

export type StrokeRateVerdict = {
  available: boolean
  reason: string
  // What THIS file measured, when it carries motion data — the general reason
  // stays a claim until the numbers behind it are on the page.
  evidence: string | null
}

// Did a row actually arrive every sampling interval? A trace can look complete
// on duration alone while quietly dropping rows — on a real 60-minute session
// the periodic SD work steals one row every few minutes, and nothing else surfaces it.
export type RowCapture = {
  intervalS: number | null   // the interval actually observed (median), never assumed
  expectedRows: number       // rows that interval should have produced over the span
  missingRows: number
  gaps: number               // runs of missing rows, however long each run is
  longestGapS: number
  capturedFraction: number   // 0..1
}

// GNSS health across the session. A cold receiver converges as it goes, so the
// opening minutes of any trace are the least trustworthy — worth saying out loud.
export type GnssQuality = {
  satsFirst: number | null
  satsLast: number | null
  satsMin: number | null
  satsMax: number | null
  hdopFirst: number | null
  hdopLast: number | null
  hdopMedian: number | null
  fixTrend: 'improving' | 'steady' | 'degrading' | null
  altitudeSpreadM: number | null  // GPS altitude wander; on flat water this is pure noise
}

// What the IMU peaks measured, split by whether the device was moving. The split
// is the whole point: handling the device off the water dwarfs anything paddling
// produces, which is exactly why a 1 Hz peak cannot yield cadence.
export type MotionEnvelope = {
  gyroPeakMedian: number | null
  gyroPeakMax: number | null
  gyroPeakMaxMoving: number | null
  // The paddling ceiling, robustly. A bare max is hostage to the launch/landing
  // seconds, where the GPS still reports a km/h or two while the device is being
  // handled — one such row drags maxMoving up by an order of magnitude.
  gyroPeakP99Moving: number | null
  gyroPeakMaxStationary: number | null
  accelPeakMax: number | null
  accelPeakMaxMoving: number | null
  movingSamples: number
  stationarySamples: number
}

// A column the firmware writes but never fills in — present in the header, and so
// easy to believe in, carrying nothing. batt_mv is the live example.
export type DeadColumn = { name: string; kind: 'empty' | 'zero' }

export type DeviceDataReport = {
  columns: string[]          // every column present, in file order
  rows: number               // data rows (excluding header)
  fixedRows: number          // rows with a real GNSS fix (lat+lon present)
  noFixRows: number
  timeSpanS: number | null   // first→last fixed timestamp
  movementDistanceM: number  // movement-GATED distance (never a raw fix sum)
  hasImu: boolean
  hasGyro: boolean
  strokeRate: StrokeRateVerdict
  capture: RowCapture
  gnss: GnssQuality
  motion: MotionEnvelope | null  // null when the file carries no IMU peak columns
  deadColumns: DeadColumn[]
  // A power-on is not a paddle: true only if something looks like real activity.
  looksUsable: boolean
  sampleRows: Record<string, string>[]  // first few raw rows, for display
}

// The spec's movement gate: only count a segment as travel when it moved at
// least this far AND was going at least this fast — GNSS scatter on a stationary
// device otherwise "invents" ~115 m of distance.
const MIN_SEG_M = 3
const MIN_SPEED_KMH = 1.5

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_]/g, '')
// parseCsv's stroke-rate aliases — if the device (or a future firmware) emits one
// of these, cadence is available for free with no server change.
const SR_ALIASES = new Set(['strokerate', 'cadence', 'spm', 'sr', 'cad'])

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const percentile = (xs: number[], p: number): number | null => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]
}
const round = (n: number, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp

function splitRows(csv: string): { header: string[]; rows: string[][] } {
  const lines = csv.split(/\r?\n/).filter(l => l.trim() !== '')
  if (lines.length === 0) return { header: [], rows: [] }
  const header = lines[0].split(',').map(c => c.trim())
  const rows = lines.slice(1).map(l => l.split(','))
  return { header, rows }
}

export function describeDeviceData(csv: string): DeviceDataReport {
  const { header, rows } = splitRows(csv)
  const idx = (pred: (n: string) => boolean) => header.findIndex(h => pred(norm(h)))
  const latI = idx(n => n === 'lat' || n === 'latitude')
  const lonI = idx(n => n === 'lon' || n === 'lng' || n === 'longitude')
  const timeI = idx(n => n === 'timestamp' || n === 'time' || n === 'datetime')
  const srI = idx(n => SR_ALIASES.has(n))
  const satsI = idx(n => n === 'sats' || n === 'satellites')
  const hdopI = idx(n => n === 'hdop')
  const altI = idx(n => n === 'altm' || n === 'alt' || n === 'altitude')
  const speedI = idx(n => n === 'speedkmh' || n === 'speed')
  // The 1 Hz peak columns specifically, not the instantaneous per-axis ones.
  const accelPeakI = idx(n => n.includes('accel') && n.includes('max'))
  const gyroPeakI = idx(n => n.includes('gyro') && n.includes('max'))
  const hasImu = header.some(h => /^a[xyz]|accel/i.test(norm(h)))
  const hasGyro = header.some(h => /^g[xyz]|gyro/i.test(norm(h)))

  const cell = (row: string[], i: number) => (i >= 0 && i < row.length ? row[i].trim() : '')
  const isFixed = (row: string[]) => cell(row, latI) !== '' && cell(row, lonI) !== ''

  const fixed = rows.filter(isFixed)
  const noFixRows = rows.length - fixed.length

  // Time span from the first/last fixed timestamp we can parse.
  let timeSpanS: number | null = null
  const times = fixed.map(r => Date.parse(cell(r, timeI))).filter(t => !isNaN(t))
  if (times.length >= 2) timeSpanS = Math.round((Math.max(...times) - Math.min(...times)) / 1000)

  // Movement-gated distance. ANCHOR-based, not per-row: at 1 Hz a normal paddle
  // (~8 km/h ≈ 2.2 m/row) is below the 3 m gate, so we accumulate displacement
  // from the last counted point and bank it once it clears 3 m AT ≥1.5 km/h.
  // Real paddling banks in ~3 m chunks; stationary scatter (bounded in a small
  // box, so slow) never clears the speed gate and is discarded — no invented
  // distance.
  let movementDistanceM = 0
  const pt = (r: string[]): [number, number] | null => {
    const la = Number(cell(r, latI)), lo = Number(cell(r, lonI))
    return isNaN(la) || isNaN(lo) ? null : [la, lo]
  }
  let anchor = fixed.length ? fixed[0] : null
  for (let i = 1; i < fixed.length; i++) {
    const a = anchor && pt(anchor), b = pt(fixed[i])
    if (!a || !b) { anchor = fixed[i]; continue }
    const d = haversine(a, b)
    const dt = (Date.parse(cell(fixed[i], timeI)) - Date.parse(cell(anchor!, timeI))) / 1000
    if (d >= MIN_SEG_M) {
      if (dt > 0 && (d / dt) * 3.6 >= MIN_SPEED_KMH) { movementDistanceM += d; anchor = fixed[i] }
      // else: drifted 3 m but too slowly to be travel — leave the anchor, keep waiting.
    }
  }

  // --- Row capture. Measured against the interval the file ACTUALLY samples at,
  // so this stays honest for a future firmware that logs at something else.
  const allTimes = rows.map(r => Date.parse(cell(r, timeI))).filter(t => !isNaN(t)).sort((a, b) => a - b)
  const deltas: number[] = []
  for (let i = 1; i < allTimes.length; i++) deltas.push((allTimes[i] - allTimes[i - 1]) / 1000)
  const intervalS = median(deltas.filter(d => d > 0))
  let gaps = 0, missingRows = 0, longestGapS = 0
  if (intervalS && intervalS > 0) {
    for (const d of deltas) {
      // Anything beyond 1.5 intervals is a dropped row, not jitter.
      if (d > intervalS * 1.5) {
        gaps++
        missingRows += Math.max(1, Math.round(d / intervalS) - 1)
        longestGapS = Math.max(longestGapS, d)
      }
    }
  }
  const expectedRows = intervalS && intervalS > 0 && allTimes.length >= 2
    ? Math.round((allTimes[allTimes.length - 1] - allTimes[0]) / 1000 / intervalS) + 1
    : rows.length
  const capture: RowCapture = {
    intervalS: intervalS == null ? null : round(intervalS, 2),
    expectedRows,
    missingRows,
    gaps,
    longestGapS: round(longestGapS),
    capturedFraction: expectedRows > 0 ? Math.min(1, round(rows.length / expectedRows, 4)) : 0,
  }

  // --- GNSS quality. Sampled over fixed rows only; a no-fix row's sats/hdop
  // describe the search, not the fix.
  const satsAll = satsI >= 0 ? fixed.map(r => Number(cell(r, satsI))).filter(v => !isNaN(v)) : []
  const hdopAll = hdopI >= 0 ? fixed.map(r => Number(cell(r, hdopI))).filter(v => !isNaN(v)) : []
  const altAll = altI >= 0 ? fixed.map(r => Number(cell(r, altI))).filter(v => !isNaN(v)) : []
  // Compare the opening and closing tenth rather than single rows — one row is noise.
  const edge = (xs: number[]) => Math.max(5, Math.floor(xs.length / 10))
  let fixTrend: GnssQuality['fixTrend'] = null
  if (hdopAll.length >= 20) {
    const n = edge(hdopAll)
    const first = median(hdopAll.slice(0, n))!, last = median(hdopAll.slice(-n))!
    fixTrend = last < first - 0.1 ? 'improving' : last > first + 0.1 ? 'degrading' : 'steady'
  }
  const gnss: GnssQuality = {
    satsFirst: satsAll.length ? satsAll[0] : null,
    satsLast: satsAll.length ? satsAll[satsAll.length - 1] : null,
    satsMin: satsAll.length ? Math.min(...satsAll) : null,
    satsMax: satsAll.length ? Math.max(...satsAll) : null,
    hdopFirst: hdopAll.length ? round(hdopAll[0], 2) : null,
    hdopLast: hdopAll.length ? round(hdopAll[hdopAll.length - 1], 2) : null,
    hdopMedian: hdopAll.length ? round(median(hdopAll)!, 2) : null,
    fixTrend,
    altitudeSpreadM: altAll.length >= 2 ? round(Math.max(...altAll) - Math.min(...altAll)) : null,
  }

  // --- Motion envelope, split by moving vs stationary. Needs a speed column to
  // make the split; without one we can still report the overall peaks.
  let motion: MotionEnvelope | null = null
  if (accelPeakI >= 0 || gyroPeakI >= 0) {
    const peak = (row: string[], i: number) => (i >= 0 ? Number(cell(row, i)) : NaN)
    const isMoving = (row: string[]) =>
      speedI >= 0 && !isNaN(Number(cell(row, speedI))) ? Number(cell(row, speedI)) >= MIN_SPEED_KMH : null
    const gyroAll: number[] = [], gyroMoving: number[] = [], gyroStill: number[] = []
    const accelAll: number[] = [], accelMoving: number[] = []
    let movingSamples = 0, stationarySamples = 0
    for (const r of rows) {
      const mv = isMoving(r)
      if (mv === true) movingSamples++
      else if (mv === false) stationarySamples++
      const g = peak(r, gyroPeakI)
      if (!isNaN(g)) {
        gyroAll.push(g)
        if (mv === true) gyroMoving.push(g)
        else if (mv === false) gyroStill.push(g)
      }
      const a = peak(r, accelPeakI)
      if (!isNaN(a)) {
        accelAll.push(a)
        if (mv === true) accelMoving.push(a)
      }
    }
    const maxOrNull = (xs: number[]) => (xs.length ? round(Math.max(...xs), 2) : null)
    motion = {
      gyroPeakMedian: gyroAll.length ? round(median(gyroAll)!, 2) : null,
      gyroPeakMax: maxOrNull(gyroAll),
      gyroPeakMaxMoving: maxOrNull(gyroMoving),
      gyroPeakP99Moving: gyroMoving.length ? round(percentile(gyroMoving, 0.99)!, 2) : null,
      gyroPeakMaxStationary: maxOrNull(gyroStill),
      accelPeakMax: maxOrNull(accelAll),
      accelPeakMaxMoving: maxOrNull(accelMoving),
      movingSamples,
      stationarySamples,
    }
  }

  // --- Columns the firmware writes but never fills. A column that is constant
  // at a NON-zero value (fix=1 all session) is good news, not a dead column —
  // only all-empty or all-zero counts.
  const deadColumns: DeadColumn[] = []
  if (rows.length > 0) {
    header.forEach((name, i) => {
      let anyValue = false, allZero = true
      for (const r of rows) {
        const v = cell(r, i)
        if (v === '') continue
        anyValue = true
        if (Number(v) !== 0) { allZero = false; break }
      }
      if (!anyValue) deadColumns.push({ name, kind: 'empty' })
      else if (allZero) deadColumns.push({ name, kind: 'zero' })
    })
  }

  // Honest stroke-rate verdict.
  let strokeRate: StrokeRateVerdict
  const hasSrValues = srI >= 0 && rows.some(r => cell(r, srI) !== '')
  if (hasSrValues) {
    strokeRate = {
      available: true,
      reason: 'A stroke-rate/cadence column is present — used directly.',
      evidence: null,
    }
  } else if (hasImu) {
    strokeRate = {
      available: false,
      reason: 'Not derivable: this firmware logs a per-second accelerometer peak at 1 Hz, which cannot yield cadence (a 0.5–2 Hz stroke needs >4 Hz sampling). Add a device-side "strokerate" column, or upload raw 50 Hz IMU.',
      evidence: motionEvidence(motion),
    }
  } else {
    strokeRate = { available: false, reason: 'No stroke-rate column and no accelerometer data.', evidence: null }
  }

  const looksUsable = fixed.length >= 2 && movementDistanceM >= 50 && (timeSpanS ?? 0) >= 60

  const sampleRows = rows.slice(0, 5).map(r => Object.fromEntries(header.map((h, i) => [h, cell(r, i)])))

  return {
    columns: header, rows: rows.length, fixedRows: fixed.length, noFixRows,
    timeSpanS, movementDistanceM: Math.round(movementDistanceM), hasImu, hasGyro,
    strokeRate, capture, gnss, motion, deadColumns, looksUsable, sampleRows,
  }
}

// Turns the measured envelope into the sentence that makes the verdict concrete:
// the gap between handling the device and paddling it is what a cadence signal
// would have to clear, and it doesn't come close.
function motionEvidence(m: MotionEnvelope | null): string | null {
  if (!m || m.gyroPeakMax == null) return null
  const moving = m.gyroPeakP99Moving
  if (moving == null || m.movingSamples === 0) {
    return `Peak rotation in this file reached ${m.gyroPeakMax} dps (median ${m.gyroPeakMedian} dps).`
  }
  const base = `Measured here: across ${m.movingSamples.toLocaleString('en-GB')} moving samples, 99% of per-second rotation peaks stayed under ${moving} dps (median ${m.gyroPeakMedian} dps).`
  const still = m.gyroPeakMaxStationary
  return still != null && still > moving
    ? `${base} Handling the device off the water hit ${still} dps in the same file — that gap is what a real cadence signal would have to clear.`
    : base
}
