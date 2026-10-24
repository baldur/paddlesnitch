#!/usr/bin/env node
// Step 5: the game's course file, from the river (course:river) and what the
// frames showed (scripts/courses/data/<id>/observations.json).
//
//   pnpm --filter web course:build <course-id>
//
// Writes games/kayak/courses/<id>.json, which the game loads when the course is
// picked. Everything is in real metres around the course's first point (x east,
// z south); the game moves boats `speedup` times their speed through it, and shows
// times `warp` times longer, so a real river plays in a few minutes.
// See docs/features/game-courses-from-video.md.
import fs from 'fs'
import path from 'path'
import { cumulative, locate, projection, type LatLng, type XZ } from './lib/river'
import { courseFile, type Flock, type Observation, type Landmark, type RiverThing } from './lib/course-file'

const id = process.argv[2]
if (!id) throw new Error('usage: course:build <course-id>')
const DATA = path.join(process.cwd(), 'scripts/courses/data', id)
type Sample = { s: number; x: number; z: number; left: number | null; right: number | null }
const river = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.cache/courses', id, 'river.json'), 'utf8')) as {
  name: string; origin: LatLng; start: number; finish: number
  samples: Sample[]; things: RiverThing[]; water?: XZ[][]
  route?: { samples: Sample[]; start: number; finish: number }
}
const config = JSON.parse(fs.readFileSync(path.join(DATA, 'course.json'), 'utf8')) as {
  speedup?: number; warp?: number; title?: string; blurb?: string
  // A place named on screen: an OSM name (relabelled or not), or a label at a point.
  places?: Array<Landmark | { label: string; at: LatLng }>
  birds?: Flock[]; styles?: Record<string, string>
  observations?: string // another course's observations, for the same water
}
const { items } = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts/courses/data', config.observations ?? id, 'observations.json'), 'utf8')) as { items: Observation[] }

const line: XZ[] = river.samples.map((p) => [p.x, p.z])
const { toXZ } = projection(river.origin)
// Places given as a point become things of their own, to be found by name.
const pointPlaces = (config.places ?? []).flatMap((p) => (typeof p === 'object' && 'at' in p ? [{ kind: 'place', name: p.label, s: 0, lateral: 0, tags: {}, shape: [toXZ(p.at)] }] : []))
const landmarks = (config.places ?? []).map((p) => (typeof p === 'object' && 'at' in p ? p.label : p))
const out = courseFile({
  name: river.name, title: config.title, blurb: config.blurb,
  speedup: config.speedup ?? 4, warp: config.warp ?? 4,
  start: river.start, finish: river.finish,
  line, edges: river.samples, things: [...river.things, ...pointPlaces], water: river.water,
  ...(river.route ? { route: { line: river.route.samples.map((p): XZ => [p.x, p.z]), edges: river.route.samples, start: river.route.start, finish: river.route.finish } } : {}),
  // Observations are tied to places, not to this course: find each on the line,
  // and flip its side if the camera was heading the other way.
  places: landmarks, birds: config.birds, styles: config.styles,
  observations: items, place: (at: LatLng, heading: number) => {
    const p = toXZ(at)
    const cum = cumulative(line)
    const hit = locate(line, cum, p)
    const i = Math.min(line.length - 2, Math.max(0, Math.round(hit.s / (cum[1] || 10))))
    const t = [line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]]
    const courseHeading = (Math.atan2(t[0], -t[1]) * 180) / Math.PI
    const diff = Math.abs(((heading - courseHeading + 540) % 360) - 180)
    return { s: hit.s, same: diff < 90 }
  },
})

const file = path.resolve(process.cwd(), '../../games/kayak/courses', `${id}.json`)
fs.mkdirSync(path.dirname(file), { recursive: true })
fs.writeFileSync(file, JSON.stringify(out))
console.log(`${path.relative(process.cwd(), file)}: ${(fs.statSync(file).size / 1024).toFixed(0)} KB — ${out.line.length} points, ${out.buildings.length} buildings, ${out.bridges.length} bridges, ${out.moorings.length} moorings, ${out.woods.length} woods, ${out.banks.length} bank stretches, ${out.places.length} places${out.route ? `, a ${(out.route.line.length * 5 / 1000).toFixed(1)} km route` : ''}`)
