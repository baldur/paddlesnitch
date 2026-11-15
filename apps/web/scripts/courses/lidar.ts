#!/usr/bin/env node
// The Reading game's lidar numbers: ground, buildings' heights and trees for a
// patch of the river, from Environment Agency lidar kept on this computer.
//
//   pnpm --filter web course:lidar <area> <x0> <z0> <x1> <z1>
//
// Reads ~/.paddlesnitch/lidar/<area>/: dtm.bin and dsm.bin (float32,
// little-endian, row 0 north) and grid.json ({west, north, width, height,
// cell_m} in British National Grid metres). Those stay there: never commit
// them. Writes games/reading-thames/lidar.js (numbers worked out from them
// only) for the patch x0..x1, z0..z1 in game metres (multiples of 5 apart).
// Licence: OGL v3, credited in the game.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { projection, type XZ } from './lib/river'
import { deriveBuildings, deriveGround, deriveTrees, groundIn, inside, lidarModule, sampleGrid, wgs84ToBng, type Building, type Grid, type Patch } from './lib/lidar'
import { courseFromFile, locate, widthAt } from '../../../../games/reading-thames/course.js'
import { waterMap } from '../../../../games/reading-thames/water.js'

const [area, ...nums] = process.argv.slice(2)
const patch = nums.map(Number) as Patch
if (!area || patch.length !== 4 || patch.some((v) => !Number.isFinite(v))) throw new Error('usage: course:lidar <area> <x0> <z0> <x1> <z1>')
const DIR = path.join(os.homedir(), '.paddlesnitch/lidar', area)
const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'grid.json'), 'utf8')) as { west: number; north: number; width: number; height: number; cell_m: number }
const grid = (name: string): Grid => {
  const b = fs.readFileSync(path.join(DIR, name))
  return { west: meta.west, north: meta.north, width: meta.width, height: meta.height, cell: meta.cell_m, values: new Float32Array(b.buffer, b.byteOffset, b.length / 4) }
}
const [dtm, dsm] = [grid('dtm.bin'), grid('dsm.bin')]

const GAME = path.join(process.cwd(), '../../games/reading-thames')
const data = JSON.parse(fs.readFileSync(path.join(GAME, 'courses/reading.json'), 'utf8'))
const course = courseFromFile(data)
const river = course.scenery.river
const { toLatLng } = projection([51.46175, -0.96945])
// The river's surface, from the lidar (its water is flat to a few centimetres).
const bng = (x: number, z: number) => wgs84ToBng(...toLatLng([x, z]))
const centre = bng(-600, -480)
const water = sampleGrid(dsm, ...centre)
if (water === null) throw new Error('the patch is off the lidar')
console.log(`water surface ${water.toFixed(2)} m`)
const heights = {
  ground: (x: number, z: number) => { const v = sampleGrid(dtm, ...bng(x, z)); return v === null ? null : v - water },
  above: (x: number, z: number) => { const [E, N] = bng(x, z); const [s, g] = [sampleGrid(dsm, E, N), sampleGrid(dtm, E, N)]; return s === null || g === null ? null : s - g },
}

const ground = deriveGround(heights, patch)
const buildings = data.buildings as Building[]
const heightsOut = deriveBuildings(heights, buildings, patch, (x, z) => groundIn(ground, patch, x, z))

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
const fromWater = (x: number, z: number) => { const at = locate(river, x, z); return Math.abs(at.lateral) - widthAt(river, at.s).half }
const trees = deriveTrees(heights, patch, keepOut, onBank, fromWater)

const out = path.join(GAME, 'lidar.js')
fs.writeFileSync(out, lidarModule(patch, ground, heightsOut, trees))
console.log(`${out}: ground ${ground.w}×${ground.h}, ${heightsOut.length} buildings, ${trees.length} trees`)
