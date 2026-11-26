// Environment Agency lidar → the numbers the Reading game uses (games/reading-thames/lidar.js):
// the bare ground every 5 m, plain buildings' heights, trees' crowns. Pure; the
// grids come in as arrays. Tested in lidar.test.ts. See course:lidar.
import type { XZ } from './river'
import { partAt, roofParts, surfaceAt } from '../../../../../games/reading-thames/roofs.js'

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

/**
 * One Environment Agency tile: a GeoTIFF of float32 values, uncompressed, in a
 * single tile or in strips (its 256-wide tile padding dropped). Row 0 north.
 */
export function readTile(buf: Uint8Array): { width: number; height: number; values: Float32Array } {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const little = buf[0] === 0x49
  if (!little && buf[0] !== 0x4d) throw new Error('not a TIFF')
  const u16 = (o: number) => view.getUint16(o, little)
  const u32 = (o: number) => view.getUint32(o, little)
  const ifd = u32(4)
  const tags = new Map<number, number[]>()
  for (let i = 0; i < u16(ifd); i++) {
    const at = ifd + 2 + i * 12
    const [tag, type, count] = [u16(at), u16(at + 2), u32(at + 4)]
    const size = type === 3 ? 2 : 4
    if (type !== 3 && type !== 4) continue
    const from = count * size <= 4 ? at + 8 : u32(at + 8)
    tags.set(tag, Array.from({ length: count }, (_, k) => (size === 2 ? u16(from + k * 2) : u32(from + k * 4))))
  }
  const one = (t: number) => tags.get(t)?.[0]
  const [width, height] = [one(256)!, one(257)!]
  if (one(258) !== 32 || one(339) !== 3 || (one(259) ?? 1) !== 1) throw new Error('expected uncompressed float32')
  const values = new Float32Array(width * height)
  const tw = one(322)
  // Tiles across and down (one, for the EA's 250 m squares), or strips of rows.
  const pieces = tw ? (tags.get(324) ?? []).map((off, k) => ({ off, x: (k % Math.ceil(width / tw)) * tw, y: Math.floor(k / Math.ceil(width / tw)) * one(323)!, w: tw }))
    : (tags.get(273) ?? []).map((off, k) => ({ off, x: 0, y: k * (one(278) ?? height), w: width }))
  for (const { off, x, y, w } of pieces) {
    const rows = tw ? one(323)! : one(278) ?? height
    for (let r = 0; r < rows && y + r < height; r++) for (let c = 0; c < w && x + c < width; c++) values[(y + r) * width + x + c] = view.getFloat32(off + (r * w + c) * 4, little)
  }
  return { width, height, values }
}

