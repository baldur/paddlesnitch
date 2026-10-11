// Ordnance Survey National Grid → WGS84 lat/lng.
//
// OS Open Rivers stores eastings/northings and GOV.UK lock pages give grid
// references like "SU 72735 73533". Both are on OSGB36 (Airy 1830 ellipsoid,
// transverse Mercator). We invert the projection, then shift datum to WGS84
// with the standard 7-parameter Helmert transform — accurate to ~5 m, well
// inside what a lock position needs. (OSTN15 would give cm accuracy but needs
// a 15 MB grid file.)
//
// Formulae: OS "A guide to coordinate systems in Great Britain", annex C.
import type { LatLng } from './types'

const AIRY = { a: 6377563.396, b: 6356256.909 }
const WGS84 = { a: 6378137, b: 6356752.3141 }
const F0 = 0.9996012717
const LAT0 = (49 * Math.PI) / 180
const LON0 = (-2 * Math.PI) / 180
const N0 = -100000
const E0 = 400000

/** "SU 72735 73533" / "SU7273573533" / "SU727735" → [easting, northing] in metres. */
export function gridRefToEN(ref: string): [number, number] | null {
  const m = ref.toUpperCase().replace(/\s+/g, '').match(/^([HJNOST])([A-HJ-Z])(\d*)$/)
  if (!m || m[3].length % 2 !== 0 || m[3].length > 10) return null
  // Letter → index in the 5×5 grid that skips I.
  const idx = (c: string) => { const i = c.charCodeAt(0) - 65; return i > 7 ? i - 1 : i }
  const l1 = idx(m[1]), l2 = idx(m[2])
  // 500 km square then 100 km square, false origin at square SV.
  const e100 = ((l1 - 2) % 5) * 5 + (l2 % 5)
  const n100 = 19 - Math.floor(l1 / 5) * 5 - Math.floor(l2 / 5)
  const half = m[3].length / 2
  const scale = 10 ** (5 - half)
  const e = half ? Number(m[3].slice(0, half)) * scale : 0
  const n = half ? Number(m[3].slice(half)) * scale : 0
  return [e100 * 100000 + e, n100 * 100000 + n]
}

/** OSGB36 easting/northing → WGS84 [lat, lng] (degrees). */
export function enToLatLng(E: number, N: number): LatLng {
  const { a, b } = AIRY
  const e2 = 1 - (b * b) / (a * a)
  const n = (a - b) / (a + b), n2 = n * n, n3 = n2 * n

  // Iterate for latitude until the meridional arc matches the northing.
  let lat = LAT0, M = 0
  do {
    lat = (N - N0 - M) / (a * F0) + lat
    const dl = lat - LAT0, sl = lat + LAT0
    M = b * F0 * (
      (1 + n + (5 / 4) * n2 + (5 / 4) * n3) * dl
      - (3 * n + 3 * n2 + (21 / 8) * n3) * Math.sin(dl) * Math.cos(sl)
      + ((15 / 8) * n2 + (15 / 8) * n3) * Math.sin(2 * dl) * Math.cos(2 * sl)
      - (35 / 24) * n3 * Math.sin(3 * dl) * Math.cos(3 * sl)
    )
  } while (Math.abs(N - N0 - M) >= 0.00001)

  const sin = Math.sin(lat), cos = Math.cos(lat), tan = Math.tan(lat)
  const nu = (a * F0) / Math.sqrt(1 - e2 * sin * sin)
  const rho = (a * F0 * (1 - e2)) / Math.pow(1 - e2 * sin * sin, 1.5)
  const eta2 = nu / rho - 1
  const t2 = tan * tan, t4 = t2 * t2, t6 = t4 * t2
  const sec = 1 / cos
  const VII = tan / (2 * rho * nu)
  const VIII = (tan / (24 * rho * nu ** 3)) * (5 + 3 * t2 + eta2 - 9 * t2 * eta2)
  const IX = (tan / (720 * rho * nu ** 5)) * (61 + 90 * t2 + 45 * t4)
  const X = sec / nu
  const XI = (sec / (6 * nu ** 3)) * (nu / rho + 2 * t2)
  const XII = (sec / (120 * nu ** 5)) * (5 + 28 * t2 + 24 * t4)
  const XIIA = (sec / (5040 * nu ** 7)) * (61 + 662 * t2 + 1320 * t4 + 720 * t6)
  const dE = E - E0
  const phi = lat - VII * dE ** 2 + VIII * dE ** 4 - IX * dE ** 6
  const lambda = LON0 + X * dE - XI * dE ** 3 + XII * dE ** 5 - XIIA * dE ** 7

  return helmertOsgbToWgs84(phi, lambda)
}

function helmertOsgbToWgs84(phi: number, lambda: number): LatLng {
  // OSGB36 geodetic → cartesian (height 0).
  const ea2 = 1 - (AIRY.b * AIRY.b) / (AIRY.a * AIRY.a)
  const nu = AIRY.a / Math.sqrt(1 - ea2 * Math.sin(phi) ** 2)
  const x1 = nu * Math.cos(phi) * Math.cos(lambda)
  const y1 = nu * Math.cos(phi) * Math.sin(lambda)
  const z1 = nu * (1 - ea2) * Math.sin(phi)

  // OSGB36 → WGS84 (the inverse of the OS-published WGS84 → OSGB36 set).
  const tx = 446.448, ty = -125.157, tz = 542.06
  const s = -20.4894e-6
  const sec = Math.PI / (180 * 3600)
  const rx = 0.1502 * sec, ry = 0.247 * sec, rz = 0.8421 * sec
  const x2 = tx + (1 + s) * x1 - rz * y1 + ry * z1
  const y2 = ty + rz * x1 + (1 + s) * y1 - rx * z1
  const z2 = tz - ry * x1 + rx * y1 + (1 + s) * z1

  // Cartesian → WGS84 geodetic.
  const eb2 = 1 - (WGS84.b * WGS84.b) / (WGS84.a * WGS84.a)
  const p = Math.sqrt(x2 * x2 + y2 * y2)
  let lat = Math.atan2(z2, p * (1 - eb2)), prev = 2 * Math.PI
  while (Math.abs(lat - prev) > 1e-12) {
    const nu2 = WGS84.a / Math.sqrt(1 - eb2 * Math.sin(lat) ** 2)
    prev = lat
    lat = Math.atan2(z2 + eb2 * nu2 * Math.sin(lat), p)
  }
  const lng = Math.atan2(y2, x2)
  return [(lat * 180) / Math.PI, (lng * 180) / Math.PI]
}

/** A grid reference straight to WGS84, or null when it doesn't parse. */
export function gridRefToLatLng(ref: string): LatLng | null {
  const en = gridRefToEN(ref)
  return en ? enToLatLng(en[0], en[1]) : null
}
