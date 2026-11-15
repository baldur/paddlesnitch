#!/usr/bin/env node
// The Reading game's lidar numbers: ground, buildings' heights and trees along
// the river, from Environment Agency lidar kept on this computer.
//
//   pnpm --filter web course:lidar <area> "<where>"
//
// Reads ~/.paddlesnitch/lidar/<area>/tiles/: the EA's 250 m squares as
// dtm-<E>-<N>.tif and dsm-<E>-<N>.tif (float32 GeoTIFFs, <E>, <N> their
// south-west corner in British National Grid metres; a corridor, so some
// squares are missing). Those stay there: never commit them. Writes
// games/reading-thames/lidar.js (numbers worked out from them only) in 250 m
// blocks wherever the game draws land (within REACH of the river) and the lidar
// covers. <where> goes in its header ("from Caversham Lock to Mapledurham Lock").
// Licence: OGL v3, credited in the game.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { projection, type XZ } from './lib/river'
import { BLOCK, GROUND_CELL, bankCanopy, canopyAt, deriveBuildings, deriveGround, deriveTrees, groundBlocks, groundIn, inBlocks, inside, lidarModule, mosaic, readTile, sampleGrid, wgs84ToBng, type Building, type Grid, type Patch } from './lib/lidar'
import { courseFromFile, locate, pointAt, widthAt } from '../../../../games/reading-thames/course.js'
import { waterMap } from '../../../../games/reading-thames/water.js'

const [area, where] = process.argv.slice(2)
if (!area || !where) throw new Error('usage: course:lidar <area> "<where>"')
// How far from the river's edge blocks are kept: the game's land reaches 320 m.
const REACH = 340
const TILES = path.join(os.homedir(), '.paddlesnitch/lidar', area, 'tiles')
const grid = (kind: string): Grid => mosaic(fs.readdirSync(TILES).flatMap((name) => {
  const m = name.match(new RegExp(`^${kind}-(\\d+)-(\\d+)\\.tif$`))
  if (!m) return []
  const t = readTile(fs.readFileSync(path.join(TILES, name)))
  return [{ west: Number(m[1]), south: Number(m[2]), ...t }]
}))
const [dtm, dsm] = [grid('dtm'), grid('dsm')]
console.log(`lidar ${dtm.width} × ${dtm.height} m from ${dtm.west}, ${dtm.north}`)

const GAME = path.join(process.cwd(), '../../games/reading-thames')
const data = JSON.parse(fs.readFileSync(path.join(GAME, 'courses/reading.json'), 'utf8'))
const course = courseFromFile(data)
const river = course.scenery.river
const { toLatLng } = projection([51.46175, -0.96945])
// Game metres to the grid's: exact at each block's corners, straight between
// (the projections' curvature is millimetres over 250 m), so millions of samples are quick.
const exact = (x: number, z: number) => wgs84ToBng(...toLatLng([x, z]))
const fits = new Map<string, { o: XZ; a: XZ; ex: XZ; ez: XZ }>()
const bng = (x: number, z: number): [number, number] => {
  const [bi, bj] = [Math.floor(x / BLOCK), Math.floor(z / BLOCK)]
  const key = `${bi},${bj}`
  let f = fits.get(key)
  if (!f) {
    const o: XZ = [bi * BLOCK, bj * BLOCK]
    const [a, b, c] = [exact(...o), exact(o[0] + BLOCK, o[1]), exact(o[0], o[1] + BLOCK)]
    f = { o, a, ex: [(b[0] - a[0]) / BLOCK, (b[1] - a[1]) / BLOCK], ez: [(c[0] - a[0]) / BLOCK, (c[1] - a[1]) / BLOCK] }
    fits.set(key, f)
  }
  const [dx, dz] = [x - f.o[0], z - f.o[1]]
  return [f.a[0] + f.ex[0] * dx + f.ez[0] * dz, f.a[1] + f.ex[1] * dx + f.ez[1] * dz]
}
// The river's surface, from the lidar (its water is flat to a few centimetres;
// Caversham Lock to Mapledurham Lock is one reach).
const centre = bng(-600, -480)
const water = sampleGrid(dsm, ...centre)
if (water === null) throw new Error('the patch is off the lidar')
console.log(`water surface ${water.toFixed(2)} m`)
const heights = {
  ground: (x: number, z: number) => { const v = sampleGrid(dtm, ...bng(x, z)); return v === null ? null : v - water },
  above: (x: number, z: number) => { const [E, N] = bng(x, z); const [s, g] = [sampleGrid(dsm, E, N), sampleGrid(dtm, E, N)]; return s === null || g === null ? null : s - g },
}

