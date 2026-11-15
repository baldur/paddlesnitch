// Environment Agency lidar → the numbers the Reading game uses (games/reading-thames/lidar.js):
// the bare ground every 5 m, plain buildings' heights, trees' crowns. Pure; the
// grids come in as arrays. Tested in lidar.test.ts. See course:lidar.
import type { XZ } from './river'

/** WGS84 latitude/longitude → British National Grid (EPSG:27700) easting/northing, to a few metres (Helmert, then the grid's Transverse Mercator). */
export function wgs84ToBng(lat: number, lon: number): [number, number] {
  return osgb36ToBng(...wgs84ToOsgb36(lat, lon))
}

/** WGS84 → OSGB36 latitude/longitude in degrees, by the OS's seven-parameter Helmert (good to about 5 m). */
export function wgs84ToOsgb36(lat: number, lon: number): [number, number] {
  const rad = Math.PI / 180
  let a = 6378137.0, b = 6356752.3141
  let e2 = 1 - (b * b) / (a * a)
  const [p, l] = [lat * rad, lon * rad]
  let nu = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2)
  const [x, y, z] = [nu * Math.cos(p) * Math.cos(l), nu * Math.cos(p) * Math.sin(l), (1 - e2) * nu * Math.sin(p)]
  const [tx, ty, tz, s] = [-446.448, 125.157, -542.06, 20.4894e-6]
  const [rx, ry, rz] = [-0.1502, -0.247, -0.8421].map((v) => (v / 3600) * rad)
  const x2 = tx + (1 + s) * x - rz * y + ry * z
  const y2 = ty + rz * x + (1 + s) * y - rx * z
  const z2 = tz - ry * x + rx * y + (1 + s) * z
  a = 6377563.396
  b = 6356256.909
  e2 = 1 - (b * b) / (a * a)
  const p2 = Math.sqrt(x2 * x2 + y2 * y2)
  let phi = Math.atan2(z2, p2 * (1 - e2))
  for (let i = 0; i < 10; i++) {
    nu = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2)
    phi = Math.atan2(z2 + e2 * nu * Math.sin(phi), p2)
  }
  return [phi / rad, Math.atan2(y2, x2) / rad]
}

/** OSGB36 latitude/longitude → National Grid easting/northing (the OS's Transverse Mercator formulae). */
export function osgb36ToBng(lat: number, lon: number): [number, number] {
  const rad = Math.PI / 180
  const [a, b] = [6377563.396, 6356256.909]
  const e2 = 1 - (b * b) / (a * a)
  const [phi, lam] = [lat * rad, lon * rad]
  const [F0, phi0, lam0, N0, E0] = [0.9996012717, 49 * rad, -2 * rad, -100000, 400000]
  const n = (a - b) / (a + b)
  const nu = (a * F0) / Math.sqrt(1 - e2 * Math.sin(phi) ** 2)
  const rho = (a * F0 * (1 - e2)) / (1 - e2 * Math.sin(phi) ** 2) ** 1.5
  const eta2 = nu / rho - 1
  const M = b * F0 * ((1 + n + 1.25 * n ** 2 + 1.25 * n ** 3) * (phi - phi0) - (3 * n + 3 * n ** 2 + (21 / 8) * n ** 3) * Math.sin(phi - phi0) * Math.cos(phi + phi0)
    + ((15 / 8) * n ** 2 + (15 / 8) * n ** 3) * Math.sin(2 * (phi - phi0)) * Math.cos(2 * (phi + phi0)) - (35 / 24) * n ** 3 * Math.sin(3 * (phi - phi0)) * Math.cos(3 * (phi + phi0)))
  const [c, sn, t] = [Math.cos(phi), Math.sin(phi), Math.tan(phi)]
  const I = M + N0
  const II = (nu / 2) * sn * c
  const III = (nu / 24) * sn * c ** 3 * (5 - t * t + 9 * eta2)
  const IIIA = (nu / 720) * sn * c ** 5 * (61 - 58 * t * t + t ** 4)
  const IV = nu * c
  const V = (nu / 6) * c ** 3 * (nu / rho - t * t)
  const VI = (nu / 120) * c ** 5 * (5 - 18 * t * t + t ** 4 + 14 * eta2 - 58 * t * t * eta2)
  const d = lam - lam0
  return [E0 + IV * d + V * d ** 3 + VI * d ** 5, I + II * d ** 2 + III * d ** 4 + IIIA * d ** 6]
}

/** A lidar grid: `cell` m squares from its north-west corner, row 0 north, NaN or below -1000 where there is none. */
export type Grid = { west: number; north: number; width: number; height: number; cell: number; values: ArrayLike<number> }

