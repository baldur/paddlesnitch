// The land round the Reading game's river out to 1 km (the drone sees it): which
// Environment Agency tiles and OpenStreetMap buildings that takes, and the
// numbers games/reading-thames/surroundings/ holds, block by block. Pure; tested
// in surroundings.test.ts. See course:surroundings.
import type { LatLng, XZ } from './river'
import { inside } from './lidar'

/** How far from the water's edge the surroundings go (metres). */
export const BAND = 1000
/** The game's land (world.js realLand) reaches this far from the water's edge; the surroundings take over beyond. */
export const INNER = 320
/** The blocks the surroundings are cut into (game metres, lined up with x and z), and their ground's cell. */
export const SURROUND_BLOCK = 500
export const SURROUND_CELL = 10

/** The EA's 250 m squares, as the corridor's were fetched: south-west corners 200 m east and 150 m north of the 250 m grid. */
export const TILE = 250
const TILE_E = 200
const TILE_N = 150

/** The south-west corner of the 250 m square that (E, N) is in. */
export function tileOf(E: number, N: number): [number, number] {
  return [Math.floor((E - TILE_E) / TILE) * TILE + TILE_E, Math.floor((N - TILE_N) / TILE) * TILE + TILE_N]
}

/** Every square any of the points falls in, west to east, then south to north. */
export function tilesFor(points: Iterable<[number, number]>): Array<[number, number]> {
  const seen = new Map<string, [number, number]>()
  for (const [E, N] of points) {
    const t = tileOf(E, N)
    seen.set(t.join(','), t)
  }
  return [...seen.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0])
}

/** The EA's 1 m composite coverages (OGL v3, no key), on its own WCS endpoints. */
export const COVERAGES = {
  dtm: { service: 'lidar-composite-digital-terrain-model-dtm-1m', id: '13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m' },
  dsm: { service: 'lidar-composite-digital-surface-model-first-return-dsm-1m', id: 'df4e3ec3-315e-48aa-aaaf-b5ae74d7b2bb__Lidar_Composite_Elevation_FZ_DSM_1m' },
  vom: { service: 'vegetation-object-model', id: 'ecae3bef-1e1d-4051-887b-9dc613c928ec__Vegetation_Object_Model_Elevation_2022' },
} as const
export type Kind = keyof typeof COVERAGES

/** The file a square is kept in, as course:lidar reads it (dtm-E-N.tif). */
export const tileName = (kind: Kind, [E, N]: [number, number]) => `${kind}-${E}-${N}.tif`

/** One square as a float32 GeoTIFF from the EA's WCS (the same bytes as the corridor's tiles). */
export function coverageUrl(kind: Kind, [E, N]: [number, number]): string {
  const { service, id } = COVERAGES[kind]
  return `https://environment.data.gov.uk/spatialdata/${service}/wcs?service=WCS&version=2.0.1&request=GetCoverage&CoverageId=${id}&format=image/tiff&SUBSET=E(${E},${E + TILE})&SUBSET=N(${N},${N + TILE})`
}

/** Overpass: every building within `radius` metres of the line (lat/lng points along the river). */
export function buildingsQuery(line: LatLng[], radius: number): string {
  const coords = line.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(',')
  return `[out:json][timeout:180];(way["building"](around:${radius},${coords}););out geom;`
}

type El = { type: string; id: number; tags?: Record<string, string>; geometry?: Array<{ lat: number; lon: number } | null> }
export type Footprint = { id: number; shape: XZ[]; kind: 'house' | 'flats' | 'boathouse' | 'other'; height: number }

// As course-file.ts maps OSM's buildings (its kinds, heights and thinning to 12 points).
const HEIGHTS = { house: 7, flats: 12, boathouse: 6, other: 6 }
const kindOf = (tags: Record<string, string>): Footprint['kind'] =>
  tags.building === 'boathouse' ? 'boathouse'
    : tags.building === 'apartments' ? 'flats'
    : ['house', 'detached', 'semidetached_house', 'terrace', 'residential', 'bungalow', 'yes'].includes(tags.building) ? 'house'
    : 'other'
const r1 = (v: number) => Math.round(v * 10) / 10
function thin(shape: XZ[], max: number): XZ[] {
  if (shape.length <= max) return shape
  const n = Math.ceil(shape.length / max)
  return shape.filter((_, i) => i % n === 0 || i === shape.length - 1)
}

/** Overpass's buildings as footprints in game metres (closed rings of 4 points or more). */
export function footprints(elements: El[], toXZ: (p: LatLng) => XZ): Footprint[] {
  const out: Footprint[] = []
  for (const e of elements) {
    if (e.type !== 'way' || !e.tags?.building) continue
    const g = (e.geometry ?? []).filter((p): p is { lat: number; lon: number } => !!p)
    if (g.length < 4) continue
    const kind = kindOf(e.tags)
    const levels = Number(e.tags['building:levels'])
    const height = Number.isFinite(levels) && levels > 0 ? levels * 3 + 1 : HEIGHTS[kind]
    out.push({ id: e.id, shape: thin(g.map((p) => toXZ([p.lat, p.lon])), 12).map(([x, z]) => [r1(x), r1(z)]), kind, height })
  }
  return out
}

