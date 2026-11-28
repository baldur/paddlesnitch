// The roads and paved areas round the Reading game's river, from OpenStreetMap
// (ODbL): which ways to ask Overpass for, how wide and what each is drawn as,
// and where they're kept off (the water, the houses, the riverside the game
// models from the footage). Pure; tested in roads.test.ts. See course:surroundings.
import type { LatLng, XZ } from './river'
import { inside } from './lidar'

/** Overpass: every highway, car park and mapped road area within `radius` metres of the line. */
export function roadsQuery(line: LatLng[], radius: number): string {
  const coords = line.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(',')
  const around = `(around:${radius},${coords})`
  return `[out:json][timeout:180];(way["highway"]${around};way["amenity"="parking"]${around};way["area:highway"]${around};);out geom;`
}

/**
 * What a road is drawn as: 0 tarmac (a carriageway), 1 paving (a pavement,
 * a pedestrian street, a footway in town), 2 a path (a footpath or cycle path
 * in the open, paler), 3 gravel (a track). The numbers are what the game's
 * files hold (roads.js, surroundings/).
 */
export const LOOK = { tarmac: 0, paving: 1, path: 2, gravel: 3 } as const
export type Look = (typeof LOOK)[keyof typeof LOOK]

// Carriageway widths by class where OSM gives neither `width` nor `lanes`
// (metres, kerb to kerb, as UK roads are built), and each class's look.
const CLASSES: Record<string, { width: number; look: Look }> = {
  motorway: { width: 11, look: LOOK.tarmac },
  trunk: { width: 9, look: LOOK.tarmac },
  primary: { width: 8, look: LOOK.tarmac },
  secondary: { width: 7.3, look: LOOK.tarmac },
  tertiary: { width: 6.5, look: LOOK.tarmac },
  unclassified: { width: 5.5, look: LOOK.tarmac },
  residential: { width: 5.5, look: LOOK.tarmac },
  living_street: { width: 4.5, look: LOOK.paving },
  road: { width: 5.5, look: LOOK.tarmac },
  busway: { width: 6.5, look: LOOK.tarmac },
  service: { width: 3.5, look: LOOK.tarmac },
  pedestrian: { width: 5, look: LOOK.paving },
  track: { width: 2.8, look: LOOK.gravel },
  cycleway: { width: 2, look: LOOK.path },
  footway: { width: 1.6, look: LOOK.path },
  path: { width: 1.4, look: LOOK.path },
  bridleway: { width: 1.8, look: LOOK.path },
  steps: { width: 1.6, look: LOOK.paving },
}
// Link roads (slip roads, junction arms) are a lane or two of their class.
const LINK_WIDTH = 4.5
// A lane's width (UK carriageway lanes are 3-3.65 m), and where a `width` tag is believable.
const LANE = 3.2
const MIN_WIDTH = 0.8
const MAX_WIDTH = 25

/**
 * The width a way is drawn (metres) and its look, or null if it isn't drawn
 * (proposed, under construction, a platform, indoors, or a class with no place
 * on the ground). `width` where it's tagged and believable, else `lanes` × a
 * lane's width (a residential street's two lanes are its default anyway), else
 * the class's default. A `service` lane is narrower still as a driveway or a
 * car park's aisle. A footway that's a pavement beside a road (`footway=sidewalk`)
 * is paving; others in the open, a pale path. A path or cycleway tagged paved
 * (asphalt, paving stones) is paving too; a track tagged paved, tarmac.
 */
export function roadStyle(tags: Record<string, string>): { width: number; look: Look } | null {
  const hw = tags.highway
  if (!hw || tags.area === 'yes' || tags.indoor === 'yes' || tags.level?.startsWith('-')) return null
  const link = hw.endsWith('_link')
  const cls = CLASSES[link ? hw.slice(0, -5) : hw]
  if (!cls) return null
  let width = link ? Math.min(LINK_WIDTH, cls.width) : cls.width
  if (hw === 'service' && (tags.service === 'driveway' || tags.service === 'parking_aisle' || tags.service === 'drive-through')) width = 3
  const lanes = Number(tags.lanes)
  if (Number.isFinite(lanes) && lanes >= 1 && lanes <= 8 && cls.look === LOOK.tarmac) width = Math.max(width, lanes * LANE)
  const tagged = parseWidth(tags.width ?? tags['est_width'])
  if (tagged !== null) width = tagged
  const paved = ['asphalt', 'paved', 'concrete', 'paving_stones', 'sett', 'concrete:plates'].includes(tags.surface)
  const loose = ['gravel', 'fine_gravel', 'compacted', 'dirt', 'ground', 'grass', 'earth', 'mud', 'unpaved', 'pebblestone'].includes(tags.surface)
  let look = cls.look
  if (hw === 'footway' && (tags.footway === 'sidewalk' || tags.footway === 'crossing')) look = LOOK.paving
  else if ((hw === 'path' || hw === 'cycleway' || hw === 'footway' || hw === 'bridleway') && paved) look = LOOK.paving
  else if (hw === 'track' && paved) look = LOOK.tarmac
  else if (look === LOOK.paving && loose) look = LOOK.path
  return { width: Math.round(width * 10) / 10, look }
}

