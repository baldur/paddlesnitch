// A racing line that isn't the river line (a loop, round islands): its legs
// joined up, its corners rounded off to a turn a K1 can make, and where things
// lie along it. Pure, so it's tested on its own (route.test.ts).
import { cumulative, locate, resample, type LatLng, type XZ } from './river'

// A leg: along the river line between two points, or a point to go through.
// A portage (in course.json, between legs) is a run over land: from where you
// land to where you put in, through the points between.
export type Leg = LatLng | { along: [LatLng, LatLng] }
export type Portage = { portage: LatLng[] }

/** The legs as one line of points (the river line's own between `along` ends). */
export function routePoints(legs: Leg[], line: XZ[], toXZ: (p: LatLng) => XZ): XZ[] {
  const cum = cumulative(line)
  const out: XZ[] = []
  for (const leg of legs) {
    if (Array.isArray(leg)) out.push(toXZ(leg))
    else {
      const [a, b] = leg.along.map((p) => locate(line, cum, toXZ(p)).s)
      const ids = cum.map((s, i) => [s, i] as const).filter(([s]) => s >= Math.min(a, b) && s <= Math.max(a, b)).map(([, i]) => i)
      out.push(...(a < b ? ids : ids.reverse()).map((i) => line[i]))
    }
  }
  return out.filter((p, i) => i === 0 || Math.hypot(p[0] - out[i - 1][0], p[1] - out[i - 1][1]) > 1)
}

// The radius of the circle through three points (Infinity when they're in line).
function radius(a: XZ, b: XZ, c: XZ): number {
  const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
  if (area < 1e-9) return Infinity
  return (Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1]) * Math.hypot(c[0] - a[0], c[1] - a[1])) / (4 * area)
}

/**
 * Every `step` metres, with no turn tighter than `minR` metres in radius where
 * there's water for it: a point on a tighter turn moves a little towards its
 * neighbours (cutting the corner), again and again, but only while `ok` says
 * where it would go, and the line either side of it, will do (on the water,
 * clear of the banks).
 */
export function smoothTurns(points: XZ[], ok: (p: XZ) => boolean, minR = 12, step = 5): XZ[] {
  const line = resample(points, step)
  for (let pass = 0; pass < 400; pass++) {
    let moved = false
    for (let i = 1; i < line.length - 1; i++) {
      if (radius(line[i - 1], line[i], line[i + 1]) >= minR) continue
      const mid: XZ = [(line[i - 1][0] + line[i + 1][0]) / 2, (line[i - 1][1] + line[i + 1][1]) / 2]
      const to: XZ = [line[i][0] + (mid[0] - line[i][0]) * 0.3, line[i][1] + (mid[1] - line[i][1]) * 0.3]
      // The point, and the line either side of it (a corner cut across an island's end isn't ok).
      const half = (a: XZ): XZ => [(a[0] + to[0]) / 2, (a[1] + to[1]) / 2]
      if (!ok(to) || !ok(half(line[i - 1])) || !ok(half(line[i + 1]))) continue
      line[i] = to
      moved = true
    }
    if (!moved) break
  }
  return resample(line, step)
}

/**
 * Every `step` metres, moved off any land and `clear` metres off the banks
 * (`water`: whether a point's on it, and the nearest shore point): a point too
 * near the shore goes straight away from it, one on land through it.
 */
export function offLand(points: XZ[], water: { inside(x: number, z: number): boolean; nearest(x: number, z: number, r?: number): { x: number; z: number; d: number } | null }, clear = 3, step = 5): XZ[] {
  return resample(points, step).map(([x, z]) => {
    for (let pass = 0; pass < 3; pass++) {
      const p = water.nearest(x, z, 30)
      const wet = water.inside(x, z)
      if (!p || (wet && p.d >= clear)) break
      let [nx, nz] = wet ? [x - p.x, z - p.z] : [p.x - x, p.z - z]
      if (Math.hypot(nx, nz) < 1e-6) {
        // Right on the shoreline: whichever way is water.
        const way = Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)])
          .find(([dx, dz]) => water.inside(x + dx * 0.5, z + dz * 0.5)) ?? [0, 0]
        ;[nx, nz] = way
      }
      const d = Math.hypot(nx, nz) || 1
      ;[nx, nz] = [nx / d, nz / d]
      const to: XZ = [p.x + nx * clear, p.z + nz * clear]
      if (!water.inside(to[0], to[1])) break
      ;[x, z] = to
    }
    return [x, z] as XZ
  })
}

/** The tightest turn on a line, metres of radius (over points `step` apart). */
export function tightest(line: XZ[]): number {
  let min = Infinity
  for (let i = 1; i < line.length - 1; i++) min = Math.min(min, radius(line[i - 1], line[i], line[i + 1]))
  return min
}

// A compass heading (degrees, 0 north, clockwise) and the line's at point i.
const headingAt = (line: XZ[], i: number) => {
  const [a, b] = [line[Math.max(0, i - 1)], line[Math.min(line.length - 1, i + 1)]]
  return (Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180) / Math.PI
}
const apart = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)

/**
 * Where on the line a point is nearest, heading within 90 degrees of `heading`
 * if one is given (so a stretch passed both ways is found on the right pass):
 * { s, lateral (right of travel is +), d }.
 */
export function along(line: XZ[], p: XZ, heading?: number): { s: number; lateral: number; d: number } {
  const cum = cumulative(line)
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < line.length; i++) {
    if (heading !== undefined && apart(headingAt(line, i), heading) > 90) continue
    const d = Math.hypot(line[i][0] - p[0], line[i][1] - p[1])
    if (d < bestD) [best, bestD] = [i, d]
  }
  if (best < 0) return { s: 0, lateral: 0, d: Infinity }
  const [a, b] = [line[Math.max(0, best - 1)], line[Math.min(line.length - 1, best + 1)]]
  const t = [b[0] - a[0], b[1] - a[1]]
  const n = Math.hypot(t[0], t[1]) || 1
  const lateral = ((p[0] - line[best][0]) * -t[1] + (p[1] - line[best][1]) * t[0]) / n
  return { s: cum[best], lateral, d: bestD }
}

/**
 * Pieces of racing line on the water joined by runs over land (a portage: from
 * the end of one piece, through a run's points, to the start of the next), as
 * one line every `step` metres, and where each run lies along it ({ from, to }
 * in metres: where you land and where you put in).
 */
export function joinRuns(pieces: XZ[][], runs: XZ[][], step = 5): { line: XZ[]; portages: Array<{ from: number; to: number }> } {
  const line: XZ[] = [...pieces[0]]
  const portages: Array<{ from: number; to: number }> = []
  for (let k = 1; k < pieces.length; k++) {
    const from = cumulative(line).at(-1)!
    const run = resample([line.at(-1)!, ...runs[k - 1], pieces[k][0]], step)
    line.push(...run.slice(1))
    const to = cumulative([...line, pieces[k][0]]).at(-1)!
    portages.push({ from: Math.round(from * 10) / 10, to: Math.round(to * 10) / 10 })
    line.push(...pieces[k])
  }
  return { line: line.filter((p, i) => i === 0 || Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]) > 0.01), portages }
}
