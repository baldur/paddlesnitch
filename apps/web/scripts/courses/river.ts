#!/usr/bin/env node
// Step 2: the real river between a course's two ends, from OpenStreetMap.
//
//   pnpm --filter web course:river <course-id> [--refresh]
//
// Reads scripts/courses/data/<id>/course.json ({ name, river, from, start,
// finish, to, recordings }), fetches OSM around the recordings' tracks (cached under
// .cache/courses/<id>/osm-*.json, or another course's with `osmFrom`; --refresh
// refetches), and writes
//   .cache/courses/<id>/river.json  centreline every 10 m with bank distances,
//                                    every mapped thing beside it, the water's
//                                    outlines, and (with `route`) the racing line,
//                                    all in game metres
//   .cache/courses/<id>/river.svg   a map of it to eyeball
// See docs/features/game-courses-from-video.md.
import fs from 'fs'
import path from 'path'
import { banks, chainCentreline, crossings, cumulative, locate, projection, recentre, resample, thinLine, type LatLng, type XZ } from './lib/river'

const id = process.argv[2]
const refresh = process.argv.includes('--refresh')
if (!id) throw new Error('usage: course:river <course-id>')
const DATA = path.join(process.cwd(), 'scripts/courses/data', id)
const OUT = path.join(process.cwd(), '.cache/courses', id)
fs.mkdirSync(OUT, { recursive: true })
// A leg of a route: along the river line between two points, along a mapped
// waterway (by OSM way id), or straight to a point.
type Leg = { along: [LatLng, LatLng] } | { way: number; reverse?: boolean } | LatLng
const config = JSON.parse(fs.readFileSync(path.join(DATA, 'course.json'), 'utf8')) as {
  name: string; river: string; recordings: string[]
  from: LatLng; to: LatLng          // where the river line starts and ends
  start: LatLng; finish: LatLng     // the race's start and finish lines, on the way
  osmFrom?: string                  // reuse another course's OSM downloads (same water)
  route?: Leg[]                     // a racing line that isn't the river line: a loop, round islands
}
const OSM = path.join(process.cwd(), '.cache/courses', config.osmFrom ?? id)

type Fix = { lat: number; lng: number }
const fixes: Fix[] = config.recordings.flatMap((r) =>
  (JSON.parse(fs.readFileSync(path.join(process.cwd(), '.cache/courses', r, 'track.json'), 'utf8')).track as Fix[]))
const pad = 0.004
const bbox = [
  Math.min(...fixes.map((f) => f.lat)) - pad, Math.min(...fixes.map((f) => f.lng)) - pad,
  Math.max(...fixes.map((f) => f.lat)) + pad, Math.max(...fixes.map((f) => f.lng)) + pad,
].map((v) => v.toFixed(4)).join(',')

// Overpass mirrors refuse often (406/502/504); try each a few times.
const MIRRORS = ['https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']
type El = { type: string; id: number; tags?: Record<string, string>; lat?: number; lon?: number; geometry?: Array<{ lat: number; lon: number } | null>; members?: Array<{ role: string; ref?: number; geometry?: Array<{ lat: number; lon: number }> }> }
async function overpass(name: string, query: string): Promise<El[]> {
  const file = path.join(OSM, `osm-${name}.json`)
  if (!refresh && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')).elements
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of MIRRORS) {
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }), headers: { 'User-Agent': 'Mozilla/5.0 paddlesnitch' } }).catch(() => null)
      const body = res?.ok ? await res.text() : ''
      if (body.startsWith('{')) {
        fs.writeFileSync(file, body)
        return JSON.parse(body).elements
      }
    }
  }
  throw new Error(`Overpass refused the ${name} query on every mirror; try again later`)
}

