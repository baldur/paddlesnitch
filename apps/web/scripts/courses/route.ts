#!/usr/bin/env node
// Rebuilds a course file's racing line (a `route`: a loop, round islands) from
// scripts/courses/data/<id>/course.json, without the map downloads or the
// footage: from the river line and mapped water already in the course file.
// For changing which way a course goes round an island, or where it turns.
//
//   pnpm --filter web course:route <course-id>
//
// Writes games/reading-thames/courses/<id>.json's route (rounded to turns a K1 can
// make, kept on the water), and what's placed along it: the places named on
// screen, where swans crowd, the gates you must go through, the cues as you
// come up to a turn, and turning buoys. Names (Reading Rowing Club, Piper's
// Island) are found where the file's previous route named them, so a name
// keeps its place. See docs/features/game-courses-from-video.md.
import fs from 'fs'
import path from 'path'
import { banks, cumulative, projection, resample, type LatLng, type XZ } from './lib/river'
import { routePlaces, sides, type Landmark } from './lib/course-file'
import { along, joinRuns, offLand, routePoints, smoothTurns, tightest, type Leg, type Portage } from './lib/route'
import { waterMap } from '../../../../games/reading-thames/water.js'

const id = process.argv[2]
if (!id) throw new Error('usage: course:route <course-id>')
const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts/courses/data', id, 'course.json'), 'utf8')) as {
  from: LatLng; start: LatLng; finish: LatLng; route: Array<Leg | Portage>
  // Another course file whose river and scenery this course uses (all the
  // Reading courses are on the one river): the route is drawn on it.
  world?: string; name?: string; title?: string; blurb?: string
  places?: Array<Landmark | { label: string; at: LatLng; heading?: number }>
  birds?: Array<{ near?: string; at?: LatLng; count: number; spread: number }>
  gates?: Array<{ at: LatLng; heading: number; label: string }>
  cues?: Array<{ at: LatLng; heading: number; turn: 'left' | 'right' | 'either'; text: string }>
  marks?: Array<{ at: LatLng }>
}
const courses = path.resolve(process.cwd(), '../../games/reading-thames/courses')
const file = path.join(courses, `${id}.json`)
const course = JSON.parse(fs.readFileSync(config.world ? path.join(courses, `${config.world}.json`) : file, 'utf8'))
if (config.world) for (const k of ['name', 'title', 'blurb'] as const) if (config[k]) course[k] = config[k]
// Courses on the same world draw the same river (main.js builds it once).
if (config.world) course.world = config.world
const { toXZ } = projection(config.from)
const r1 = (v: number) => Math.round(v * 10) / 10

// The water: whether a point's on it and how far from a bank, and the shore as
// segments (less where two mapped areas meet mid-river: that's no bank).
const water = waterMap(course.water) as { inside(x: number, z: number): boolean; shore(x: number, z: number): number; nearest(x: number, z: number, r?: number): { x: number; z: number; d: number } | null }
const segs: Array<[XZ, XZ]> = []
for (const ring of course.water as XZ[][]) for (let i = 0; i < ring.length - 1; i++) segs.push([ring[i], ring[i + 1]])
const key = ([a, b]: [XZ, XZ]) => [a, b].map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).sort().join(' ')
const count = new Map<string, number>()
for (const s of segs) count.set(key(s), (count.get(key(s)) ?? 0) + 1)
const shore = segs.filter((s) => count.get(key(s)) === 1)

// The line: its legs, moved off any land (a straight leg may clip an island's
// end), then its corners rounded off, keeping 3 m off any bank. A portage
// splits it: each stretch of water is done on its own, then the runs over land
// join them as they are.
const pieces: Leg[][] = [[]]
const runs: XZ[][] = []
for (const leg of config.route) {
  if (typeof leg === 'object' && !Array.isArray(leg) && 'portage' in leg) {
    runs.push(leg.portage.map(toXZ))
    pieces.push([])
  } else pieces.at(-1)!.push(leg as Leg)
}
const raws = pieces.map((legs) => routePoints(legs, course.line as XZ[], toXZ))
const wet = raws.map((raw) => smoothTurns(offLand(raw, water, 3), ([x, z]) => water.inside(x, z) && water.shore(x, z) >= 3, 12, 5))
const { line, portages } = joinRuns(wet, runs, 5)
const raw = raws.flat()
const cum = cumulative(line)
const edges = banks(line, shore, 120)
// Over land there's no water either side: just room for the boat.
const onLand = (s: number) => portages.some((p) => s > p.from && s < p.to)
// The start on the first pass by its point, the finish on the last (a course
// can pass the club on the way out, on the way down and home).
const passBy = (p: LatLng, last: boolean) => {
  const at = toXZ(p)
  const d = line.map((q) => Math.hypot(q[0] - at[0], q[1] - at[1]))
  const near = Math.min(...d) + 40
  const ids = d.map((v, i) => [v, i] as const).filter(([v]) => v <= near).map(([, i]) => i)
  // The pass: the run of nearby points at the chosen end; its nearest point.
  const run: number[] = []
  for (const i of last ? [...ids].reverse() : ids) {
    if (run.length && Math.abs(i - run.at(-1)!) > 2) break
    run.push(i)
  }
  return r1(cum[run.reduce((a, b) => (d[b] < d[a] ? b : a))])
}
const start = passBy(config.start, false)
const finish = passBy(config.finish, true)

