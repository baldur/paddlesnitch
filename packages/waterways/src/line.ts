// Polyline helpers in [lat, lng]. Distances in metres.
//
// Projection uses a local equirectangular approximation around the query
// point: at river scale (segments of metres to a few km) the error is far
// below GPS and map accuracy, and it's much cheaper than great-circle maths.
import { haversine } from '@paddlesnitch/timing/geo'
import type { LatLng } from './types'

const M_PER_DEG_LAT = 111_320

/** Cumulative distance along the line at each vertex; [0, …, total]. */
export function cumulative(line: LatLng[]): number[] {
  const out = [0]
  for (let i = 1; i < line.length; i++) out.push(out[i - 1] + haversine(line[i - 1], line[i]))
  return out
}

export function lineLength(line: LatLng[]): number {
  const c = cumulative(line)
  return c[c.length - 1]
}

export type Projection = {
  along: number   // metres from the start of the line to the nearest point
  dist: number    // metres from the query point to the line
  at: LatLng      // the nearest point on the line
}

/** Nearest point on `line` to `p`. `cum` may be passed to avoid recomputing it. */
export function project(line: LatLng[], p: LatLng, cum = cumulative(line)): Projection {
  const kx = M_PER_DEG_LAT * Math.cos((p[0] * Math.PI) / 180)
  const ky = M_PER_DEG_LAT
  let best: Projection = { along: 0, dist: Infinity, at: line[0] }
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i]
    const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky
    const bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky
    const dx = bx - ax, dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0
    const x = ax + t * dx, y = ay + t * dy
    const dist = Math.sqrt(x * x + y * y)
    if (dist < best.dist) {
      best = {
        dist,
        along: cum[i - 1] + t * (cum[i] - cum[i - 1]),
        at: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])],
      }
    }
  }
  return best
}

/** The part of `line` between two distances along it. If `from > to` the
 *  slice comes back reversed (travelling the line backwards). */
export function slice(line: LatLng[], from: number, to: number, cum = cumulative(line)): LatLng[] {
  if (from > to) return slice(line, to, from, cum).reverse()
  const total = cum[cum.length - 1]
  from = Math.max(0, Math.min(total, from))
  to = Math.max(0, Math.min(total, to))
  const pointAt = (d: number): LatLng => {
    let i = 1
    while (i < cum.length - 1 && cum[i] < d) i++
    const seg = cum[i] - cum[i - 1]
    const t = seg ? (d - cum[i - 1]) / seg : 0
    const a = line[i - 1], b = line[i]
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
  }
  const out: LatLng[] = [pointAt(from)]
  for (let i = 0; i < line.length; i++) if (cum[i] > from && cum[i] < to) out.push(line[i])
  out.push(pointAt(to))
  return out
}

/** Douglas–Peucker simplification with a tolerance in metres. Keeps the ends. */
export function simplify(line: LatLng[], tolM: number): LatLng[] {
  if (line.length <= 2) return line
  const keep = new Uint8Array(line.length)
  keep[0] = keep[line.length - 1] = 1
  const stack: [number, number][] = [[0, line.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()!
    let maxD = 0, idx = -1
    for (let i = s + 1; i < e; i++) {
      const d = project([line[s], line[e]], line[i]).dist
      if (d > maxD) { maxD = d; idx = i }
    }
    if (idx >= 0 && maxD > tolM) {
      keep[idx] = 1
      stack.push([s, idx], [idx, e])
    }
  }
  return line.filter((_, i) => keep[i])
}

/** Round to 6 dp (~0.1 m) — same as ATT trackSegment; keeps JSON small. */
export const round6 = (p: LatLng): LatLng => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]
