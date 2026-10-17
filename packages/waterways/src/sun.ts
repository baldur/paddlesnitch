// Sunrise and sunset (NOAA's simplified solar position, good to a minute or
// two at UK and Irish latitudes), for flagging stops reached in the dark.
// Pure: runs in the browser as pace and start time change.
import type { LatLng } from './types'

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

/** Sunrise and sunset (ISO, UTC) on the UTC calendar day of `when`, at `at`.
 *  Null for a day the sun doesn't rise or set (never at these latitudes). */
export function sunTimes(when: string | Date, at: LatLng): { sunrise: string; sunset: string } | null {
  const d = new Date(when)
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const n = Math.floor((day - Date.UTC(2000, 0, 1, 12)) / 86_400_000) + 1   // days since J2000.0
  const [lat, lng] = at
  const jStar = n - lng / 360
  const m = (357.5291 + 0.98560028 * jStar) % 360
  const c = 1.9148 * Math.sin(rad(m)) + 0.02 * Math.sin(rad(2 * m)) + 0.0003 * Math.sin(rad(3 * m))
  const lambda = (m + c + 180 + 102.9372) % 360
  const jTransit = 2451545 + jStar + 0.0053 * Math.sin(rad(m)) - 0.0069 * Math.sin(rad(2 * lambda))
  const decl = Math.asin(Math.sin(rad(lambda)) * Math.sin(rad(23.44)))
  const cosH = (Math.sin(rad(-0.833)) - Math.sin(rad(lat)) * Math.sin(decl)) / (Math.cos(rad(lat)) * Math.cos(decl))
  if (cosH < -1 || cosH > 1) return null
  const h = deg(Math.acos(cosH)) / 360
  const toIso = (jd: number) => new Date((jd - 2440587.5) * 86_400_000).toISOString()
  return { sunrise: toIso(jTransit - h), sunset: toIso(jTransit + h) }
}

/** Is `when` outside daylight at `at`? */
export function inDark(when: string, at: LatLng): boolean {
  const s = sunTimes(when, at)
  if (!s) return false
  const t = Date.parse(when)
  return t < Date.parse(s.sunrise) || t > Date.parse(s.sunset)
}
