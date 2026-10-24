// The game's course file, made from a real river: pure, so it's tested on its
// own (course-file.test.ts). The format is read by games/kayak/course.js
// (loadCourse) and drawn by games/kayak/world.js.
import { cumulative, type LatLng, type XZ } from './river'

export type RiverThing = { kind: string; name?: string; s: number; lateral: number; tags: Record<string, string>; shape?: XZ[] }
type Place = { at: LatLng; heading: number; frame?: string }
// One thing seen in the frames, at a place or along a stretch (observations.json).
export type Observation = {
  kind: string; side?: 'left' | 'right'; note?: string
  name?: string; style?: string; mast?: 'left' | 'right'; cover?: string; boats?: string
} & (Place | { from: Place; to: Place })

export type Cover = 'park' | 'trees' | 'gardens' | 'wild'
export type CourseFile = {
  name: string; title?: string; blurb?: string; credit: string; licence: string
  speedup: number; warp: number; start: number; finish: number
  line: XZ[]; width: number[]
  banks: Array<{ side: -1 | 1; from: number; to: number; cover: Cover }>
  walls: Array<{ side: -1 | 1; from: number; to: number }>
  bridges: Array<{ s: number; name?: string; style: string; mast?: -1 | 1 }>
  moorings: Array<{ s: number; length: number; side: -1 | 1; kind: 'cruiser' | 'narrowboat' | 'trip-boat' }>
  buildings: Array<{ shape: XZ[]; height: number; kind: 'house' | 'flats' | 'boathouse' | 'other' }>
  woods: XZ[][]
  trees: XZ[]
  railways: XZ[][]
  locks: Array<{ gates: XZ[][]; chamber?: XZ[] }>
  weirs: XZ[][]
  places: Array<{ s: number; name: string }>
}

const r1 = (v: number) => Math.round(v * 10) / 10
const pts = (shape: XZ[]): XZ[] => shape.map(([x, z]) => [r1(x), r1(z)])

/** Every `n`th point, keeping the last, so a polygon stays under `max` points. */
function thin(shape: XZ[], max: number): XZ[] {
  if (shape.length <= max) return shape
  const n = Math.ceil(shape.length / max)
  return shape.filter((_, i) => i % n === 0 || i === shape.length - 1)
}

/**
 * Width along the line: the gap between the banks, with spikes taken out (a
 * ray that slipped past an island into a side stream, a slipway notch) by a
 * running median, and clamped to what a paddler would call this river.
 */
export function widths(edges: Array<{ left: number | null; right: number | null }>, [min, max] = [20, 100], window = 3): number[] {
  const raw = edges.map((e) => (e.left ?? NaN) + (e.right ?? NaN))
  return raw.map((_, i) => {
    const near = raw.slice(Math.max(0, i - window), i + window + 1).filter(Number.isFinite).sort((a, b) => a - b)
    const w = near.length ? near[Math.floor(near.length / 2)] : 40
    return r1(Math.max(min, Math.min(max, w)))
  })
}

