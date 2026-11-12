// Where to look in a clip: points every so many metres of travel, coarse to fine.
// Pure; tested in stations.test.ts.
//
// Level 0 is a point every `base` metres paddled; level k adds the points halfway
// between level k-1's, so every level halves the spacing without repeating a
// point. Working level by level over all the footage gives the whole river at
// 100 m first, then 50, 25 and 12.5 m for as long as the model is left running.

export type Fix = { ft: number; lat: number; lng: number; speed: number }
export type Station = { level: number; n: number; ft: number; lat: number; lng: number; heading: number; speed: number }

const R = 6371008.8
const rad = (d: number) => (d * Math.PI) / 180
export function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Compass bearing from a to b, degrees 0..360. */
export function bearing(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat))
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng))
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** The point `d` metres from `p` along compass `deg`. */
export function destination(p: { lat: number; lng: number }, deg: number, d: number): { lat: number; lng: number } {
  const dr = d / R
  const b = rad(deg)
  const lat1 = rad(p.lat)
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dr) + Math.cos(lat1) * Math.sin(dr) * Math.cos(b))
  const lng2 = rad(p.lng) + Math.atan2(Math.sin(b) * Math.sin(dr) * Math.cos(lat1), Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2))
  return { lat: (lat2 * 180) / Math.PI, lng: (((lng2 * 180) / Math.PI + 540) % 360) - 180 }
}

/**
 * Metres travelled at each fix, counting a move only once the boat is `gate` m
 * from where it last counted one. Sitting still, GPS scatter would otherwise add
 * up to hundreds of metres and fill the stops with identical looks.
 */
export function travelled(fixes: Fix[], gate = 3): number[] {
  const out: number[] = []
  let total = 0
  let anchor = fixes[0]
  for (const f of fixes) {
    const d = haversine(anchor, f)
    if (d >= gate) { total += d; anchor = f }
    out.push(total)
  }
  return out
}

/** The stations of one level: the first fix past each of its distances, with the boat's heading there. */
export function stationsAt(fixes: Fix[], cum: number[], base: number, level: number): Station[] {
  if (fixes.length < 2) return []
  const spacing = base / 2 ** level
  const out: Station[] = []
  let i = 0
  for (let n = level === 0 ? 0 : 1; n * spacing <= cum[cum.length - 1]; n += level === 0 ? 1 : 2) {
    const d = n * spacing
    while (i < fixes.length - 1 && cum[i] < d) i++
    out.push({ level, n, ft: fixes[i].ft, lat: fixes[i].lat, lng: fixes[i].lng, heading: headingAt(fixes, cum, i), speed: fixes[i].speed })
  }
  return out
}

/** Heading over the 10 m either side of fix i (GPS jitter swamps a fix-to-fix bearing). */
export function headingAt(fixes: Fix[], cum: number[], i: number, span = 10): number {
  let a = i
  let b = i
  while (a > 0 && cum[i] - cum[a] < span) a--
  while (b < fixes.length - 1 && cum[b] - cum[i] < span) b++
  return a === b ? 0 : bearing(fixes[a], fixes[b])
}