async function main() {
const water = await overpass('water', `[out:json][timeout:90];(
  way["waterway"](${bbox}); way["natural"="water"](${bbox}); relation["natural"="water"](${bbox});
  way["place"~"island|islet"](${bbox}); way["bridge"](${bbox}); way["man_made"="bridge"](${bbox});
  node["waterway"](${bbox}); way["lock"="yes"](${bbox}); way["building"="boathouse"](${bbox});
  way["leisure"="slipway"](${bbox}); node["leisure"="slipway"](${bbox}); way["mooring"](${bbox});
);out geom;`)
const land = await overpass('banks', `[out:json][timeout:120];way["waterway"~"river|canal"]["name"="${config.river}"](${bbox})->.r;(
  way["building"](around.r:150); way["railway"="rail"](around.r:250); way["landuse"](around.r:250);
  way["natural"~"wood|scrub|grassland|tree_row|wetland"](around.r:250); way["leisure"~"park|nature_reserve|marina|pitch|garden"](around.r:200);
  way["highway"~"footway|path|track|bridleway"](around.r:60); node["natural"="tree"](around.r:80);
);out geom;`)

const { toXZ } = projection(config.from)
const ll = (g: { lat: number; lon: number }): XZ => toXZ([g.lat, g.lon])
const geom = (e: El): XZ[] => (e.geometry ?? []).filter((g): g is { lat: number; lon: number } => !!g).map(ll)

// The centreline, guided by where the paddler actually went.
const riverWays = water.filter((e) => e.type === 'way' && e.tags?.name === config.river && /river|canal/.test(e.tags.waterway ?? '')).map(geom)
const guide = fixes.filter((_, i) => i % 50 === 0).map((f) => toXZ([f.lat, f.lng]))
const mapped = resample(chainCentreline(riverWays, toXZ(config.from), toXZ(config.to), guide), 10)

// Shoreline: every edge of mapped water (rings of river areas and their islands).
const shore: Array<[XZ, XZ]> = []
const addRing = (ring: XZ[]) => { for (let i = 0; i < ring.length - 1; i++) shore.push([ring[i], ring[i + 1]]) }
for (const e of water) {
  if (e.tags?.natural !== 'water' && !e.tags?.place) continue
  if (e.type === 'way') addRing(geom(e))
  for (const m of e.members ?? []) addRing((m.geometry ?? []).map(ll))
}
// Where two mapped water areas meet mid-river, their shared edge isn't a bank.
{
  const key = ([a, b]: [XZ, XZ]) => [a, b].map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).sort().join(' ')
  const count = new Map<string, number>()
  for (const seg of shore) count.set(key(seg), (count.get(key(seg)) ?? 0) + 1)
  const islands = new Set(water.filter((e) => e.tags?.place).flatMap((e) => (e.type === 'way' ? [e.id] : [])))
  // (An island that's both a way and a hole in the river is counted twice too: keep it.)
  const islandEdges = new Set<string>()
  for (const e of water) {
    if (e.type !== 'way' || !islands.has(e.id)) continue
    const g = geom(e)
    for (let i = 0; i < g.length - 1; i++) islandEdges.add(key([g[i], g[i + 1]]))
  }
  for (let i = shore.length - 1; i >= 0; i--) if (count.get(key(shore[i]))! > 1 && !islandEdges.has(key(shore[i]))) shore.splice(i, 1)
}
const line = recentre(mapped, banks(mapped, shore))
const cum = cumulative(line)
const edges = banks(line, shore)
const length = cum.at(-1)!

// The water's outlines, for the game to shape the land: each mapped way once
// (an island can be both a hole in the river and a way of its own). An area's
// outline is kept whole, or the game's in-the-water test (counting crossings)
// would go wrong; an area or island on its own only if it's near the line.
const outlines: XZ[][] = []
const members = new Set<number>()
for (const e of water) for (const m of e.members ?? []) if (m.ref) members.add(m.ref)
const nearLine = (p: XZ) => locate(line, cum, p).d < 600
for (const e of water) {
  const rings = e.type === 'relation' ? (e.members ?? []).map((m) => (m.geometry ?? []).map(ll))
    : (e.tags?.natural === 'water' || e.tags?.place) && !members.has(e.id) ? [geom(e)] : []
  if (!rings.flat().some(nearLine)) continue
  for (const ring of rings) outlines.push(thinLine(ring, 1.5))
}