/** The grid's value at (E, N), bilinear between cell centres; null off it or next to a hole. */
export function sampleGrid(g: Grid, E: number, N: number): number | null {
  const c = (E - g.west) / g.cell - 0.5
  const r = (g.north - N) / g.cell - 0.5
  const [c0, r0] = [Math.floor(c), Math.floor(r)]
  const at = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= g.width || j >= g.height) return null
    const v = g.values[j * g.width + i]
    return Number.isFinite(v) && v > -1000 ? v : null
  }
  const v = [at(c0, r0), at(c0 + 1, r0), at(c0, r0 + 1), at(c0 + 1, r0 + 1)]
  if (v.some((q) => q === null)) return v.find((q) => q !== null) ?? null
  const [fc, fr] = [c - c0, r - r0]
  const [a, b, d, e] = v as number[]
  return (a * (1 - fc) + b * fc) * (1 - fr) + (d * (1 - fc) + e * fc) * fr
}

/** The heights the game needs, in its metres: `ground` (bare ground above the water) and `above` (the first surface above the ground). */
export type Heights = { ground: (x: number, z: number) => number | null; above: (x: number, z: number) => number | null }
/** The patch: [x0, z0, x1, z1] in game metres (multiples of `GROUND_CELL` apart). */
export type Patch = [number, number, number, number]

export const GROUND_CELL = 5
/** Lidar's bare ground this far above the water is land (its water reads 0.1–0.3). */
export const LAND = 0.35

const median = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)]
const pct = (a: number[], q: number) => { const s = [...a].sort((u, v) => u - v); return s[Math.min(s.length - 1, Math.floor(q * s.length))] }
export function inside(poly: XZ[], x: number, z: number): boolean {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [[xi, zi], [xj, zj]] = [poly[i], poly[j]]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit
  }
  return hit
}

/**
 * The ground every 5 m over the patch, in decimetres, row by row southward: the
 * median of the land round each point; a point over the water takes its
 * nearest land's (so the bank top runs out to the game's edge, a metre or two off lidar's).
 */
export function deriveGround(h: Heights, [x0, z0, x1, z1]: Patch): { w: number; h: number; dm: number[] } {
  const w = Math.round((x1 - x0) / GROUND_CELL) + 1
  const rows = Math.round((z1 - z0) / GROUND_CELL) + 1
  let g: Array<number | null> = new Array(w * rows).fill(null)
  for (let j = 0; j < rows; j++) for (let i = 0; i < w; i++) {
    const vs: number[] = []
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const v = h.ground(x0 + i * GROUND_CELL + dx, z0 + j * GROUND_CELL + dz)
      if (v !== null && v > LAND) vs.push(v)
    }
    if (vs.length >= 5) g[j * w + i] = median(vs)
  }
  for (let pass = 0; g.some((v) => v === null) && pass < 200; pass++) {
    const next = [...g]
    for (let j = 0; j < rows; j++) for (let i = 0; i < w; i++) {
      if (g[j * w + i] !== null) continue
      const n = [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < w && b < rows).map(([a, b]) => g[b * w + a]).filter((v): v is number => v !== null)
      if (n.length) next[j * w + i] = n.reduce((p, q) => p + q) / n.length
    }
    g = next
  }
  return { w, h: rows, dm: g.map((v) => Math.round((v ?? 0) * 10)) }
}

/** The ground in decimetres (as deriveGround made it), bilinear, at a point in the patch. */
export function groundIn({ w, h, dm }: { w: number; h: number; dm: number[] }, [x0, z0]: Patch, x: number, z: number): number {
  const u = Math.max(0, Math.min(w - 1.001, (x - x0) / GROUND_CELL))
  const v = Math.max(0, Math.min(h - 1.001, (z - z0) / GROUND_CELL))
  const [i, j] = [Math.floor(u), Math.floor(v)]
  const q = (a: number, b: number) => dm[b * w + a] / 10
  return (q(i, j) * (1 - (u - i)) + q(i + 1, j) * (u - i)) * (1 - (v - j)) + (q(i, j + 1) * (1 - (u - i)) + q(i + 1, j + 1) * (u - i)) * (v - j)
}

export type Building = { shape: XZ[]; height: number; kind: string; style?: string }

/**
 * Plain buildings' heights (not the landmarks, modelled from the footage): the
 * height to the eaves that puts the game's roof where lidar's is (a pitched
 * roof's rise as world.js draws it). Only those a metre or more out.
 */
