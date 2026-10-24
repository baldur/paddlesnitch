#!/usr/bin/env node
// Step 2: the real river between a course's two ends, from OpenStreetMap.
//
//   pnpm --filter web course:river <course-id> [--refresh]
//
// Reads scripts/courses/data/<id>/course.json ({ name, river, from, start,
// finish, to, recordings }), fetches OSM around the recordings' tracks (cached under
// .cache/courses/<id>/osm-*.json; --refresh refetches), and writes
//   .cache/courses/<id>/river.json  centreline every 10 m with bank distances,
//                                    and every mapped thing beside it, in game metres
//   .cache/courses/<id>/river.svg   a map of it to eyeball
// See docs/features/game-courses-from-video.md.
import fs from 'fs'
import path from 'path'
import { banks, chainCentreline, crossings, cumulative, locate, projection, recentre, resample, type LatLng, type XZ } from './lib/river'

const id = process.argv[2]
const refresh = process.argv.includes('--refresh')
if (!id) throw new Error('usage: course:river <course-id>')
const DATA = path.join(process.cwd(), 'scripts/courses/data', id)
const OUT = path.join(process.cwd(), '.cache/courses', id)
fs.mkdirSync(OUT, { recursive: true })
const config = JSON.parse(fs.readFileSync(path.join(DATA, 'course.json'), 'utf8')) as {
  name: string; river: string; recordings: string[]
  from: LatLng; to: LatLng          // where the river line starts and ends
  start: LatLng; finish: LatLng     // the race's start and finish lines, on the way
}

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
type El = { type: string; id: number; tags?: Record<string, string>; lat?: number; lon?: number; geometry?: Array<{ lat: number; lon: number } | null>; members?: Array<{ role: string; geometry?: Array<{ lat: number; lon: number }> }> }
async function overpass(name: string, query: string): Promise<El[]> {
  const file = path.join(OUT, `osm-${name}.json`)
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
const line = recentre(mapped, banks(mapped, shore))
const cum = cumulative(line)
const edges = banks(line, shore)
const length = cum.at(-1)!

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
for (const t of named) console.log(`  ${(t.s / 1000).toFixed(2)} km  ${t.kind}${t.name ? ` ${t.name}` : ''}${t.lateral ? ` (${t.lateral > 0 ? 'right' : 'left'}, ${Math.abs(t.lateral).toFixed(0)} m)` : ''}`)
console.log(`  + ${things.length - named.length} buildings, trees, paths and land use`)
}

main().catch((e) => { console.error(e); process.exit(1) })