// The racing line, when it isn't the river line: its legs joined up, every 5 m,
// with the open water either side of it.
let route: { samples: Array<{ s: number; x: number; z: number; left: number | null; right: number | null }>; start: number; finish: number } | null = null
if (config.route) {
  const pts: XZ[] = []
  for (const leg of config.route) {
    if (Array.isArray(leg)) pts.push(toXZ(leg))
    else if ('along' in leg) {
      const [a, b] = leg.along.map((p) => locate(line, cum, toXZ(p)).s)
      const ids = cum.map((s, i) => [s, i] as const).filter(([s]) => s >= Math.min(a, b) && s <= Math.max(a, b)).map(([, i]) => i)
      pts.push(...(a < b ? ids : ids.reverse()).map((i) => line[i]))
    } else {
      const way = water.find((e) => e.type === 'way' && e.id === leg.way)
      if (!way) throw new Error(`route: no OSM way ${leg.way} in the downloaded water`)
      const g = geom(way)
      pts.push(...(leg.reverse ? g.reverse() : g))
    }
  }
  const r = resample(pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1), 5)
  const rc = cumulative(r)
  const re = banks(r, shore, 120)
  const third = rc.at(-1)! / 3
  const nearest = (p: LatLng, from: number, to: number) => {
    const at = toXZ(p)
    let best = from
    for (let i = from; i <= to; i++) if (Math.hypot(r[i][0] - at[0], r[i][1] - at[1]) < Math.hypot(r[best][0] - at[0], r[best][1] - at[1])) best = i
    return +rc[best].toFixed(1)
  }
  route = {
    samples: r.map((p, i) => ({ s: +rc[i].toFixed(1), x: +p[0].toFixed(2), z: +p[1].toFixed(2), left: re[i].left && +re[i].left!.toFixed(1), right: re[i].right && +re[i].right!.toFixed(1) })),
    start: nearest(config.start, 0, Math.round(third / 5)),
    finish: nearest(config.finish, Math.round((2 * third) / 5), r.length - 1),
  }
}

// Everything beside the river, placed by distance along and offset from the line.
type Thing = { kind: string; name?: string; s: number; lateral: number; tags: Record<string, string>; shape?: XZ[] }
const things: Thing[] = []
const near = (shape: XZ[], maxM: number) => {
  const hits = shape.map((p) => locate(line, cum, p)).filter((h) => h.d <= maxM)
  return hits.length ? hits.reduce((a, b) => (a.d < b.d ? a : b)) : null
}
const kindOf = (t: Record<string, string>) =>
  t.waterway === 'lock_gate' || t.lock === 'yes' ? 'lock'
    : t.waterway === 'weir' ? 'weir'
    : t.place === 'island' || t.place === 'islet' ? 'island'
    : t.building === 'boathouse' ? 'boathouse'
    : t.leisure === 'slipway' ? 'slipway'
    : t.bridge || t.man_made === 'bridge' ? 'bridge'
    : t.building ? 'building'
    : t.railway === 'rail' ? 'railway'
    : t.natural === 'tree' ? 'tree'
    : t.highway ? 'path'
    : t.landuse ? `landuse:${t.landuse}`
    : t.natural ? `natural:${t.natural}`
    : t.leisure ? `leisure:${t.leisure}`
    : null
const seen = new Set<string>()
for (const e of [...water, ...land]) {
  const tags = e.tags ?? {}
  const kind = kindOf(tags)
  if (!kind || seen.has(`${e.type}${e.id}`)) continue
  seen.add(`${e.type}${e.id}`)
  const shape = e.lat !== undefined ? [ll({ lat: e.lat, lon: e.lon! })] : geom(e)
  if (!shape.length) continue
  if (kind === 'bridge') {
    // A bridge counts where its deck crosses the river line.
    for (const s of crossings(line, cum, shape)) things.push({ kind, name: tags.name, s, lateral: 0, tags, shape })
    continue
  }
  const h = near(shape, kind === 'tree' ? 80 : 250)
  if (h) things.push({ kind, name: tags.name, s: h.s, lateral: h.lateral, tags, shape })
}
things.sort((a, b) => a.s - b.s)

