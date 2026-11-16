// The small waterside buildings OpenStreetMap doesn't have and Ordnance
// Survey's OpenMap Local does (sheds, boat stores, kiosks by the water): the
// pure parts of course:sheds (sheds.ts).
import type { XZ } from './river'

type Ring = XZ[]

/** The polygons in an ESRI shapefile (.shp) whose box meets [E0, N0, E1, N1]: each one's first ring, in the file's own coordinates. */
export function shapefilePolygons(b: Buffer, [E0, N0, E1, N1]: [number, number, number, number]): Ring[] {
  const out: Ring[] = []
  for (let o = 100; o + 8 <= b.length;) {
    const len = b.readInt32BE(o + 4) * 2
    const r = o + 8
    o = r + len
    if (b.readInt32LE(r) !== 5) continue // polygons only
    const [xmin, ymin, xmax, ymax] = [0, 8, 16, 24].map((k) => b.readDoubleLE(r + 4 + k))
    if (xmax < E0 || xmin > E1 || ymax < N0 || ymin > N1) continue
    const parts = b.readInt32LE(r + 36)
    const points = b.readInt32LE(r + 40)
    const end = parts > 1 ? b.readInt32LE(r + 48) : points
    const at = r + 44 + parts * 4
    const ring: Ring = []
    for (let k = b.readInt32LE(r + 44); k < end; k++) ring.push([b.readDoubleLE(at + k * 16), b.readDoubleLE(at + k * 16 + 8)])
    out.push(ring)
  }
  return out
}

export const centre = (p: Ring): XZ => [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length]
export const area = (p: Ring) => Math.abs(p.reduce((a, q, i) => { const n = p[(i + 1) % p.length]; return a + q[0] * n[1] - n[0] * q[1] }, 0) / 2)
export function inside(poly: Ring, x: number, z: number): boolean {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit
  }
  return hit
}
/** Whether two footprints overlap: either's middle or any corner inside the other. */
export function overlaps(a: Ring, b: Ring): boolean {
  return inside(b, ...centre(a)) || inside(a, ...centre(b)) || b.some(([x, z]) => inside(a, x, z)) || a.some(([x, z]) => inside(b, x, z))
}

/** The footprints in `os` that overlap none of the game's buildings. */
export function missingFrom(os: Ring[], game: Ring[]): Ring[] {
  return os.filter((r) => !game.some((g) => overlaps(r, g)))
}

/**
 * How tall a small building stands, from lidar samples inside its footprint
 * ([surface over ground, vegetation over ground] each): the 80th percentile of
 * the surface where there's no vegetation (a tree over a shed is not the shed),
 * clamped to a shed's 1.8-6 m. Null where every sample is under a tree or
 * missing: the caller uses its usual height.
 */
export function shedHeight(samples: Array<[number | null, number | null]>): number | null {
  const bare = samples.filter(([s, v]) => s !== null && (v ?? 0) < 1.5).map(([s]) => s as number).sort((a, b) => a - b)
  if (bare.length < 3) return null
  const h = bare[Math.min(bare.length - 1, Math.floor(bare.length * 0.8))]
  return Math.round(Math.min(6, Math.max(1.8, h)) * 10) / 10
}