/** A `width` tag in metres ("7", "7.5 m", "3,5"), or null where it isn't one or isn't believable. */
export function parseWidth(v: string | undefined): number | null {
  if (!v) return null
  const m = v.trim().replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*(m|metres?|meters?)?$/i)
  if (!m) return null
  const w = Number(m[1])
  return w >= MIN_WIDTH && w <= MAX_WIDTH ? w : null
}

/**
 * Whether a closed way is a paved area drawn flat on the ground: a car park
 * (surface, not multi-storey or underground), a pedestrian square, or a mapped
 * carriageway's outline (`area:highway`). Its look: tarmac, or paving for a
 * square or footway area.
 */
export function areaStyle(tags: Record<string, string>): Look | null {
  if (tags.amenity === 'parking') return !tags.parking || tags.parking === 'surface' ? LOOK.tarmac : null
  const ah = tags['area:highway']
  if (ah) return ['footway', 'pedestrian', 'cycleway', 'path'].includes(ah) ? LOOK.paving : ah === 'traffic_island' || ah === 'emergency' || ah === 'verge' ? null : LOOK.tarmac
  if (tags.highway === 'pedestrian' && tags.area === 'yes') return LOOK.paving
  return null
}

/** Whether a way is carried over something (a bridge, a viaduct): drawn at its deck, not on the ground. */
export const isBridge = (tags: Record<string, string>) => !!tags.bridge && tags.bridge !== 'no'
/** Whether a way runs under the ground (a tunnel, a covered underpass): not drawn. */
export const isTunnel = (tags: Record<string, string>) => (!!tags.tunnel && tags.tunnel !== 'no') || tags.covered === 'yes' || tags.location === 'underground'

type El = { type: string; id: number; tags?: Record<string, string>; geometry?: Array<{ lat: number; lon: number } | null> }
export type Road = { id: number; line: XZ[]; width: number; look: Look; bridge: boolean }
export type Area = { id: number; ring: XZ[]; look: Look }

const r1 = (v: number) => Math.round(v * 10) / 10

/**
 * Overpass's ways as roads (centrelines in game metres, with width, look and
 * whether it's a bridge) and paved areas (closed rings). Tunnels, and what
 * isn't drawn (roadStyle, areaStyle), are left out.
 */
export function roadsFrom(elements: El[], toXZ: (p: LatLng) => XZ): { roads: Road[]; areas: Area[] } {
  const roads: Road[] = []
  const areas: Area[] = []
  for (const e of elements) {
    if (e.type !== 'way' || !e.tags || isTunnel(e.tags)) continue
    const g = (e.geometry ?? []).filter((p): p is { lat: number; lon: number } => !!p).map((p) => toXZ([p.lat, p.lon])).map(([x, z]): XZ => [r1(x), r1(z)])
    if (g.length < 2) continue
    const area = areaStyle(e.tags)
    const closed = g.length >= 4 && g[0][0] === g.at(-1)![0] && g[0][1] === g.at(-1)![1]
    if (area !== null && closed && !isBridge(e.tags)) { areas.push({ id: e.id, ring: g.slice(0, -1), look: area }); continue }
    const style = roadStyle(e.tags)
    if (style) roads.push({ id: e.id, line: simplify(g, 0.3), ...style, bridge: isBridge(e.tags) })
  }
  return { roads, areas }
}

/** Douglas-Peucker: the line's points that keep it within `tol` metres of itself (its ends always). */
export function simplify(line: XZ[], tol: number): XZ[] {
  if (line.length <= 2) return line
  const keep = new Uint8Array(line.length)
  keep[0] = keep[line.length - 1] = 1
  const stack: Array<[number, number]> = [[0, line.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let [best, at] = [0, -1]
    for (let i = a + 1; i < b; i++) { const d = toSegment(line[i], line[a], line[b]); if (d > best) [best, at] = [d, i] }
    if (best > tol) { keep[at] = 1; stack.push([a, at], [at, b]) }
  }
  return line.filter((_, i) => keep[i])
}

/** The distance from p to the segment a-b. */
export function toSegment([x, z]: XZ, a: XZ, b: XZ): number {
  const [dx, dz] = [b[0] - a[0], b[1] - a[1]]
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)))
  return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t))
}

/**
 * A line cut into the runs where `keep` holds, every `step` metres along it
 * (each run's ends found to within step / 16 by halving), runs shorter than
 * `min` dropped. What clips a road off the water, out of houses and away from
 * what the footage models.
 */