/** Bridges: every deck crossing of the line, one per bridge (roads, paths and decks of the same bridge cluster). */
export function bridges(things: RiverThing[], styles: Map<string, { style: string; mast?: -1 | 1 }>): CourseFile['bridges'] {
  const crossings = things.filter((t) => t.kind === 'bridge').sort((a, b) => a.s - b.s)
  const out: CourseFile['bridges'] = []
  for (const c of crossings) {
    const last = out.at(-1)
    if (last && c.s - last.s < 40) {
      // Prefer the bridge's own name ("Caversham Bridge") over a road on it.
      if (c.tags.man_made === 'bridge' && c.name) last.name = c.name
      continue
    }
    out.push({ s: r1(c.s), name: c.name, style: 'arch' })
  }
  for (const b of out) Object.assign(b, (b.name && styles.get(b.name)) ?? {})
  return out
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const BOATS = { cruiser: [8, 12], narrowboat: [17, 21], 'trip-boat': [24, 26] } as const

/** A row of moored boats filling a stretch of bank, or one or two at a spot. */
export function mooringRow(from: number, to: number, side: -1 | 1, boats: string, rand: () => number): CourseFile['moorings'] {
  const pick = (): keyof typeof BOATS => boats === 'mixed' ? (rand() < 0.4 ? 'narrowboat' : 'cruiser') : (boats in BOATS ? boats as keyof typeof BOATS : 'cruiser')
  const out: CourseFile['moorings'] = []
  const [a, b] = from <= to ? [from, to] : [to, from]
  const end = b > a ? b : a + (rand() < 0.5 ? 14 : 30)
  for (let s = a - 6; ;) {
    const kind = pick()
    const [lo, hi] = BOATS[kind]
    const length = r1(lo + rand() * (hi - lo))
    if (s + length > end + 6 && out.length) break
    out.push({ s: r1(s + length / 2), length, side, kind })
    s += length + 1 + rand() * (b > a ? 6 : 2)
  }
  return out
}

const HEIGHTS = { house: 7, flats: 12, boathouse: 6, other: 6 }
const kindOfBuilding = (tags: Record<string, string>): CourseFile['buildings'][number]['kind'] =>
  tags.building === 'boathouse' ? 'boathouse'
    : tags.building === 'apartments' ? 'flats'
    : ['house', 'detached', 'semidetached_house', 'terrace', 'residential', 'bungalow', 'yes'].includes(tags.building) ? 'house'
    : 'other'

export type Landmark = string | { name: string; label: string }

/**
 * The landmarks named on screen as you pass, from the course's list of OSM
 * names (optionally relabelled), in course order. Each is where the river comes
 * nearest it, kept inside the race; names not found nearby are left out.
 */
export function places(things: RiverThing[], list: Landmark[], [start, finish]: [number, number], maxM = 250): CourseFile['places'] {
  return list.flatMap((p) => {
    const { name, label } = typeof p === 'string' ? { name: p, label: p } : p
    const hits = things.filter((t) => t.name === name && Math.abs(t.lateral) < maxM)
    if (!hits.length) return []
    const s = Math.min(...hits.map((t) => t.s))
    return [{ s: r1(Math.max(start + 20, Math.min(finish - 30, s))), name: label }]
  }).sort((a, b) => a.s - b.s)
}

export function courseFile(input: {
  name: string; title?: string; blurb?: string; speedup: number; warp: number; start: number; finish: number
  line: XZ[]; edges: Array<{ left: number | null; right: number | null }>; things: RiverThing[]
  observations: Observation[]
  places?: Landmark[]
  place: (at: LatLng, heading: number) => { s: number; same: boolean }
}): CourseFile {
  const rand = mulberry32(7)
  const sideOf = (o: Observation, p: { same: boolean }): -1 | 1 => ((o.side === 'left') === p.same ? -1 : 1)
  const span = (o: Observation) => {
    if ('from' in o) {
      const a = input.place(o.from.at, o.from.heading)
      const b = input.place(o.to.at, o.to.heading)
      return { from: Math.min(a.s, b.s), to: Math.max(a.s, b.s), side: sideOf(o, a) }
    }
    const p = input.place(o.at, o.heading)
    return { from: p.s, to: p.s, side: sideOf(o, p) }
  }

  const banks: CourseFile['banks'] = []
  const walls: CourseFile['walls'] = []
  const moorings: CourseFile['moorings'] = []
  const flats: Array<{ from: number; to: number; side: -1 | 1 }> = []
  const styles = new Map<string, { style: string; mast?: -1 | 1 }>()
  for (const o of input.observations) {
    if (o.kind === 'bridge' && typeof o.name === 'string') {
      // Which bank a cable-stayed bridge's mast stands on, as seen heading `heading`.
      const p = 'at' in o ? input.place(o.at, o.heading) : null
      const mast: -1 | 1 | undefined = p && o.mast ? ((o.mast === 'left') === p.same ? -1 : 1) : undefined
      styles.set(o.name, { style: String(o.style ?? 'arch'), ...(mast ? { mast } : {}) })
      continue
    }
    const sp = span(o)
    if (o.kind === 'bank') banks.push({ side: sp.side, from: r1(sp.from), to: r1(sp.to), cover: o.cover as Cover })
    else if (o.kind === 'wall') walls.push({ side: sp.side, from: r1(sp.from), to: r1(sp.to) })
    else if (o.kind === 'moorings') moorings.push(...mooringRow(sp.from, sp.to, sp.side, String(o.boats ?? 'cruiser'), rand))
    else if (o.kind === 'buildings' && o.style === 'flats') flats.push(sp)
  }

  const buildings = input.things
    .filter((t) => t.kind === 'building' && t.shape && t.shape.length >= 4 && Math.abs(t.lateral) < 200)
    .map((t) => {
      let kind = kindOfBuilding(t.tags)
      if (kind !== 'boathouse' && flats.some((f) => t.s >= f.from - 30 && t.s <= f.to + 30 && Math.sign(t.lateral) === f.side)) kind = 'flats'
      const levels = Number(t.tags['building:levels'])
      const height = Number.isFinite(levels) && levels > 0 ? levels * 3 + 1 : HEIGHTS[kind]
      return { shape: pts(thin(t.shape!, 12)), height, kind }
    })

  const near = (t: RiverThing, m: number) => Math.abs(t.lateral) < m
  return {
    name: input.name, title: input.title, blurb: input.blurb,
    credit: 'Map data © OpenStreetMap contributors',
    // Built from OSM, so this file is itself an ODbL database.
    licence: 'ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/): derived from OpenStreetMap; observations from paddlesnitch footage',
    speedup: input.speedup, warp: input.warp, start: r1(input.start), finish: r1(input.finish),
    line: pts(input.line), width: widths(input.edges),
    banks, walls, moorings: moorings.sort((a, b) => a.s - b.s),
    bridges: bridges(input.things, styles),
    buildings,
    woods: input.things.filter((t) => /wood|forest|scrub/.test(t.kind) && t.shape && t.shape.length > 3 && near(t, 250)).map((t) => pts(thin(t.shape!, 40))),
    trees: input.things.filter((t) => t.kind === 'tree' && t.shape).map((t) => pts(t.shape!)[0])
      .concat(input.things.filter((t) => t.kind === 'natural:tree_row' && t.shape).flatMap((t) => pts(t.shape!))),
    railways: input.things.filter((t) => t.kind === 'railway' && t.shape && !t.tags.bridge && near(t, 250)).map((t) => pts(thin(t.shape!, 60))),
    // Locks and weirs on the way (one past the river's end would be under the ground that closes it off).
    locks: (() => {
      const end = cumulative(input.line).at(-1)! - 1
      const gates = input.things.filter((t) => t.kind === 'lock' && t.tags.waterway === 'lock_gate' && t.shape && t.shape.length > 1 && t.s < end).map((t) => pts(t.shape!))
      const chamber = input.things.find((t) => t.kind === 'lock' && t.tags.natural === 'water' && t.shape)
      return gates.length ? [{ gates, ...(chamber ? { chamber: pts(chamber.shape!) } : {}) }] : []
    })(),
    weirs: input.things.filter((t) => t.kind === 'weir' && t.shape && t.shape.length > 1 && t.s < cumulative(input.line).at(-1)! - 1).map((t) => pts(t.shape!)),
    places: places(input.things, input.places ?? [], [input.start, input.finish]),
  }
}