const ringOf = (shape: XZ[]) => (shape[0][0] === shape.at(-1)![0] && shape[0][1] === shape.at(-1)![1] ? shape.slice(0, -1) : shape)
export const middle = (shape: XZ[]): XZ => { const r = ringOf(shape); return [r.reduce((a, p) => a + p[0], 0) / r.length, r.reduce((a, p) => a + p[1], 0) / r.length] }

/**
 * The footprints the game doesn't already draw: none whose middle is inside one
 * of `known` (the course file's buildings), or within 2 m of one's middle.
 */
export function newFootprints(all: Footprint[], known: Array<{ shape: XZ[] }>): Footprint[] {
  const mids = known.map((b) => middle(b.shape))
  return all.filter((f) => {
    const c = middle(f.shape)
    return !known.some((b, k) => Math.hypot(mids[k][0] - c[0], mids[k][1] - c[1]) < 2 || inside(b.shape, c[0], c[1]))
  })
}

/**
 * A footprint's ground and height from the lidar: `ground` its middle's bare
 * ground, `base` its lowest corner's (the walls go down to it), `height` to the
 * eaves (the roof as world.js draws it: a pitched one's rise taken off), from
 * the 95th (pitched) or 90th percentile of the first surface over it. The
 * mapped height where the lidar has fewer than 8 metres of it, or a house over
 * three storeys (that's a tree over it). Metres above the river.
 */
export function measureFootprint(f: Footprint, ground: (x: number, z: number) => number | null, surface: (x: number, z: number) => number | null): { ground: number; base: number; height: number } | null {
  const ring = ringOf(f.shape)
  const c = middle(f.shape)
  const g = ground(...c)
  if (g === null) return null
  const corners = ring.map(([x, z]) => ground(x, z)).filter((v): v is number => v !== null)
  const base = Math.min(g, ...corners)
  const xs = ring.map((p) => p[0])
  const zs = ring.map((p) => p[1])
  const tops: number[] = []
  for (let x = Math.floor(Math.min(...xs)); x <= Math.max(...xs); x++) for (let z = Math.floor(Math.min(...zs)); z <= Math.max(...zs); z++) {
    if (!inside(ring, x + 0.5, z + 0.5)) continue
    const s = surface(x + 0.5, z + 0.5)
    if (s !== null) tops.push(s)
  }
  const pitched = f.kind === 'house' || f.kind === 'boathouse'
  let height = f.height
  if (tops.length >= 8) {
    tops.sort((a, b) => a - b)
    const top = tops[Math.min(tops.length - 1, Math.floor((pitched ? 0.95 : 0.9) * tops.length))]
    const measured = Math.max(2.5, top - g - (pitched ? roofRise(ring) : 0))
    if (!(f.kind === 'house' && measured > 10)) height = measured
  }
  return { ground: r1(g), base: r1(base), height: r1(height) }
}

/** A pitched roof's rise over its eaves, as world.js draws it (from the footprint's area). */
export function roofRise(ring: XZ[]): number {
  let a = 0
  for (let i = 0; i < ring.length; i++) { const [p, q] = [ring[i], ring[(i + 1) % ring.length]]; a += p[0] * q[1] - q[0] * p[1] }
  return Math.min(4, 1.5 + Math.sqrt(Math.abs(a / 2)) * 0.18)
}

/** The block (keys "i,j", SURROUND_BLOCK square) a point is in. */
export const blockKey = (x: number, z: number) => `${Math.floor(x / SURROUND_BLOCK)},${Math.floor(z / SURROUND_BLOCK)}`

/**
 * A block's grid of numbers (n × n, row by row southward) as text: each row's
 * first and then the steps along it (small numbers, which compress well), as
 * lidar.js's ground is written.
 */
export function rowSteps(values: ArrayLike<number>, n: number): string {
  const out: number[] = []
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out.push(c === 0 ? values[r * n] : values[r * n + c] - values[r * n + c - 1])
  return out.join(',')
}

/** rowSteps back to the grid (surroundings.js reads it so). */
export function fromRowSteps(text: string, n: number): Int32Array {
  const v = Int32Array.from(text.split(','), Number)
  for (let r = 0; r < n; r++) for (let c = 1; c < n; c++) v[r * n + c] += v[r * n + c - 1]
  return v
}

/**
 * How far to take the surroundings' ground down to a metre under the game's
 * land where they meet (0 none, 1 all the way): `inside` is how far the point is
 * inside the land (negative outside it). All the way under the land's last 30 m
 * (its rows there are 100 m apart, straight between, so the true ground can
 * stand above them), eased to nothing 40 m outside, so the two never poke
 * through each other and leave no gap.
 */
export function seamSink(inside: number): number {
  if (inside >= 0) return 1
  const t = Math.max(0, 1 + inside / 40)
  return t * t * (3 - 2 * t)
}

/** What a ground cell is: drawn as grass, under trees, built up, water, or not drawn (the game's land is there). */
export const CELL = { grass: 0, woods: 1, town: 2, water: 3, none: 4 } as const