export function keepRuns(line: XZ[], keep: (x: number, z: number) => boolean, step = 1, min = 2): XZ[][] {
  const out: XZ[][] = []
  let run: XZ[] = []
  const close = () => { if (length(run) >= min) out.push(run); run = [] }
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const n = Math.max(1, Math.ceil(len / step))
    const at = (t: number): XZ => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    let was = keep(...a)
    if (i === 1 && was) run.push(a)
    for (let k = 1; k <= n; k++) {
      const t = k / n
      const now = keep(...at(t))
      if (now !== was) {
        // Where it changes, to within a sixteenth of a step.
        let [lo, hi] = [(k - 1) / n, t]
        for (let j = 0; j < 4; j++) { const mid = (lo + hi) / 2; if (keep(...at(mid)) === was) lo = mid; else hi = mid }
        const edge = at(was ? lo : hi)
        if (was) { run.push(edge); close() } else run = [edge]
        was = now
      }
    }
    if (was) run.push(b)
  }
  close()
  return out.map((r) => r.map(([x, z]): XZ => [r1(x), r1(z)])).map((r) => dedupe(r))
}

const dedupe = (line: XZ[]) => line.filter((p, i) => i === 0 || p[0] !== line[i - 1][0] || p[1] !== line[i - 1][1])
export const length = (line: XZ[]) => line.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]) : 0), 0)

/**
 * How far to move a road so it lies on the lidar's open ground: OSM's lines,
 * like its footprints, are a few metres off the laser (lib/lidar.ts
 * registerFootprint). `open(x, z)` is whether the lidar there is bare ground
 * (first surface within 0.5 m of the ground: no roof, no tree). Tries every
 * shift up to `max` metres in half metres and keeps the middle of those that
 * put the most of the road's width over open ground (sampled every metre
 * along); null where too little of the road's lidar is known to tell.
 */
export function registerRoad(line: XZ[], width: number, open: (x: number, z: number) => boolean | null, max = 4): { shift: XZ; before: number; after: number } | null {
  const samples: XZ[] = []
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < 0.01) continue
    const across: XZ = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len]
    for (let d = 0.5; d < len; d += 1) for (const w of [-0.35, 0, 0.35]) samples.push([a[0] + ((b[0] - a[0]) * d) / len + across[0] * w * width, a[1] + ((b[1] - a[1]) * d) / len + across[1] * w * width])
  }
  if (samples.length < 12) return null
  const score = (sx: number, sz: number) => {
    let [yes, seen] = [0, 0]
    for (const [x, z] of samples) { const o = open(x + sx, z + sz); if (o === null) continue; seen++; if (o) yes++ }
    return seen < samples.length * 0.6 ? null : yes / seen
  }
  const before = score(0, 0)
  if (before === null) return null
  const tried: Array<[number, number, number]> = []
  for (let sx = -max; sx <= max; sx += 0.5) for (let sz = -max; sz <= max; sz += 0.5) {
    if (Math.hypot(sx, sz) > max) continue
    const s = score(sx, sz)
    if (s !== null) tried.push([sx, sz, s])
  }
  const after = Math.max(before, ...tried.map((t) => t[2]))
  // Every shift as good as the best (a street's open ground is wider than its
  // samples): their middle, so the road is centred in the open, not at its edge.
  const best = tried.filter((t) => t[2] >= after - 0.01)
  const mid = (k: 0 | 1) => Math.round((best.reduce((a, t) => a + t[k], 0) / best.length) * 2) / 2
  return { shift: [mid(0), mid(1)], before, after }
}

/** Whether (x, z) is inside any of the rings (each with its bounding box, for speed). */
export function inAny(rings: Array<{ ring: XZ[]; box: [number, number, number, number] }>, x: number, z: number, margin = 0): boolean {
  for (const { ring, box } of rings) {
    if (x < box[0] - margin || x > box[2] + margin || z < box[1] - margin || z > box[3] + margin) continue
    if (inside(ring, x, z)) return true
    if (margin > 0) for (let i = 0; i < ring.length; i++) if (toSegment([x, z], ring[i], ring[(i + 1) % ring.length]) < margin) return true
  }
  return false
}
export const withBox = (ring: XZ[]) => ({ ring, box: [Math.min(...ring.map((p) => p[0])), Math.min(...ring.map((p) => p[1])), Math.max(...ring.map((p) => p[0])), Math.max(...ring.map((p) => p[1]))] as [number, number, number, number] })

/**
 * Roads as the game's files hold them: per road [look, width in decimetres,
 * bridge 0/1, then its points as x, z in decimetres from (x0, z0), each after
 * the first as the step from the one before]; per area [look, then its ring
 * the same way].
 */
export function encodeRoads(roads: Array<{ line: XZ[]; width: number; look: Look; bridge: boolean }>, areas: Array<{ ring: XZ[]; look: Look }>, [x0, z0]: XZ = [0, 0]) {
  const steps = (pts: XZ[]) => {
    const out: number[] = []
    let [px, pz] = [0, 0]
    pts.forEach(([x, z], k) => {
      const [qx, qz] = [Math.round((x - x0) * 10), Math.round((z - z0) * 10)]
      out.push(k ? qx - px : qx, k ? qz - pz : qz)
      ;[px, pz] = [qx, qz]
    })
    return out
  }
  return {
    roads: roads.map((r) => [r.look, Math.round(r.width * 10), r.bridge ? 1 : 0, ...steps(r.line)]),
    areas: areas.map((a) => [a.look, ...steps(a.ring)]),
  }
}