/** Tiles (each its south-west corner in metres and its values, row 0 north) as one grid; none where there's no tile. */
export function mosaic(tiles: Array<{ west: number; south: number; width: number; height: number; values: ArrayLike<number> }>, cell = 1): Grid {
  const west = Math.min(...tiles.map((t) => t.west))
  const north = Math.max(...tiles.map((t) => t.south + t.height * cell))
  const width = Math.round((Math.max(...tiles.map((t) => t.west + t.width * cell)) - west) / cell)
  const height = Math.round((north - Math.min(...tiles.map((t) => t.south))) / cell)
  const values = new Float32Array(width * height).fill(NaN)
  for (const t of tiles) {
    const [c0, r0] = [Math.round((t.west - west) / cell), Math.round((north - (t.south + t.height * cell)) / cell)]
    for (let r = 0; r < t.height; r++) for (let c = 0; c < t.width; c++) values[(r0 + r) * width + c0 + c] = t.values[r * t.width + c]
  }
  return { west, north, width, height, cell, values }
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
export function deriveGround(h: Heights, [x0, z0, x1, z1]: Patch, want: (x: number, z: number) => boolean = () => true): { w: number; h: number; dm: number[] } {
  const w = Math.round((x1 - x0) / GROUND_CELL) + 1
  const rows = Math.round((z1 - z0) / GROUND_CELL) + 1
  let g: Array<number | null> = new Array(w * rows).fill(null)
  const wanted = new Uint8Array(w * rows)
  for (let j = 0; j < rows; j++) for (let i = 0; i < w; i++) wanted[j * w + i] = want(x0 + i * GROUND_CELL, z0 + j * GROUND_CELL) ? 1 : 0
  for (let j = 0; j < rows; j++) for (let i = 0; i < w; i++) {
    if (!wanted[j * w + i]) continue
    const vs: number[] = []
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const v = h.ground(x0 + i * GROUND_CELL + dx, z0 + j * GROUND_CELL + dz)
      if (v !== null && v > LAND) vs.push(v)
    }
    if (vs.length >= 5) g[j * w + i] = median(vs)
  }
  for (let pass = 0; g.some((v, k) => v === null && wanted[k]) && pass < 200; pass++) {
    const next = [...g]
    for (let j = 0; j < rows; j++) for (let i = 0; i < w; i++) {
      if (g[j * w + i] !== null || !wanted[j * w + i]) continue
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

/** The game's blocks of ground: BLOCK metres square, BLOCK / GROUND_CELL cells, so BLOCK / GROUND_CELL + 1 points a side. */
export const BLOCK = 250

/**
 * The ground cut into blocks (`keep` says which: where the game has land), each
 * written as text: its rows southward, each row's first point in decimetres and
 * then the steps along it (small numbers, which compress well).
 */
export function groundBlocks(ground: { w: number; h: number; dm: number[] }, [x0, z0]: Patch, keep: (i: number, j: number) => boolean): Record<string, string> {
  const n = BLOCK / GROUND_CELL
  const out: Record<string, string> = {}
  for (let j = 0; (j + 1) * n < ground.h; j++) for (let i = 0; (i + 1) * n < ground.w; i++) {
    if (!keep(i, j)) continue
    const values: number[] = []
    for (let r = 0; r <= n; r++) for (let c = 0; c <= n; c++) {
      const [a, b] = [i * n + c, j * n + r]
      values.push(c === 0 ? ground.dm[b * ground.w + a] : ground.dm[b * ground.w + a] - ground.dm[b * ground.w + a - 1])
    }
    out[`${Math.round(x0 / BLOCK) + i},${Math.round(z0 / BLOCK) + j}`] = values.join(',')
  }
  return out
}

/** Whether (x, z) is in one of the blocks (keys "i,j"): a point on a block's edge or corner is in every block that touches it. */
export function inBlocks(blocks: Set<string>, x: number, z: number): boolean {
  return [[0, 0], [-0.01, 0], [0, -0.01], [-0.01, -0.01]].some(([a, b]) => blocks.has(`${Math.floor((x + a) / BLOCK)},${Math.floor((z + b) / BLOCK)}`))
}

/** A block's text back to its points in decimetres (as world.js reads it). */
export function blockValues(text: string): Int16Array {
  const n = BLOCK / GROUND_CELL + 1
  const v = Int16Array.from(text.split(',').map(Number))
  for (let r = 0; r < n; r++) for (let c = 1; c < n; c++) v[r * n + c] += v[r * n + c - 1]
  return v
}

export type Building = { shape: XZ[]; height: number; kind: string; style?: string }

/**
 * Plain buildings' heights (not the landmarks, modelled from the footage): the
 * height to the eaves that puts the game's roof where lidar's is (a pitched
 * roof's rise as world.js draws it). Only those a metre or more out. A house
 * over three storeys (eaves over HOUSE_EAVES) is a tree over it: kept as mapped.
 */
const HOUSE_EAVES = 10

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
    if (b.kind === 'house' && height > HOUSE_EAVES) continue
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
export function deriveTrees(h: Heights, [x0, z0, x1, z1]: Patch, keepOut: (x: number, z: number) => boolean, onBank: (x: number, z: number) => XZ | null, fromWater: (x: number, z: number) => number, want: (x: number, z: number) => boolean = () => true, overWater = false): Array<[number, number, number]> {
  const W = x1 - x0 + 1
  const chm = new Float32Array(W * (z1 - z0 + 1))
  // Over the water the first surface is boats and bridges as often as leaves:
  // only a vegetation canopy (`overWater`) is looked at there, for the crowns
  // hanging out from the bank.
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (want(x, z)) chm[(z - z0) * W + (x - x0)] = overWater || (h.ground(x, z) ?? 0) > LAND ? h.above(x, z) ?? 0 : 0
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
    // Two crowns over the water can be moved onto the same spot of bank: one tree there.
    if (trees.some(([a, b]) => Math.hypot(a - bank[0], b - bank[1]) < 3)) continue
    if (fromWater(...bank) > (c >= 12 ? 120 : c >= 8 ? 70 : 40)) continue
    trees.push([Math.round(bank[0] * 10) / 10, Math.round(bank[1] * 10) / 10, Math.round(c * 10) / 10])
  }
  return trees
}

/**
 * How wooded each bank is, every `step` metres along the river (the water's
 * reflections follow it): the share of the strip 2–14 m out from the water's
 * edge, 30 m either way, under canopy over 3 m (scrub and young willow mirror as
 * much as trees), to the nearest 0.05; null where the lidar covers less than half
 * of it. `above(s, side, d)` is the canopy's height d metres out from the edge
 * on that side (-1 left, 1 right), or null. [left, right], a value per step.
 */
export function bankCanopy(length: number, step: number, above: (s: number, side: -1 | 1, d: number) => number | null): Array<Array<number | null>> {
  return ([-1, 1] as const).map((side) => Array.from({ length: Math.floor(length / step) + 1 }, (_, i) => {
    let [seen, wooded, all] = [0, 0, 0]
    // (Only the first belt by the water shows in it: the strip 2–14 m out.)
    for (let ds = -30; ds <= 30; ds += 4) for (let d = 2; d <= 14; d += 3) {
      all++
      const h = above(i * step + ds, side, d)
      if (h === null) continue
      seen++
      if (h > 3) wooded++
    }
    return seen * 2 < all ? null : Math.round((wooded / seen) * 20) / 20
  }))
}

/**
 * Where a tree whose crown peaks at (x, z) stands: there, on land 2 m or more
 * from the water; else 2 m up the bank from the nearest edge (a crown hanging
 * out over the water from it, or a trunk right at the edge); none if the peak
 * is more than 8 m out over the water (that's not hanging from a bank) or the
 * bank point is itself water. `land` is the game's mapped water.
 */
export function toBank(land: { nearest: (x: number, z: number) => { x: number; z: number; d: number } | null; inside: (x: number, z: number) => boolean }, x: number, z: number): XZ | null {
  const near = land.nearest(x, z)
  const wet = land.inside(x, z)
  if (!near || (!wet && near.d >= 2)) return [x, z]
  if (wet && near.d > 8) return null
  const [ux, uz] = [(x - near.x) / (near.d || 1), (z - near.z) / (near.d || 1)]
  const k = wet ? -2 : 2
  const p: XZ = [near.x + ux * k, near.z + uz * k]
  return land.inside(...p) ? null : p
}

/**
 * The leaves at the water's edge, every `step` metres along each bank: the
 * canopy's height in the first 8 m from the edge (the 80th percentile of what's
 * there), or null where there's no canopy over 3 m on most of it, or no lidar.
 * The game lines the bank with low crowns of that height, so a wooded bank is a
 * wall of leaves down to the water, as the footage shows. [left, right].
 */
export function bankEdge(length: number, step: number, above: (s: number, side: -1 | 1, d: number) => number | null): Array<Array<number | null>> {
  return ([-1, 1] as const).map((side) => Array.from({ length: Math.floor(length / step) + 1 }, (_, i) => {
    const hs: number[] = []
    let seen = 0
    for (let ds = -step / 2; ds < step / 2; ds += 2) for (let d = 0; d <= 8; d += 2) {
      const h = above(i * step + ds, side, d)
      if (h === null) continue
      seen++
      if (h > 3) hs.push(h)
    }
    if (!seen || hs.length * 2 < seen) return null
    hs.sort((a, b) => a - b)
    return Math.round(hs[Math.floor(hs.length * 0.8)] * 10) / 10
  }))
}

/**
 * How high each bank's trees stand as the water mirrors them, every `step`
 * metres along each bank (null where not measured): from water `view` metres
 * out, a crown h high d metres back from the edge stands as high at the edge
 * as h * view / (view + d), so the tall trees behind a lawn or a clubhouse count
 * too, not only the first belt, up to the first building. The highest out to 60 m back, the 80th percentile
 * over 30 m either way (the reflection shows the trees, not the gaps between). Heights in metres over the bank. bankCanopy's share of the first 14 m
 * set the trees' height in the water before: most banks mirrored 2-7 m trees,
 * where the footage's reflections come right across to the boat.
 */
export function bankSkyline(length: number, step: number, above: (s: number, side: -1 | 1, d: number) => number | null, view = 20): Array<Array<number | null>> {
  return ([-1, 1] as const).map((side) => Array.from({ length: Math.floor(length / step) + 1 }, (_, i) => {
    const tops: number[] = []
    for (let ds = -30; ds <= 30; ds += 3) {
      let best: number | null = null
      for (let d = 0; d <= 60; d += 2) {
        const h = above(i * step + ds, side, d)
        if (h === null) continue
        // A building: what stands behind it is hidden from the water (the game
        // mirrors only landmark buildings, so a set-back tree showed under a house).
        if (h < 0) { best ??= 0; break }
        best = Math.max(best ?? 0, (h * view) / (view + d))
      }
      if (best !== null) tops.push(best)
    }
    if (!tops.length) return null
    tops.sort((a, b) => a - b)
    return Math.round(tops[Math.floor(tops.length * 0.8)] * 10) / 10
  }))
}

/**
 * The canopy's height `d` metres out from the water's edge on `side` (-1 left,
 * 1 right) at `s` along the river: null off the river or where the lidar
 * isn't kept, -1 on a building (a roof isn't canopy, and bankSkyline stops
 * there: what stands behind a house doesn't show in the water). The sampler
 * bankCanopy takes.
 */
export function canopyAt(
  river: { length: number }, at: (s: number) => { x: number; z: number; tx: number; tz: number; half: number },
  kept: (x: number, z: number) => boolean, building: (x: number, z: number) => boolean, above: (x: number, z: number) => number | null,
): (s: number, side: -1 | 1, d: number) => number | null {
  return (s, side, d) => {
    if (s < 0 || s > river.length) return null
    const c = at(s)
    const [x, z] = [c.x - c.tz * side * (c.half + d), c.z + c.tx * side * (c.half + d)]
    return !kept(x, z) ? null : building(x, z) ? -1 : above(x, z)
  }
}

/** A roof part as games/reading-thames/roofs.js reads it (heights above the building's ground). */
export type RoofPart = ['flat', number] | ['shed', number, number, number] | ['gable', number, number, number, number] | ['hip', number, number, number, number, number]
/** A fitted roof [cx, cz, angle, cuts, ...parts], or why none was: [cx, cz, reason]. See roofs.js. */
export type Roof = [number, number, number, number[], ...RoofPart[]] | [number, number, 'few' | 'noisy' | 'tall']

/**
 * The roof fit's settings. A cell is the lidar's first surface over a 1 m
 * square inside the footprint, as height above the building's ground.
 * TAU: a cell further than this off the roof is something else (a tree over
 * it, a chimney, the garden where the map's footprint is a metre off), and
 * counts no more than TAU would. Each form costs a little (PENALTY, in m² of
 * mean squared error), so a flat roof isn't called a gable for a few
 * centimetres. A fit is refused as noisy when fewer than INLIERS of the cells
 * are within TAU of it, or those that are miss by more than NOISY (RMS).
 */
export const ROOF = {
  MIN_CELLS: 12, EDGE: 0.6, TAU: 0.7, MIN_RISE: 0.6, MAX_SLOPE: 1.5, MAX_SHED: 0.45, SHED_RISE: 3.5, MIN_EAVES: 1.2,
  PENALTY: { flat: 0, shed: 0.01, gable: 0.015, hip: 0.025 } as Record<string, number>, PART: 0.05, MAX_PARTS: 3, MIN_PART: 4,
  FIT_CELLS: 250, SPLIT_RMS: 0.35, SPLIT_INLIERS: 0.85, INLIERS: 0.55, NOISY: 0.45,
}

type Fit = { part: RoofPart; cost: number; n: number }
type Cell = [number, number, number]

// h = e + k t, fitted to the cells' t with the far ones (|residual| > TAU) left out, iterated in from a wide TAU.
function robustLine(t: Float64Array, h: Float64Array, flat: boolean): { e: number; k: number; cost: number } {
  let [e, k] = [0, 0]
  const n = h.length
  for (const tau of [Infinity, 3, 1.5, ROOF.TAU, ROOF.TAU, ROOF.TAU]) {
    let [c, st, sh] = [0, 0, 0]
    for (let i = 0; i < n; i++) if (Math.abs(h[i] - e - k * t[i]) < tau) { c++; st += t[i]; sh += h[i] }
    if (c < 3) break
    const [mt, mh] = [st / c, sh / c]
    if (flat) { e = mh; continue }
    let [stt, sth] = [0, 0]
    for (let i = 0; i < n; i++) if (Math.abs(h[i] - e - k * t[i]) < tau) { stt += (t[i] - mt) ** 2; sth += (t[i] - mt) * (h[i] - mh) }
    k = stt > 1e-9 ? sth / stt : 0
    e = mh - k * mt
  }
  let cost = 0
  for (let i = 0; i < n; i++) cost += Math.min((h[i] - e - k * t[i]) ** 2, ROOF.TAU ** 2)
  return { e, k, cost: cost / n }
}

// The shapes a part can take (eaves 0, ridge 1), for the fit to try.
function shapes(ext: [number, number, number, number], extq: [number, number, number, number], coarse = false): RoofPart[] {
  const out: RoofPart[] = [['flat', 1]]
  for (let q = 0; q < 4; q++) out.push(['shed', q, 0, 1])
  for (let q = 0; q < 2; q++) {
    for (let a = 0.3; a < 0.71; a += coarse ? 0.1 : 0.05) out.push(['gable', q, 0, 1, Math.round(a * 100) / 100])
    const [u0, u1] = q ? extq : ext
    const half = (u1 - u0) / 2
    for (let a = 0.3; a < 0.71; a += 0.1) for (let b = 1; b < half + 0.49; b += coarse ? 1 : 0.5) out.push(['hip', q, 0, 1, Math.round(a * 100) / 100, Math.round(Math.min(b, half) * 10) / 10])
  }
  return out
}

// The best shape for part k of a roof with these cuts, from the cells in it.
function fitPart(ring: XZ[], cells: Cell[], head: [number, number, number, number[]], k: number, coarse = false): Fit | null {
  const n = head[3].length + 1
  const rec = (p: RoofPart) => [...head, ...Array.from({ length: n }, (_, i) => (i === k ? p : ['flat', 1]))] as Roof
  const all = cells.filter(([x, z]) => partAt(rec(['flat', 1]), x, z) === k)
  if (all.length < ROOF.MIN_CELLS) return null
  // (At most FIT_CELLS of them, evenly through: a big block's roof is no clearer for its thousands.)
  const stride = Math.max(1, all.length / ROOF.FIT_CELLS)
  const mine = Array.from({ length: Math.min(all.length, ROOF.FIT_CELLS) }, (_, i) => all[Math.floor(i * stride)])
  const h = Float64Array.from(mine, (c) => c[2])
  const ext0 = roofParts(ring, rec(['gable', 0, 0, 1, 0.5]), true)[k].extent as [number, number, number, number]
  const ext1 = roofParts(ring, rec(['gable', 1, 0, 1, 0.5]), true)[k].extent as [number, number, number, number]
  let best: Fit | null = null
  const t = new Float64Array(mine.length)
  for (const shape of shapes(ext0, ext1, coarse)) {
    const { planes } = roofParts(ring, rec(shape), true)[k]
    for (let i = 0; i < mine.length; i++) {
      let v = Infinity
      for (const [A, B, C] of planes) v = Math.min(v, A + B * mine[i][0] + C * mine[i][1])
      t[i] = v
    }
    const flat = shape[0] === 'flat'
    const { e, k: rise, cost } = robustLine(t, h, flat)
    if (e < ROOF.MIN_EAVES) continue // (the garden, or the ground through a gap)
    if (!flat) {
      if (rise < ROOF.MIN_RISE) continue
      // The steepest run from eaves to ridge.
      const [, , v0, v1] = shape[1] % 2 ? ext1 : ext0
      const w = v1 - v0
      const run = shape[0] === 'shed' ? w : Math.min(w * shape[4], w * (1 - shape[4]), shape[0] === 'hip' ? shape[5] : Infinity)
      if (rise / run > (shape[0] === 'shed' ? ROOF.MAX_SHED : ROOF.MAX_SLOPE)) continue
    }
    const score = cost + ROOF.PENALTY[shape[0]]
    if (best && score >= best.cost + ROOF.PENALTY[best.part[0]]) continue
    const [r1, e1] = [Math.round((e + rise) * 10) / 10, Math.round(e * 10) / 10]
    const part2: RoofPart = shape[0] === 'flat' ? ['flat', Math.round(e * 10) / 10] : shape[0] === 'shed' ? ['shed', shape[1], e1, r1] : shape[0] === 'gable' ? ['gable', shape[1], e1, r1, shape[4]] : ['hip', shape[1], e1, r1, shape[4], shape[5]]
    best = { part: part2, cost, n: all.length }
  }
  return best
}

/** How a roof record sits on the cells: the share within TAU of it, and their RMS. */
export function roofError(ring: XZ[], rec: Roof, cells: Cell[]): { inliers: number; rms: number; median: number } {
  const parts = roofParts(ring, rec)
  const res = cells.map(([x, z, h]) => h - surfaceAt(parts[partAt(rec, x, z)].planes, x, z))
  const near = res.filter((r) => Math.abs(r) < ROOF.TAU)
  const abs = res.map(Math.abs).sort((a, b) => a - b)
  return { inliers: near.length / res.length, rms: Math.sqrt(near.reduce((a, r) => a + r * r, 0) / (near.length || 1)), median: abs[Math.floor(abs.length / 2)] ?? 0 }
}

// The footprint's main directions (degrees, mod 90): its edges' by length, the first and any other with a third of its weight.
function directions(ring: XZ[]): number[] {
  const bins = new Array(90).fill(0)
  for (let i = 0; i < ring.length; i++) {
    const [p, q] = [ring[i], ring[(i + 1) % ring.length]]
    const len = Math.hypot(q[0] - p[0], q[1] - p[1])
    const deg = ((((Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI) % 90) + 90) % 90
    for (let d = -2; d <= 2; d++) bins[(Math.round(deg) + d + 90) % 90] += len * (3 - Math.abs(d))
  }
  const peak = (skip: number[]) => {
    let best = -1
    for (let i = 0; i < 90; i++) if (!skip.some((s) => Math.min(Math.abs(i - s), 90 - Math.abs(i - s)) < 10) && (best < 0 || bins[i] > bins[best])) best = i
    return best
  }
  const first = peak([])
  // The exact angle: the length-weighted mean of the edges near the peak.
  const exact = (deg: number) => {
    let [sx, sz] = [0, 0]
    for (let i = 0; i < ring.length; i++) {
      const [p, q] = [ring[i], ring[(i + 1) % ring.length]]
      const a = Math.atan2(q[1] - p[1], q[0] - p[0]) * 4 // (mod 90: four times the angle)
      const d = ((((a / 4) * 180) / Math.PI - deg) % 90 + 135) % 90 - 45
      if (Math.abs(d) > 5) continue
      const len = Math.hypot(q[0] - p[0], q[1] - p[1])
      sx += Math.cos(a) * len
      sz += Math.sin(a) * len
    }
    return Math.round(((((Math.atan2(sz, sx) / 4) * 180) / Math.PI + 90) % 90) * 10) / 10
  }
  const second = peak([first])
  return second >= 0 && bins[second] * 3 >= bins[first] ? [exact(first), exact(second)] : [exact(first)]
}

/**
 * A plain building's roof from the lidar over it: flat, shed, gable or hip,
 * in up to MAX_PARTS parts split across its length where one shape doesn't fit
 * (a terrace stepping down a hill, an L of two ridges). `cells` are [x, z,
 * height above the building's ground] about every metre over it; those within
 * EDGE of its walls are left out (where the map's footprint is a metre off,
 * they're garden). Refused, as [cx, cz, reason], where there are too few
 * cells, the best fit is noisy, or a house's eaves stand over three storeys
 * (a tree over it). Heights to the decimetre.
 */
export function fitRoof(ring: XZ[], cells: Cell[], kind: string): Roof {
  const cx = Math.round((ring.reduce((a, p) => a + p[0], 0) / ring.length) * 10) / 10
  const cz = Math.round((ring.reduce((a, p) => a + p[1], 0) / ring.length) * 10) / 10
  const edgeDist = (x: number, z: number) => edgeDistance(ring, x, z)
  const within = cells.filter(([x, z]) => inside(ring, x, z))
  const inner = within.filter(([x, z]) => edgeDist(x, z) >= ROOF.EDGE)
  const use = inner.length >= ROOF.MIN_CELLS ? inner : within
  if (use.length < ROOF.MIN_CELLS) return [cx, cz, 'few']
  type Cand = { rec: Roof; score: number; err: ReturnType<typeof roofError> }
  const judge = (rec: Roof, fits: Fit[]): Cand => {
    const n = fits.reduce((a, f) => a + f.n, 0)
    const cost = fits.reduce((a, f) => a + f.cost * f.n, 0) / n
    return { rec, score: cost + fits.reduce((a, f) => a + ROOF.PENALTY[f.part[0]], 0) + ROOF.PART * (fits.length - 1), err: roofError(ring, rec, use) }
  }
  let best: Cand | null = null
  const angles = directions(ring)
  for (const angle of angles) {
    const f = fitPart(ring, use, [cx, cz, angle, []], 0)
    if (!f) continue
    const c = judge([cx, cz, angle, [], f.part], [f])
    if (!best || c.score < best.score) best = c
  }
  if (!best) return [cx, cz, 'few']
  // Split where one shape doesn't fit: greedily, a cut at a time.
  const poor = (c: Cand) => c.err.rms > ROOF.SPLIT_RMS || c.err.inliers < ROOF.SPLIT_INLIERS
  for (let parts = 2; parts <= ROOF.MAX_PARTS && poor(best); parts++) {
    let next: Cand | null = null
    const angleList = best.rec.length > 3 && (best.rec[3] as number[]).length ? [best.rec[2] as number] : angles
    for (const angle of angleList) {
      const t = (Math.PI / 180) * angle
      const us = ring.map(([x, z]) => (x - cx) * Math.cos(t) + (z - cz) * Math.sin(t))
      const old = best.rec[2] === angle ? (best.rec[3] as number[]) : []
      if (old.length !== parts - 2) continue
      const step = Math.max(1, (Math.max(...us) - Math.min(...us)) / 24)
      for (let c = Math.min(...us) + ROOF.MIN_PART; c <= Math.max(...us) - ROOF.MIN_PART; c += step) {
        const cuts = [...old, Math.round(c * 10) / 10].sort((a, b) => a - b)
        if (cuts.some((v, i) => i > 0 && v - cuts[i - 1] < ROOF.MIN_PART)) continue
        const fits = cuts.concat([0]).map((_, k) => fitPart(ring, use, [cx, cz, angle, cuts], k, true))
        if (fits.some((f) => !f)) continue
        const cand = judge([cx, cz, angle, cuts, ...fits.map((f) => f!.part)] as Roof, fits as Fit[])
        if (!next || cand.score < next.score) next = cand
      }
    }
    if (!next || next.score >= best.score) break
    best = next
  }
  // The parts' shapes tried finely at the cuts found.
  if ((best.rec[3] as number[]).length) {
    const [, , angle, cuts] = best.rec as [number, number, number, number[]]
    const fits = cuts.concat([0]).map((_, k) => fitPart(ring, use, [cx, cz, angle, cuts], k))
    if (fits.every((f) => f)) {
      const fine = judge([cx, cz, angle, cuts, ...fits.map((f) => f!.part)] as Roof, fits as Fit[])
      if (fine.score <= best.score) best = fine
    }
  }
  const rec = best.rec as [number, number, number, number[], ...RoofPart[]]
  const parts = rec.slice(4) as RoofPart[]
  if (best.err.inliers < ROOF.INLIERS || best.err.rms > ROOF.NOISY) return [cx, cz, 'noisy']
  const eaves = Math.min(...parts.map((p) => (p[0] === 'flat' ? p[1] : p[2])))
  if (kind === 'house' && eaves > HOUSE_EAVES) return [cx, cz, 'tall']
  return rec
}

/**
 * How far the lidar's buildings stand from the map's footprints (a group of
 * them touching, as a terrace, which only shows its offset as a whole): the shift
 * (dx, dz), within REGISTER metres every half metre, that puts the most of
 * the footprint over something HIGH (m) and the least of a 2 m band round it.
 * The footprints are often 2-3 m off the lidar's roofs (the map traced off
 * offset imagery, and the datum shift is good to a few metres), enough to put
 * a terraced house's ridge on its wall. `high(x, z)` is whether the first
 * surface there is over HIGH, null off the lidar. Returns the best shift and
 * the score of every shift tried (key "dx,dz").
 */
export function registerFootprint(rings: XZ[][], high: (x: number, z: number) => boolean | null): { shift: XZ; score: Map<string, number> } {
  const xs = rings.flat().map((p) => p[0])
  const zs = rings.flat().map((p) => p[1])
  const [inPts, outPts]: [XZ[], XZ[]] = [[], []]
  for (let x = Math.floor(Math.min(...xs)) - 2; x <= Math.max(...xs) + 2; x++) for (let z = Math.floor(Math.min(...zs)) - 2; z <= Math.max(...zs) + 2; z++) {
    const p: XZ = [x + 0.5, z + 0.5]
    if (rings.some((ring) => inside(ring, ...p))) inPts.push(p)
    else if (rings.some((ring) => edgeDistance(ring, ...p) < 2)) outPts.push(p)
  }
  const score = new Map<string, number>()
  let shift: XZ = [0, 0]
  let best = -Infinity
  const share = (pts: XZ[], dx: number, dz: number) => {
    let [n, hit] = [0, 0]
    for (const [x, z] of pts) { const v = high(x + dx, z + dz); if (v === null) continue; n++; if (v) hit++ }
    return n * 2 < pts.length ? null : hit / n
  }
  for (let dx = -REGISTER; dx <= REGISTER; dx += 0.5) for (let dz = -REGISTER; dz <= REGISTER; dz += 0.5) {
    const [a, b] = [share(inPts, dx, dz), share(outPts, dx, dz)]
    if (a === null || b === null) continue
    // (A little for the distance, so a footprint inside a bigger roof stays put.)
    const s = a - b - 0.005 * Math.hypot(dx, dz)
    score.set(`${dx},${dz}`, s)
    if (s > best) { best = s; shift = [dx, dz] }
  }
  return { shift, score }
}
export const REGISTER = 4
export const HIGH = 1.8

function edgeDistance(ring: XZ[], x: number, z: number): number {
  let d = Infinity
  for (let i = 0; i < ring.length; i++) {
    const [p, q] = [ring[i], ring[(i + 1) % ring.length]]
    const [dx, dz] = [q[0] - p[0], q[1] - p[1]]
    const t = Math.max(0, Math.min(1, ((x - p[0]) * dx + (z - p[1]) * dz) / (dx * dx + dz * dz || 1)))
    d = Math.min(d, Math.hypot(x - p[0] - dx * t, z - p[1] - dz * t))
  }
  return d
}

/**
 * Every plain building's roof in the patch (not landmarks or styled
 * buildings): fitRoof over the first surface every metre inside it, as height
 * above the ground at its middle (as the game stands it), read where the
 * lidar's building is (registerFootprint). A building takes its neighbours'
 * shift (the median of those within NEIGHBOURS m) where that fits it nearly
 * as well as its own best: a row of houses traced off the same imagery is off
 * by the same, and a small roof's own best is often one of several as good.
 */
export const NEIGHBOURS = 80
export function deriveRoofs(h: Heights, buildings: Building[], [x0, z0, x1, z1]: Patch, groundAt: (x: number, z: number) => number): { roofs: Roof[]; shifts: XZ[]; errors: Array<ReturnType<typeof roofError> | null>; cells: Cell[][] } {
  const high = (x: number, z: number) => { const a = h.above(x, z); return a === null ? null : a > HIGH }
  const todo = buildings.flatMap((b) => {
    if (b.style) return []
    const closed = b.shape[0][0] === b.shape.at(-1)![0] && b.shape[0][1] === b.shape.at(-1)![1]
    const ring = closed ? b.shape.slice(0, -1) : b.shape
    if (ring.length < 3) return []
    const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length
    const cz = ring.reduce((a, p) => a + p[1], 0) / ring.length
    if (cx < x0 || cx > x1 || cz < z0 || cz > z1) return []
    return [{ b, ring, cx, cz, reg: { shift: [0, 0] as XZ, score: new Map<string, number>() } }]
  })
  // Footprints touching (within a metre) are registered together: a terrace's houses are alike, so each alone could slide along the row.
  const group = todo.map((_, i) => i)
  const root = (i: number): number => (group[i] === i ? i : (group[i] = root(group[i])))
  const boxes = todo.map((t) => [Math.min(...t.ring.map((p) => p[0])), Math.min(...t.ring.map((p) => p[1])), Math.max(...t.ring.map((p) => p[0])), Math.max(...t.ring.map((p) => p[1]))])
  for (let i = 0; i < todo.length; i++) for (let j = i + 1; j < todo.length; j++) {
    const [a, b] = [boxes[i], boxes[j]]
    if (a[0] > b[2] + 1 || b[0] > a[2] + 1 || a[1] > b[3] + 1 || b[1] > a[3] + 1) continue
    if (todo[i].ring.some((p) => edgeDistance(todo[j].ring, ...p) < 1) || todo[j].ring.some((p) => edgeDistance(todo[i].ring, ...p) < 1)) group[root(i)] = root(j)
  }
  const groups = new Map<number, number[]>()
  todo.forEach((_, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), i]))
  for (const members of groups.values()) {
    const reg = registerFootprint(members.map((i) => todo[i].ring), high)
    for (const i of members) todo[i].reg = reg
  }
  const roofs: Roof[] = []
  const shifts: XZ[] = []
  const errors: Array<ReturnType<typeof roofError> | null> = []
  const all: Cell[][] = []
  for (const t of todo) {
    const near = todo.filter((o) => Math.hypot(o.cx - t.cx, o.cz - t.cz) < NEIGHBOURS && o.reg.score.size)
    const med = (k: 0 | 1) => Math.round(median(near.map((o) => o.reg.shift[k])) * 2) / 2
    let shift = t.reg.shift
    if (near.length >= 3) {
      const theirs: XZ = [med(0), med(1)]
      const [own, other] = [t.reg.score.get(`${shift[0]},${shift[1]}`), t.reg.score.get(`${theirs[0]},${theirs[1]}`)]
      if (own !== undefined && other !== undefined && other >= own - 0.05) shift = theirs
    }
    shifts.push(shift)
    const base = groundAt(t.cx, t.cz)
    const xs = t.ring.map((p) => p[0])
    const zs = t.ring.map((p) => p[1])
    const cells: Cell[] = []
    for (let x = Math.floor(Math.min(...xs)); x <= Math.max(...xs); x++) for (let z = Math.floor(Math.min(...zs)); z <= Math.max(...zs); z++) {
      const [px, pz] = [x + 0.5 + shift[0], z + 0.5 + shift[1]]
      const [g, a] = [h.ground(px, pz), h.above(px, pz)]
      if (g !== null && a !== null) cells.push([x + 0.5, z + 0.5, g + a - base])
    }
    const roof = fitRoof(t.ring, cells, t.b.kind)
    const within = cells.filter(([x, z]) => inside(t.ring, x, z))
    roofs.push(roof)
    all.push(within)
    errors.push(Array.isArray(roof[3]) ? roofError(t.ring, roof, within) : null)
  }
  return { roofs, shifts, errors, cells: all }
}

/** games/reading-thames/lidar.js. */
export function lidarModule(blocks: Record<string, string>, buildings: Array<[number, number, number]>, trees: Array<[number, number, number]>, where: string, woods?: { step: number; sides: Array<Array<number | null>> }, edge?: { step: number; sides: Array<Array<number | null>> }, skyline?: { step: number; sides: Array<Array<number | null>> }, roofs?: Roof[]): string {
  const keys = Object.keys(blocks).sort((a, b) => { const [p, q] = [a, b].map((k) => k.split(',').map(Number)); return p[1] - q[1] || p[0] - q[0] })
  return `// The ground, buildings and trees ${where}, from Environment Agency lidar (the
// 1 m composite: bare ground, and the first surface the laser met). © Environment
// Agency copyright and/or database right, under the Open Government Licence v3.
// Only numbers worked out from it are here, not the lidar itself. Game metres (x
// east, z south of 51.46175, -0.96945); heights in metres above the river. Made
// by \`pnpm --filter web course:lidar\` (apps/web/scripts/courses/lidar.ts).
export const LIDAR = {
  // The bare ground every \`cell\` metres, in blocks \`block\` metres square: block
  // "i,j" from (i * block, j * block), its (block / cell + 1)² points row by row
  // southward, in decimetres, each row's first and then the steps along it.
  // Under the water: the bank top nearest it. Only where the game has land.
  ground: {
    cell: ${GROUND_CELL}, block: ${BLOCK}, blocks: {
${keys.map((k) => `      '${k}': '${blocks[k]}',`).join('\n')}
    },
  },
  // Plain buildings' heights to the eaves, by the middle of their footprint
  // (x, z, height): the height that puts the game's roof where lidar's is.
  buildings: ${JSON.stringify(buildings)},${roofs ? `
  // Plain buildings' roofs as the lidar shapes them, by the middle of their
  // footprint: [x, z, angle, cuts, ...parts] (roofs.js reads them: flat, shed,
  // gable or hip, heights above the ground there), or [x, z, why not] where
  // the lidar was too thin ('few'), too noisy ('noisy') or a tree ('tall').
  roofs: ${JSON.stringify(roofs)},` : ''}
  // The trees' crowns (x, z, height above the ground): the highest points of the
  // canopy, clear of buildings, spaced by their size.
  trees: ${JSON.stringify(trees)},${woods ? `
  // How wooded each bank is every \`step\` metres up the river, [left, right]: the
  // share of the 14 m by the water under canopy over 3 m (null: not measured).
  woods: { step: ${woods.step}, sides: ${JSON.stringify(woods.sides)} },` : ''}${edge ? `
  // The leaves at the water's edge every \`step\` metres, [left, right]: the canopy's
  // height in the first 8 m (null: none, or not measured).
  edge: { step: ${edge.step}, sides: ${JSON.stringify(edge.sides)} },` : ''}${skyline ? `
  // How high each bank's trees stand as the water mirrors them, every \`step\`
  // metres, [left, right]: crowns out to 60 m back, each as high as it shows at
  // the edge from 20 m out on the water (null: not measured).
  skyline: { step: ${skyline.step}, sides: ${JSON.stringify(skyline.sides)} },` : ''}
};
`
}