/**
 * A cell's kind from what's in it: `canopy` the share of it under trees over 3 m,
 * `built` the share under buildings, `wet` whether its ground is the lidar's water.
 */
export function cellKind({ canopy, built, wet, covered }: { canopy: number; built: number; wet: boolean; covered: boolean }): number {
  if (covered) return CELL.none
  if (wet) return CELL.water
  if (built > 0.12) return CELL.town
  if (canopy > 0.5) return CELL.woods
  return CELL.grass
}

/** Runs of the same digit as "<digit><count>" pairs ("04,22": four 0s, then two 2s). */
export function runs(cells: ArrayLike<number>): string {
  const out: string[] = []
  for (let i = 0; i < cells.length;) {
    let j = i
    while (j < cells.length && cells[j] === cells[i]) j++
    out.push(`${cells[i]}${j - i}`)
    i = j
  }
  return out.join(',')
}

/**
 * A block's file (games/reading-thames/surroundings/<i>_<j>.json): its ground
 * every SURROUND_CELL m in decimetres above the river (rowSteps), each cell's
 * kind (runs), and its buildings and trees relative to the block's corner in
 * decimetres: [x, z, ..., ground, base, height, kind] per building (kind 0
 * house, 1 flats, 2 boathouse, 3 other) and [x, z, height] per tree; and the
 * buildings' roofs the lidar fitted, by their number (game metres, as lidar.js).
 */
export function blockFile(at: { i: number; j: number }, ground: ArrayLike<number>, cells: ArrayLike<number>, buildings: Array<{ shape: XZ[]; kind: Footprint['kind']; ground: number; base: number; height: number; roof?: unknown[] }>, trees: Array<[number, number, number]>, roads?: BlockRoads): string {
  const [x0, z0] = [at.i * SURROUND_BLOCK, at.j * SURROUND_BLOCK]
  const dm = (v: number) => Math.round(v * 10)
  const kinds = ['house', 'flats', 'boathouse', 'other']
  return JSON.stringify({
    i: at.i, j: at.j, cell: SURROUND_CELL,
    ground: rowSteps(ground, SURROUND_BLOCK / SURROUND_CELL + 1),
    cells: runs(cells),
    buildings: buildings.map((b) => [...ringOf(b.shape).flatMap(([x, z]) => [dm(x - x0), dm(z - z0)]), dm(b.ground), dm(b.base), dm(b.height), kinds.indexOf(b.kind)]),
    trees: trees.map(([x, z, h]) => [dm(x - x0), dm(z - z0), dm(h)]),
    // Each fitted roof (lib/lidar.ts fitRoof, as lidar.js's `roofs`): [the building's number, ...its record].
    roofs: buildings.flatMap((b, k) => (Array.isArray(b.roof?.[3]) ? [[k, ...b.roof!]] : [])),
    // Its roads and paved areas (lib/roads.ts encodeRoads, from the block's
    // corner), and those on the game's own land, laid on it already (blockRoads).
    ...(roads && (roads.roads.length || roads.areas.length || roads.landRoads.length || roads.landAreas.length) ? roads : {}),
  })
}

/** A block's roads as its file holds them (see blockFile, blockRoads). */
export type BlockRoads = { roads: number[][]; areas: number[][]; landRoads: number[][]; landAreas: number[][] }

/**
 * The roads on the game's own land past the riverside's (only the drone sees
 * them), laid on that land offline (games/reading-thames/roads.js layRoad,
 * layArea): per road [look, width in decimetres, bridge 0/1, then each section's
 * x, z (decimetres from the block's corner), left and right ground height
 * (centimetres), each after the first as steps]; per area [look, then its
 * triangles' corners as x, y, z the same way].
 */
export function landRoadsFile(at: { i: number; j: number }, roads: Array<{ look: number; width: number; bridge: boolean; sections: Array<{ x: number; z: number; yl: number; yr: number }> }>, areas: Array<{ look: number; tris: number[][][] }>): { landRoads: number[][]; landAreas: number[][] } {
  const [x0, z0] = [at.i * SURROUND_BLOCK, at.j * SURROUND_BLOCK]
  const steps = (rows: number[][]) => {
    const out: number[] = []
    let prev: number[] = rows[0].map(() => 0)
    for (const row of rows) { out.push(...row.map((v, k) => v - prev[k])); prev = row }
    return out
  }
  const dm = (v: number) => Math.round(v * 10)
  // (Heights in centimetres, rounded up: a road drawn 10 cm over the land, laid to 5 cm in decimetres, could meet it.)
  const cm = (v: number) => Math.ceil(v * 100)
  return {
    landRoads: roads.map((r) => [r.look, dm(r.width), r.bridge ? 1 : 0, ...steps(r.sections.map((s) => [dm(s.x - x0), dm(s.z - z0), cm(s.yl), cm(s.yr)]))]),
    landAreas: areas.map((a) => [a.look, ...steps(a.tris.flat().map(([x, y, z]) => [dm(x - x0), cm(y), dm(z - z0)]))]),
  }
}
