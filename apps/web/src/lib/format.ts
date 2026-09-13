// Display helpers for pace and speed indicators.
// Pure functions — no storage impact. Display-only.

// Pace per 500 m: how long it takes to cover 500 metres at the average speed
// over `distanceMetres`. Returned as a formatted string like "2:08.4".
export function paceFor500m(distanceMetres: number, elapsedSeconds: number): string {
  if (distanceMetres <= 0 || elapsedSeconds <= 0) return '—'
  const secondsPer500 = (elapsedSeconds / distanceMetres) * 500
  return formatMinSec(secondsPer500)
}

// Speed in km/h, formatted as "12.4 km/h".
export function speedKmh(distanceMetres: number, elapsedSeconds: number): string {
  if (distanceMetres <= 0 || elapsedSeconds <= 0) return '—'
  const kmh = (distanceMetres / 1000) / (elapsedSeconds / 3600)
  return `${kmh.toFixed(1)} km/h`
}

// Speed in m/s, formatted as "3.45 m/s".
export function speedMs(distanceMetres: number, elapsedSeconds: number): string {
  if (distanceMetres <= 0 || elapsedSeconds <= 0) return '—'
  return `${(distanceMetres / elapsedSeconds).toFixed(2)} m/s`
}

// "m:ss.s" — minutes, seconds with one decimal place.
function formatMinSec(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds - mins * 60
  return `${mins}:${secs.toFixed(1).padStart(4, '0')}`
}

// Returns the UTC calendar date (YYYY-MM-DD) of a Date or ISO timestamp.
// Used for the date-discrepancy check between user-chosen race date and the
// timestamp recorded in the GPS trace.
export function utcDateString(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value)
  return d.toISOString().slice(0, 10)
}