// Names where the previous route named them (each name's points, once per pass).
const old = (course.route?.line ?? course.line) as XZ[]
const oldCum = cumulative(old)
const oldAt = (s: number): XZ => old[Math.max(0, Math.min(old.length - 1, oldCum.findIndex((c) => c >= s)))]
const shapes: Array<{ name: string; shape: XZ[] }> = (course.places as Array<{ s: number; name: string }>).map((p) => ({ name: p.name, shape: [oldAt(p.s)] }))
const named = new Map<string, string>() // the label a name was given
for (const p of config.places ?? []) {
  if (typeof p === 'object' && 'at' in p) shapes.push({ name: p.label, shape: [toXZ(p.at)] })
  else if (typeof p === 'object') named.set(p.name, p.label ?? p.name)
}
const list: Landmark[] = (config.places ?? []).map((p) => {
  if (typeof p === 'string') return p
  if ('at' in p) return { name: p.label, label: p.label, heading: p.heading }
  // A name relabelled in the previous file was named by its label there.
  return { name: p.label ?? p.name, label: p.label ?? p.name, heading: p.heading }
})
const ends: [number, number] = [start, finish]
const places = routePlaces(shapes, list, line, ends)
const birds = (config.birds ?? []).flatMap((b) => {
  if (b.at) {
    const a = along(line, toXZ(b.at))
    return [{ s: r1(a.s), count: b.count, spread: b.spread, lateral: r1(a.lateral) }]
  }
  return routePlaces(shapes, [b.near!], line, ends).slice(0, 1).map((p) => ({ s: p.s, count: b.count, spread: b.spread }))
})
const gates = (config.gates ?? []).map((g) => ({ s: r1(along(line, toXZ(g.at), g.heading).s), label: g.label }))
const cues = (config.cues ?? []).map((c) => ({ s: r1(along(line, toXZ(c.at), c.heading).s), turn: c.turn, text: c.text }))
// A buoy 4 m out from the nearest shore to where it's given.
const marks = (config.marks ?? []).map((m) => {
  const [x, z] = toXZ(m.at)
  const p = water.nearest(x, z, 40)
  if (!p) return { x: r1(x), z: r1(z) }
  let [nx, nz] = [x - p.x, z - p.z]
  const n = Math.hypot(nx, nz) || 1
  ;[nx, nz] = [nx / n, nz / n]
  if (!water.inside(p.x + nx, p.z + nz)) [nx, nz] = [-nx, -nz] // out from the shore is the other way
  return { x: r1(p.x + nx * 4), z: r1(p.z + nz * 4) }
})

const open = sides(edges)
for (const k of ['left', 'right'] as const) open[k] = open[k].map((w, i) => (onLand(cum[i]) ? 1 : w))
course.route = { line: line.map(([x, z]) => [r1(x), r1(z)]), ...open, start, finish, ...(portages.length ? { portages } : {}) }
Object.assign(course, { places, birds, gates, cues, marks })
fs.writeFileSync(file, JSON.stringify(course))
console.log(`${path.relative(process.cwd(), file)}: route ${(cum.at(-1)! / 1000).toFixed(2)} km (${raw.length} points from the legs), start ${start} m, finish ${finish} m${portages.length ? `, portages ${portages.map((p) => `${p.from}-${p.to} m`).join(', ')}` : ''}; tightest turn ${tightest(resample(line, 5)).toFixed(1)} m; ${places.length} places, ${birds.length} flocks, ${gates.length} gates, ${cues.length} cues, ${marks.length} buoys`)