// The blocks: the river's edge within REACH, and lidar under at least a third of them.
const fromEdge = (x: number, z: number) => { const at = locate(river, x, z); return Math.abs(at.lateral) - widthAt(river, at.s).half }
const near = new Set<string>()
for (let s = 0; s < river.length; s += 20) {
  const c = pointAt(river, s)
  const half = widthAt(river, s).half
  for (const side of [-1, 1]) for (let d = 0; d <= half + REACH; d += 20) near.add(`${Math.floor((c.x - c.tz * side * d) / BLOCK)},${Math.floor((c.z + c.tx * side * d) / BLOCK)}`)
}
const kept = new Set([...near].filter((key) => {
  const [i, j] = key.split(',').map(Number)
  let hits = 0
  for (let a = 0; a < 10; a++) for (let b = 0; b < 10; b++) if (heights.ground(i * BLOCK + 12.5 + a * 25, j * BLOCK + 12.5 + b * 25) !== null) hits++
  return hits >= 34
}))
const keys = [...kept].map((k) => k.split(',').map(Number))
const patch: Patch = [Math.min(...keys.map((k) => k[0])) * BLOCK, Math.min(...keys.map((k) => k[1])) * BLOCK, (Math.max(...keys.map((k) => k[0])) + 1) * BLOCK, (Math.max(...keys.map((k) => k[1])) + 1) * BLOCK]
const inKept = (x: number, z: number) => inBlocks(kept, x, z)
console.log(`${kept.size} blocks over ${patch.join(', ')}`)

const ground = deriveGround(heights, patch, inKept)
const blocks = groundBlocks(ground, patch, (i, j) => kept.has(`${Math.round(patch[0] / BLOCK) + i},${Math.round(patch[1] / BLOCK) + j}`))
const buildings = data.buildings as Building[]
const heightsOut = deriveBuildings(heights, buildings.filter((b) => inKept(...(b.shape[0] as XZ))), patch, (x, z) => groundIn(ground, patch, x, z))

// Trees stay off buildings and bridges; a trunk goes at least 2 m up the
// game's bank (its mapped edge), or isn't planted if well out over the water.
const land = waterMap(data.water ?? [])
const bridges = (data.bridges as Array<{ ends?: [XZ, XZ] }>).flatMap((b) => (b.ends ? [b.ends] : []))
const onBridge = (x: number, z: number) => bridges.some(([a, b]) => {
  const [dx, dz] = [b[0] - a[0], b[1] - a[1]]
  const len = Math.hypot(dx, dz)
  const t = ((x - a[0]) * dx + (z - a[1]) * dz) / len
  return t > -15 && t < len + 15 && Math.abs((-(x - a[0]) * dz + (z - a[1]) * dx) / len) < 16
})
const keepOut = (x: number, z: number) => buildings.some((b) => inside(b.shape, x, z)) || onBridge(x, z)
const onBank = (x: number, z: number): XZ | null => {
  const near = land.nearest(x, z)
  const wet = land.inside(x, z)
  if (!near || (!wet && near.d >= 2)) return [x, z]
  if (wet && near.d > 6) return null
  const [ux, uz] = [(x - near.x) / (near.d || 1), (z - near.z) / (near.d || 1)]
  const k = wet ? -2 : 2
  const p: XZ = [near.x + ux * k, near.z + uz * k]
  return land.inside(...p) ? null : p
}
const trees = deriveTrees(heights, patch, keepOut, onBank, fromEdge, inKept)

const out = path.join(GAME, 'lidar.js')
// How wooded each bank is, for the water's reflections, from the canopy itself.
const woods = bankCanopy(river.length, 10, canopyAt(river, (s) => ({ ...pointAt(river, s), half: widthAt(river, s).half }), inKept, keepOut, heights.above))
fs.writeFileSync(out, lidarModule(blocks, heightsOut, trees, where, { step: 10, sides: woods }))
console.log(`${out}: ${Object.keys(blocks).length} blocks of ${GROUND_CELL} m ground, ${heightsOut.length} buildings, ${trees.length} trees, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`)