fs.writeFileSync(path.join(OUT, 'river.json'), JSON.stringify({
  id, name: config.name, origin: config.from, length,
  start: +locate(line, cum, toXZ(config.start)).s.toFixed(1),
  finish: +locate(line, cum, toXZ(config.finish)).s.toFixed(1),
  samples: line.map((p, i) => ({ s: +cum[i].toFixed(1), x: +p[0].toFixed(2), z: +p[1].toFixed(2), left: edges[i].left && +edges[i].left!.toFixed(1), right: edges[i].right && +edges[i].right!.toFixed(1) })),
  things,
  water: outlines.map((ring) => ring.map((p) => [+p[0].toFixed(1), +p[1].toFixed(1)])),
  ...(route ? { route } : {}),
}))

// A map to eyeball: water edges, the line, landmarks, buildings.
const xs = line.map((p) => p[0])
const zs = line.map((p) => p[1])
const [minX, maxX, minZ, maxZ] = [Math.min(...xs) - 300, Math.max(...xs) + 300, Math.min(...zs) - 300, Math.max(...zs) + 300]
const pts = (ps: XZ[]) => ps.map((p) => `${(p[0] - minX).toFixed(1)},${(p[1] - minZ).toFixed(1)}`).join(' ')
const svg = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${(maxX - minX).toFixed(0)} ${(maxZ - minZ).toFixed(0)}" width="2400"><rect width="100%" height="100%" fill="#f4f1e8"/>`]
for (const t of things) {
  if (!t.shape || t.shape.length < 2) continue
  const color = t.kind === 'building' ? '#b9a48c' : t.kind === 'railway' ? '#555' : t.kind.includes('wood') || t.kind.includes('forest') ? '#9fc28f' : null
  if (color) svg.push(`<polyline points="${pts(t.shape)}" fill="${t.kind === 'railway' ? 'none' : color}" stroke="${color}" stroke-width="${t.kind === 'railway' ? 4 : 1}"/>`)
}
for (const [a, b] of shore) svg.push(`<line x1="${a[0] - minX}" y1="${a[1] - minZ}" x2="${b[0] - minX}" y2="${b[1] - minZ}" stroke="#3a7bd5" stroke-width="2"/>`)
svg.push(`<polyline points="${pts(line)}" fill="none" stroke="#d33" stroke-width="3"/>`)
for (let s = 0; s <= length; s += 500) {
  const i = Math.round(s / 10)
  svg.push(`<text x="${line[i][0] - minX + 8}" y="${line[i][1] - minZ}" font-size="28" fill="#d33">${s / 1000} km</text>`)
}
for (const t of things.filter((t) => ['bridge', 'lock', 'weir', 'island', 'boathouse', 'slipway'].includes(t.kind))) {
  const i = Math.round(t.s / 10)
  svg.push(`<circle cx="${line[i][0] - minX}" cy="${line[i][1] - minZ}" r="7" fill="#000"/><text x="${line[i][0] - minX - 10}" y="${line[i][1] - minZ - 12}" font-size="22" text-anchor="end">${t.kind}${t.name ? `: ${t.name}` : ''}</text>`)
}
svg.push('</svg>')
fs.writeFileSync(path.join(OUT, 'river.svg'), svg.join('\n'))

const named = things.filter((t) => ['bridge', 'lock', 'weir', 'island', 'boathouse', 'slipway'].includes(t.kind))
console.log(`${config.name}: ${(length / 1000).toFixed(2)} km of river, width ${Math.min(...edges.filter((e) => e.left && e.right).map((e) => e.left! + e.right!)).toFixed(0)}–${Math.max(...edges.filter((e) => e.left && e.right).map((e) => e.left! + e.right!)).toFixed(0)} m, ${edges.filter((e) => !e.left || !e.right).length} samples without a bank`)
if (route) console.log(`  route: ${(route.samples.at(-1)!.s / 1000).toFixed(2)} km, start ${route.start} m, finish ${route.finish} m, ${route.samples.filter((p) => !p.left || !p.right).length} samples without a bank`)
for (const t of named) console.log(`  ${(t.s / 1000).toFixed(2)} km  ${t.kind}${t.name ? ` ${t.name}` : ''}${t.lateral ? ` (${t.lateral > 0 ? 'right' : 'left'}, ${Math.abs(t.lateral).toFixed(0)} m)` : ''}`)
console.log(`  + ${things.length - named.length} buildings, trees, paths and land use`)
}

main().catch((e) => { console.error(e); process.exit(1) })
