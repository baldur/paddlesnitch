// The small waterside buildings OpenStreetMap doesn't have: Ordnance Survey's
// OpenMap Local footprints within 30 m of the water that overlap none of the
// course's buildings, each as tall as the Environment Agency's lidar measures it.
//
//   pnpm --filter web course:sheds
//
// Reads OpenMap Local's SU tile (ESRI shapefiles, unzipped in
// ~/.paddlesnitch/os-openmap-local/SU/) and the lidar tiles in
// ~/.paddlesnitch/lidar/reading-thames/tiles/, and writes
// games/reading-thames/sheds.js (footprints and heights only). Both are Open
// Government Licence: the game's start page credits them.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { mosaic, readTile, sampleGrid, wgs84ToBng, type Grid } from './lib/lidar'
import { projection, type XZ } from './lib/river'
import { area, centre, inside, missingFrom, shapefilePolygons, shedHeight } from './lib/sheds'
import { courseFromFile, locate, widthAt } from '../../../../games/reading-thames/course.js'

const OS = path.join(os.homedir(), '.paddlesnitch/os-openmap-local/SU/OS OpenMap Local (ESRI Shape File) SU/data/SU_Building.shp')
const TILES = path.join(os.homedir(), '.paddlesnitch/lidar/reading-thames/tiles')
const GAME = path.join(process.cwd(), '../../games/reading-thames')
const NEAR = 30 // metres from the water's edge

const data = JSON.parse(fs.readFileSync(path.join(GAME, 'courses/reading.json'), 'utf8'))
const river = courseFromFile(data).scenery.river
const { toLatLng } = projection([51.46175, -0.96945])
const bng = (p: XZ) => wgs84ToBng(...toLatLng(p))
// Game metres from the grid's: four steps of Newton's method from the origin (to millimetres).
const game = ([E, N]: XZ): XZ => {
  let p: XZ = [0, 0]
  for (let k = 0; k < 4; k++) {
    const [a, ax, az] = [bng(p), bng([p[0] + 10, p[1]]), bng([p[0], p[1] + 10])]
    const [j00, j01, j10, j11] = [(ax[0] - a[0]) / 10, (az[0] - a[0]) / 10, (ax[1] - a[1]) / 10, (az[1] - a[1]) / 10]
    const [dE, dN] = [E - a[0], N - a[1]]
    const det = j00 * j11 - j01 * j10
    p = [p[0] + (dE * j11 - j01 * dN) / det, p[1] + (j00 * dN - dE * j10) / det]
  }
  return p
}
const grid = (kind: string): Grid => mosaic(fs.readdirSync(TILES).flatMap((name) => {
  const m = name.match(new RegExp(`^${kind}-(\\d+)-(\\d+)\\.tif$`))
  return m ? [{ west: Number(m[1]), south: Number(m[2]), ...readTile(fs.readFileSync(path.join(TILES, name))) }] : []
}))
const [dtm, dsm, vom] = [grid('dtm'), grid('dsm'), grid('vom')]

// The reach's box in the grid's metres, from the river line's ends with a margin.
const xs = river.samples.map((s: { x: number }) => s.x)
const zs = river.samples.map((s: { z: number }) => s.z)
const corners = [[Math.min(...xs), Math.min(...zs)], [Math.max(...xs), Math.max(...zs)], [Math.min(...xs), Math.max(...zs)], [Math.max(...xs), Math.min(...zs)]].map((p) => bng(p as XZ))
const box: [number, number, number, number] = [Math.min(...corners.map((c) => c[0])) - 400, Math.min(...corners.map((c) => c[1])) - 400, Math.max(...corners.map((c) => c[0])) + 400, Math.max(...corners.map((c) => c[1])) + 400]

const fromEdge = ([x, z]: XZ) => { const at = locate(river, x, z); return Math.abs(at.lateral) - widthAt(river, at.s).half }
const near = shapefilePolygons(fs.readFileSync(OS), box).map((r) => r.map(game)).filter((r) => {
  const c = centre(r)
  const s = locate(river, ...c).s
  return fromEdge(c) < NEAR && s > 0 && s < river.length - 1
})
const sheds = missingFrom(near, data.buildings.map((b: { shape: XZ[] }) => b.shape)).map((ring) => {
  const open = ring.length > 3 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring
  const xs = open.map((p) => p[0]); const zs = open.map((p) => p[1])
  const samples: Array<[number | null, number | null]> = []
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.5) {
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += 0.5) {
      if (!inside(open, x, z)) continue
      const [E, N] = bng([x, z])
      const [g, s, v] = [sampleGrid(dtm, E, N), sampleGrid(dsm, E, N), sampleGrid(vom, E, N)]
      samples.push([g === null || s === null ? null : s - g, v])
    }
  }
  return { ring: open.map((p) => p.map((v) => Math.round(v * 10) / 10) as XZ), height: shedHeight(samples), area: area(open), s: locate(river, ...centre(open)).s }
}).sort((a, b) => a.s - b.s)

const rows = sheds.map((b) => `  [[${b.ring.map((p) => p.join(', ')).join(', ')}], ${b.height ?? 'null'}],`)
fs.writeFileSync(path.join(GAME, 'sheds.js'), `// The small waterside buildings OpenStreetMap doesn't have (sheds, boat stores,
// kiosks): Ordnance Survey OpenMap Local footprints within ${NEAR} m of the water,
// each [footprint as x, z pairs, height in metres from the Environment Agency's
// lidar, or null where trees cover it]. Contains OS data © Crown copyright and
// database right; heights © Environment Agency copyright and/or database right;
// both Open Government Licence v3. Made by \`pnpm --filter web course:sheds\`.
export const SHEDS = [
${rows.join('\n')}
];
`)
console.log(`${sheds.length} sheds: ${sheds.map((b) => `${Math.round(b.s)} m ${Math.round(b.area)} m² ${b.height ?? '?'} m`).join('; ')}`)