export function deriveBuildings(h: Heights, buildings: Building[], [x0, z0, x1, z1]: Patch, groundAt: (x: number, z: number) => number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  for (const b of buildings) {
    const closed = b.shape[0][0] === b.shape.at(-1)![0] && b.shape[0][1] === b.shape.at(-1)![1]
    const ring = closed ? b.shape.slice(0, -1) : b.shape
    const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length
    const cz = ring.reduce((a, p) => a + p[1], 0) / ring.length
    if (cx < x0 || cx > x1 || cz < z0 || cz > z1 || (b.style && b.style !== 'clapboard')) continue
    const xs = ring.map((p) => p[0])
    const zs = ring.map((p) => p[1])
    const tops: number[] = []
    for (let x = Math.floor(Math.min(...xs)); x <= Math.max(...xs); x++) for (let z = Math.floor(Math.min(...zs)); z <= Math.max(...zs); z++) {
      if (!inside(ring, x + 0.5, z + 0.5)) continue
      const [g, a] = [h.ground(x + 0.5, z + 0.5), h.above(x + 0.5, z + 0.5)]
      if (g !== null && a !== null) tops.push(g + a)
    }
    if (tops.length < 8) continue
    let area = 0
    for (let i = 0; i < ring.length; i++) { const [p, q] = [ring[i], ring[(i + 1) % ring.length]]; area += p[0] * q[1] - q[0] * p[1] }
    const pitched = b.kind === 'house' || b.kind === 'boathouse'
    const rise = pitched ? Math.min(4, 1.5 + Math.sqrt(Math.abs(area / 2)) * 0.18) : 0
    const height = Math.max(2.5, Math.round((pct(tops, pitched ? 0.95 : 0.9) - groundAt(cx, cz) - rise) * 10) / 10)
    if (Math.abs(height - b.height) >= 1) out.push([Math.round(cx * 10) / 10, Math.round(cz * 10) / 10, height])
  }
  return out
}

/**
 * Trees: the highest points of the canopy over land (over 4 m; not the bridge,
 * boats or branches out over the river), clear of buildings, spaced by their
 * crowns' size. `onBank` moves a trunk onto the game's bank (or says it's out
 * over the water), `fromWater` is how far it is from the river. Further back,
 * only the taller ones (the triangle budget): over 12 m to 120 m, over 8 m to 70, the rest to 40.
 */
export function deriveTrees(h: Heights, [x0, z0, x1, z1]: Patch, keepOut: (x: number, z: number) => boolean, onBank: (x: number, z: number) => XZ | null, fromWater: (x: number, z: number) => number): Array<[number, number, number]> {
  const W = x1 - x0 + 1
  const chm = new Float32Array(W * (z1 - z0 + 1))
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) chm[(z - z0) * W + (x - x0)] = (h.ground(x, z) ?? 0) > LAND ? h.above(x, z) ?? 0 : 0
  const at = (x: number, z: number) => (x < x0 || x > x1 || z < z0 || z > z1 ? 0 : chm[(z - z0) * W + (x - x0)])
  const peaks: Array<[number, number, number]> = []
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    const c = at(x, z)
    if (c < 4) continue
    let peak = true
    for (let dx = -3; dx <= 3 && peak; dx++) for (let dz = -3; dz <= 3; dz++) if ((dx || dz) && at(x + dx, z + dz) > c) { peak = false; break }
    if (peak) peaks.push([x, z, c])
  }
  peaks.sort((p, q) => q[2] - p[2])
  const trees: Array<[number, number, number]> = []
  for (const [x, z, c] of peaks) {
    if (keepOut(x, z)) continue
    if (trees.some(([a, b, hh]) => Math.hypot(a - x, b - z) < Math.max(6, 0.5 * (hh + c) * 0.34 * 1.4))) continue
    const bank = onBank(x + 0.5, z + 0.5)
    if (!bank) continue
    if (fromWater(...bank) > (c >= 12 ? 120 : c >= 8 ? 70 : 40)) continue
    trees.push([Math.round(bank[0] * 10) / 10, Math.round(bank[1] * 10) / 10, Math.round(c * 10) / 10])
  }
  return trees
}

/** games/reading-thames/lidar.js. */
export function lidarModule(patch: Patch, ground: { w: number; h: number; dm: number[] }, buildings: Array<[number, number, number]>, trees: Array<[number, number, number]>): string {
  const rows: string[] = []
  for (let j = 0; j < ground.h; j++) rows.push('    ' + ground.dm.slice(j * ground.w, (j + 1) * ground.w).join(',') + ',')
  return `// The ground, buildings and trees from Caversham Bridge up past Reading
// Canoe Club and Caversham Court, from Environment Agency lidar (the 1 m composite: bare ground, and
// the first surface the laser met). © Environment Agency copyright and/or
// database right, under the Open Government Licence v3. Only numbers worked out
// from it are here, not the lidar itself. Game metres (x east, z south of
// 51.46175, -0.96945); heights in metres above the river. Made by
// \`pnpm --filter web course:lidar\` (apps/web/scripts/courses/lidar.ts).
export const LIDAR = {
  // The bare ground every \`cell\` metres from (x0, z0), row by row southward,
  // in decimetres. Under the water: the bank top nearest it.
  ground: {
    x0: ${patch[0]}, z0: ${patch[1]}, cell: ${GROUND_CELL}, w: ${ground.w}, h: ${ground.h}, dm: [
${rows.join('\n')}
    ],
  },
  // Plain buildings' heights to the eaves, by the middle of their footprint
  // (x, z, height): the height that puts the game's roof where lidar's is.
  buildings: ${JSON.stringify(buildings)},
  // The trees' crowns (x, z, height above the ground): the highest points of the
  // canopy, clear of buildings, spaced by their size.
  trees: ${JSON.stringify(trees)},
};
`
}
