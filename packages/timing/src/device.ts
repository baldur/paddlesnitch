// Diagnostics for a raw paddle-tracker CSV (see docs/features/device-data.md).
// This does NOT replace parseCsv (which extracts the track for analysis) — it
// describes what the file contains and, honestly, what can and can't be derived
// from it, so the Devices page can surface all the data and the true stroke-rate
// picture without inventing anything.
import { haversine } from './geo'

export type StrokeRateVerdict = { available: boolean; reason: string }

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

  // Honest stroke-rate verdict.
  let strokeRate: StrokeRateVerdict
  const hasSrValues = srI >= 0 && rows.some(r => cell(r, srI) !== '')
  if (hasSrValues) {
    strokeRate = { available: true, reason: 'A stroke-rate/cadence column is present — used directly.' }
  } else if (hasImu) {
    strokeRate = {
      available: false,
      reason: 'Not derivable: this firmware logs a per-second accelerometer peak at 1 Hz, which cannot yield cadence (a 0.5–2 Hz stroke needs >4 Hz sampling). Add a device-side "strokerate" column, or upload raw 50 Hz IMU.',
    }
  } else {
    strokeRate = { available: false, reason: 'No stroke-rate column and no accelerometer data.' }
  }

  const looksUsable = fixed.length >= 2 && movementDistanceM >= 50 && (timeSpanS ?? 0) >= 60

  const sampleRows = rows.slice(0, 5).map(r => Object.fromEntries(header.map((h, i) => [h, cell(r, i)])))

  return {
    columns: header, rows: rows.length, fixedRows: fixed.length, noFixRows,
    timeSpanS, movementDistanceM: Math.round(movementDistanceM), hasImu, hasGyro,
    strokeRate, looksUsable, sampleRows,
  }
}
