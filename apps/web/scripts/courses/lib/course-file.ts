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
  count?: number; points?: LatLng[] // anglers along a stretch; posts in the water; a path's line
  length?: number; paint?: string; crew?: string // one boat seen moored: its length (m), paintwork and who's on deck
} & (Place | { from: Place; to: Place })

export type Cover = 'park' | 'trees' | 'gardens' | 'wild'
export type CourseFile = {
  name: string; title?: string; blurb?: string; credit: string; licence: string
  speedup: number; warp: number; start: number; finish: number
  line: XZ[]; width: number[]
  banks: Array<{ side: -1 | 1; from: number; to: number; cover: Cover }>
  walls: Array<{ side: -1 | 1; from: number; to: number; style?: string }>
  /** `ends`: the road over it, where the map has one (a bridge can cross at a slant). */
  bridges: Array<{ s: number; name?: string; style: string; mast?: -1 | 1; ends?: [XZ, XZ] }>
  moorings: Array<{ s: number; length: number; side: -1 | 1; kind: 'cruiser' | 'narrowboat' | 'trip-boat' | 'tatty'; paint?: string; crew?: string }>
  buildings: Array<{ shape: XZ[]; height: number; kind: 'house' | 'flats' | 'boathouse' | 'other'; style?: string }>
  woods: XZ[][]
  trees: XZ[]
  railways: XZ[][]
  locks: Array<{ gates: XZ[][]; chamber?: XZ[] }>
  weirs: XZ[][]
  places: Array<{ s: number; name: string }>
  birds: Array<{ s: number; count: number; spread: number }>
  /** Posts standing in the water (solid). */
  posts?: XZ[]
  /** Footpaths along the bank (a portage's run): trees keep off them. */
  paths?: XZ[][]
  /** Things seen in the footage at a point on the bank, each drawn by its own model (world.js FEATURES). */
  features?: Array<{ style: string; at: XZ }>
  /** People fishing from the bank, a line out into the water each. */
  anglers?: Array<{ s: number; side: -1 | 1 }>
  /** The water's outlines (rings of the river's areas and its islands), to shape the land. */
  water: XZ[][]
  /** A racing line that isn't `line` (a loop, round islands): every 5 m, with the open water each side. */
  route?: { line: XZ[]; left: number[]; right: number[]; start: number; finish: number }
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

/**
 * Open water each side of a line: like `widths`, but per side, for a racing
 * line that keeps to one side of a channel. Gaps are filled from neighbours.
 */
export function sides(edges: Array<{ left: number | null; right: number | null }>, [min, max] = [3, 60], window = 1) {
  const side = (k: 'left' | 'right') => {
    const raw = edges.map((e) => e[k] ?? NaN)
    return raw.map((_, i) => {
      let near: number[] = []
      for (let w = window; !near.length && w < raw.length; w *= 2) near = raw.slice(Math.max(0, i - w), i + w + 1).filter(Number.isFinite).sort((a, b) => a - b)
      return r1(Math.max(min, Math.min(max, near.length ? near[Math.floor(near.length / 2)] : 20)))
    })
  }
  return { left: side('left'), right: side('right') }
}

/**
 * Landmarks along a racing line that may pass the same place more than once:
 * named once each time the line goes by (a stretch of line within `maxM` of
 * it), as you come up to it; passes less than `apart` metres of line apart
 * count as one. One at the very start is named at the start.
 */
export function routePlaces(shapes: Array<{ name: string; shape: XZ[] }>, list: Landmark[], line: XZ[], [start, finish]: [number, number], maxM = 120, apart = 250): CourseFile['places'] {
  const cum = cumulative(line)
  const out: CourseFile['places'] = []
  const headingAt = (i: number) => {
    const [a, b] = [line[Math.max(0, i - 1)], line[Math.min(line.length - 1, i + 1)]]
    return (Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180) / Math.PI
  }
  for (const p of list) {
    const { name, label, heading } = typeof p === 'string' ? { name: p, label: p, heading: undefined } : p
    const points = shapes.filter((t) => t.name === name).flatMap((t) => t.shape)
    if (!points.length) continue
    const d = line.map((q) => Math.min(...points.map((r) => Math.hypot(q[0] - r[0], q[1] - r[1]))))
    const passes: Array<{ from: number; to: number; at: number }> = []
    for (let i = 0; i < line.length; i++) {
      if (d[i] > maxM) continue
      const last = passes.at(-1)
      if (last && cum[i] - cum[last.to] < apart) {
        last.to = i
        if (d[i] < d[last.at]) last.at = i
      } else passes.push({ from: i, to: i, at: i })
    }
    for (const pass of passes) {
      // Named as you come up to it: the first point of the pass about as near as it gets.
      let i = pass.from
      while (d[i] > d[pass.at] + 25) i++
      const s = cum[i]
      if (s > finish || cum[pass.to] < start) continue
      if (heading !== undefined && Math.abs(((headingAt(pass.at) - heading + 540) % 360) - 180) > 90) continue
      out.push({ s: r1(Math.max(s, start + 5)), name: label })
    }
  }
  return out.sort((a, b) => a.s - b.s)
}

/** Bridges: every deck crossing of the line, one per bridge (roads, paths and decks of the same bridge cluster). */
export function bridges(things: RiverThing[], styles: Map<string, { style: string; mast?: -1 | 1 }>): CourseFile['bridges'] {
  const crossings = things.filter((t) => t.kind === 'bridge').sort((a, b) => a.s - b.s)
  const out: CourseFile['bridges'] = []
  const longest = new Map<CourseFile['bridges'][number], number>()
  for (const c of crossings) {
    let last = out.at(-1)
    if (last && c.s - last.s < 40) {
      // Prefer the bridge's own name ("Caversham Bridge") over a road on it.
      if (c.tags.man_made === 'bridge' && c.name) last.name = c.name
    } else {
      last = { s: r1(c.s), name: c.name, style: 'arch' }
      out.push(last)
    }
    // The way across: the longest road or path over it, end to end.
    if (c.tags.highway && c.shape && c.shape.length > 1) {
      const [a, b] = [c.shape[0], c.shape.at(-1)!]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (len > (longest.get(last) ?? 0)) {
        longest.set(last, len)
        last.ends = [pts([a])[0], pts([b])[0]]
      }
    }
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

const BOATS = { cruiser: [8, 12], narrowboat: [17, 21], 'trip-boat': [24, 26], tatty: [7, 11] } as const

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

// heading (degrees): only where the line passes it going that way (within 90 degrees).
export type Landmark = string | { name: string; label: string; heading?: number }
/** Where swans and ducks crowd: `count` of them within `spread` metres of the river beside `near` (an OSM name). */
export type Flock = { near: string; count: number; spread: number }

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
  birds?: Flock[]
  /** OSM building names to draw with a bespoke model in the game, by style. */
  styles?: Record<string, string>
  water?: XZ[][]
  route?: { line: XZ[]; edges: Array<{ left: number | null; right: number | null }>; start: number; finish: number }
  place: (at: LatLng, heading: number) => { s: number; same: boolean }
  /** Map coordinates to the file's metres: for things placed by a point (landmarks, posts). */
  toXZ?: (at: LatLng) => XZ
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
  const styled: Array<{ from: number; to: number; side: -1 | 1; style: string }> = [] // houses along a stretch, in a style
  const features: NonNullable<CourseFile['features']> = []
  const marked: Array<{ at: XZ; style: string }> = [] // an unnamed building given a bespoke model
  const posts: XZ[] = []
  const paths: XZ[][] = []
  const anglers: NonNullable<CourseFile['anglers']> = []
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
    else if (o.kind === 'wall') walls.push({ side: sp.side, from: r1(sp.from), to: r1(sp.to), ...(o.style ? { style: o.style } : {}) })
    else if (o.kind === 'moorings' && o.length) {
      // One boat, as seen: its length, and its paint and crew if they stood out.
      const kind = (o.boats && o.boats in BOATS ? o.boats : 'cruiser') as keyof typeof BOATS
      moorings.push({ s: r1(sp.from), length: o.length, side: sp.side, kind, ...(o.paint ? { paint: o.paint } : {}), ...(o.crew ? { crew: o.crew } : {}) })
    } else if (o.kind === 'moorings') moorings.push(...mooringRow(sp.from, sp.to, sp.side, String(o.boats ?? 'cruiser'), rand))
    else if (o.kind === 'buildings' && o.style === 'flats') flats.push(sp)
    else if (o.kind === 'buildings' && o.style) styled.push({ ...sp, style: o.style })
    else if (o.kind === 'feature' && 'at' in o && o.style && input.toXZ) features.push({ style: o.style, at: pts([input.toXZ(o.at)])[0] })
    else if (o.kind === 'landmark' && 'at' in o && o.style && input.toXZ) marked.push({ at: input.toXZ(o.at), style: o.style })
    else if (o.kind === 'posts' && input.toXZ) posts.push(...(o.points ?? []).map((p) => pts([input.toXZ!(p)])[0]))
    else if (o.kind === 'path' && input.toXZ) paths.push(pts((o.points ?? []).map((p) => input.toXZ!(p))))
    else if (o.kind === 'anglers') {
      // Evenly along the stretch, each nudged a little.
      const n = o.count ?? 1
      for (let k = 0; k < n; k++) anglers.push({ s: r1(sp.from + ((k + 0.3 + rand() * 0.4) / n) * (sp.to - sp.from)), side: sp.side })
    }
  }

  // A point beside a building marks the nearest one (its footprint's middle within 40 m).
  const middle = (shape: XZ[]): XZ => [shape.reduce((a, p) => a + p[0], 0) / shape.length, shape.reduce((a, p) => a + p[1], 0) / shape.length]
  const kept = input.things.filter((t) => (t.kind === 'building' || t.kind === 'boathouse') && t.shape && t.shape.length >= 4 && Math.abs(t.lateral) < 200)
  const styleAt = new Map<RiverThing, string>()
  for (const m of marked) {
    const d = (t: RiverThing) => { const c = middle(t.shape!); return Math.hypot(c[0] - m.at[0], c[1] - m.at[1]) }
    const best = kept.reduce<RiverThing | null>((a, t) => (d(t) < 40 && (!a || d(t) < d(a)) ? t : a), null)
    if (best) styleAt.set(best, m.style)
  }
  const buildings = kept
    .map((t) => {
      let kind = kindOfBuilding(t.tags)
      if (kind !== 'boathouse' && flats.some((f) => t.s >= f.from - 30 && t.s <= f.to + 30 && Math.sign(t.lateral) === f.side)) kind = 'flats'
      const levels = Number(t.tags['building:levels'])
      const height = Number.isFinite(levels) && levels > 0 ? levels * 3 + 1 : HEIGHTS[kind]
      const style = (t.name ? input.styles?.[t.name] : undefined) ?? styleAt.get(t)
        ?? styled.find((f) => t.s >= f.from && t.s <= f.to && Math.sign(t.lateral) === f.side)?.style
      return { shape: pts(thin(t.shape!, 12)), height, kind, ...(style ? { style } : {}) }
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
    ...(input.route ? routeExtras(input, input.route) : {
      places: places(input.things, input.places ?? [], [input.start, input.finish]),
      birds: (input.birds ?? []).flatMap((b) => places(input.things, [b.near], [input.start, input.finish]).map((p) => ({ s: p.s, count: b.count, spread: b.spread }))),
    }),
    water: (input.water ?? []).map(pts),
    ...(posts.length ? { posts } : {}),
    ...(features.length ? { features } : {}),
    ...(paths.length ? { paths } : {}),
    ...(anglers.length ? { anglers: anglers.sort((a, b) => a.s - b.s) } : {}),
  }
}

// A route's line, sides, and the places and flocks along it (by distance along the route).
function routeExtras(input: Parameters<typeof courseFile>[0], route: NonNullable<Parameters<typeof courseFile>[0]['route']>) {
  const shapes = input.things.filter((t) => t.name && t.shape).map((t) => ({ name: t.name!, shape: t.shape! }))
  const ends: [number, number] = [route.start, route.finish]
  return {
    route: { line: pts(route.line), ...sides(route.edges), start: r1(route.start), finish: r1(route.finish) },
    places: routePlaces(shapes, input.places ?? [], route.line, ends),
    // A flock given by a point (no `near`) is placed by course:route.
    birds: (input.birds ?? []).filter((b) => b.near).flatMap((b) => routePlaces(shapes, [b.near], route.line, ends).slice(0, 1).map((p) => ({ s: p.s, count: b.count, spread: b.spread }))),
  }
}

