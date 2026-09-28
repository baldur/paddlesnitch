import type { TrackPoint } from './types'

function findCol(headers: string[], ...candidates: string[]): number {
  for (const c of candidates) {
    const norm = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '')
    const idx = headers.findIndex(h => norm(h) === norm(c))
    if (idx !== -1) return idx
  }
  return -1
}

function parseTimestamp(val: string): Date | null {
  const s = val.trim()
  // Unix seconds
  if (/^\d{9,11}$/.test(s)) return new Date(parseInt(s) * 1000)
  // Unix milliseconds
  if (/^\d{12,14}$/.test(s)) return new Date(parseInt(s))
  // ISO 8601 or "YYYY-MM-DD HH:MM:SS"
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'))
  return isNaN(d.getTime()) ? null : d
}

export function parseCsv(text: string): TrackPoint[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))

  const latI = findCol(headers, 'lat', 'latitude', 'positionlat')
  const lngI = findCol(headers, 'lon', 'lng', 'long', 'longitude', 'positionlong')
  const timeI = findCol(headers, 'time', 'timestamp', 'datetime', 'date')

  if (latI === -1 || lngI === -1 || timeI === -1) return []

  // HR columns are ignored. Stroke rate (cadence) IS captured (#143) — exporters
  // label it every which way: cadence, cad, stroke rate, spm, sr. (findCol
  // normalises away spaces/underscores/case, so "Stroke Rate" == "strokerate".)
  const rateI = findCol(headers, 'strokerate', 'cadence', 'cad', 'spm', 'sr')

  const points: TrackPoint[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''))

    const lat = parseFloat(cols[latI] ?? '')
    const lng = parseFloat(cols[lngI] ?? '')
    const timestamp = parseTimestamp(cols[timeI] ?? '')

    if (!isFinite(lat) || !isFinite(lng) || !timestamp) continue
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue

    const strokeRate = rateI !== -1 ? parseFloat(cols[rateI] ?? '') : NaN

    points.push({ lat, lng, timestamp, ...(isFinite(strokeRate) ? { strokeRate } : {}) })
  }

  return points
}

// A track as the CSV parseCsv reads back: time, position, stroke rate, nothing
// else. This is what a time-trial entry keeps instead of the uploaded file,
// which can carry heart rate and device serial numbers the privacy page
// promises we never store.
export function trackToCsv(track: TrackPoint[]): string {
  const rows = ['timestamp,lat,lon,strokerate']
  for (const p of track) {
    rows.push(`${p.timestamp.toISOString()},${p.lat},${p.lng},${p.strokeRate ?? ''}`)
  }
  return rows.join('\n') + '\n'
}
