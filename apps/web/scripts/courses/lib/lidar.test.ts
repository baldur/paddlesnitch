import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { projection } from './river'
import { BLOCK, bankCanopy, bankEdge, bankSkyline, blockValues, canopyAt, toBank, deriveBuildings, deriveGround, deriveRoofs, deriveTrees, fitRoof, groundBlocks, groundIn, inBlocks, inside, lidarModule, registerFootprint, roofError, mosaic, osgb36ToBng, readTile, sampleGrid, wgs84ToBng, wgs84ToOsgb36, type Heights, type Patch, type Roof, type RoofPart } from './lidar'
import { roofHeight } from '../../../../../games/reading-thames/roofs.js'

describe('wgs84ToBng', () => {
  it("projects as the OS's worked example (Caister Water Tower, OSGB36) to the millimetre", () => {
    const [E, N] = osgb36ToBng(52 + 39 / 60 + 27.2531 / 3600, 1 + 43 / 60 + 4.5177 / 3600)
    expect(E).toBeCloseTo(651409.903, 2)
    expect(N).toBeCloseTo(313177.27, 2)
  })
  it('moves WGS84 onto the older datum: about 100 m in Britain, mostly in longitude', () => {
    const [lat, lon] = wgs84ToOsgb36(51.46175, -0.96945)
    const [dn, de] = [(lat - 51.46175) * 111_200, (lon + 0.96945) * 111_200 * Math.cos((51.46 * Math.PI) / 180)]
    expect(Math.hypot(dn, de)).toBeGreaterThan(80)
    expect(Math.hypot(dn, de)).toBeLessThan(130)
  })
  it("turns the game's metres by the grid's convergence at Reading, about 0.8°", () => {
    const [a, b] = [wgs84ToBng(51.46175, -0.96945), wgs84ToBng(51.46175, -0.96945 + 0.01)]
    expect((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI).toBeCloseTo(0.81, 1)
  })
})

describe('sampleGrid', () => {
  const g = { west: 100, north: 200, width: 2, height: 2, cell: 1, values: [1, 2, 3, NaN] }
  it('is bilinear between cell centres, row 0 north', () => {
    const full = { ...g, values: [1, 2, 3, 4] }
    expect(sampleGrid(full, 100.5, 199.5)).toBe(1)
    expect(sampleGrid(full, 101, 199)).toBe(2.5)
    expect(sampleGrid(full, 100.5, 198.5)).toBe(3)
  })
  it('falls back to a neighbour next to a hole, and is null off the grid', () => {
    expect(sampleGrid(g, 101, 199)).toBe(1)
    expect(sampleGrid(g, 50, 50)).toBeNull()
  })
})

// A made-up place in game metres: water (x < 0, at 0.1, as lidar reads it), a
// bank 1 m up beyond it, a 10 m flat roof over 20..30, and a 12 m tree at (40, 5).
const place: Heights = {
  ground: (x) => (x < 0 ? 0.1 : 1),
  above: (x, z) => (x >= 20 && x <= 30 && z >= 0 && z <= 10 ? 9 : Math.hypot(x - 40, z - 5) < 4 ? 12 - Math.hypot(x - 40, z - 5) : 0),
}
const PATCH: Patch = [-20, -10, 60, 20]

describe('deriveGround', () => {
  it('is the land every 5 m, in decimetres, and the bank top out over the water', () => {
    const g = deriveGround(place, PATCH)
    expect([g.w, g.h]).toEqual([17, 7])
    expect(new Set(g.dm)).toEqual(new Set([10]))
    expect(groundIn(g, PATCH, -17, 3)).toBe(1)
  })
  it('takes the median, so a wall or a ditch in the 5 m round a point does not move it', () => {
    const ditch: Heights = { ...place, ground: (x, z) => (x < 0 ? 0.1 : x === 40 && z === 5 ? 3 : 1) }
    expect(new Set(deriveGround(ditch, PATCH).dm)).toEqual(new Set([10]))
  })
})

describe('deriveBuildings', () => {
  const ground = () => 1
  it("gives a flat roof's height above its ground, and a pitched roof's eaves below its ridge", () => {
    const shape: Array<[number, number]> = [[20, 0], [30, 0], [30, 10], [20, 10], [20, 0]]
    expect(deriveBuildings(place, [{ shape, height: 6, kind: 'other' }], PATCH, ground)).toEqual([[25, 5, 9]])
    const [[, , eaves]] = deriveBuildings(place, [{ shape, height: 4, kind: 'house' }], PATCH, ground)
    expect(eaves).toBeCloseTo(9 - (1.5 + 10 * 0.18), 1)
  })
  it("takes a house's roof over three storeys for a tree over it, and leaves the house as mapped", () => {
    const shape: Array<[number, number]> = [[20, 0], [30, 0], [30, 10], [20, 10], [20, 0]]
    const tree: Heights = { ...place, above: (x, z) => (x >= 20 && x <= 30 && z >= 0 && z <= 10 ? 17 : 0) }
    expect(deriveBuildings(tree, [{ shape, height: 7, kind: 'house' }], PATCH, () => 1)).toEqual([])
    expect(deriveBuildings(tree, [{ shape, height: 6, kind: 'other' }], PATCH, () => 1)).toEqual([[25, 5, 17]])
  })
  it('leaves landmarks, and heights within a metre of the map', () => {
    const shape: Array<[number, number]> = [[20, 0], [30, 0], [30, 10], [20, 10]]
    expect(deriveBuildings(place, [{ shape, height: 6, kind: 'other', style: 'rowing-club' }, { shape, height: 8.5, kind: 'other' }], PATCH, ground)).toEqual([])
  })
})

describe('deriveTrees', () => {
  const everywhere = () => false
  const asIs = (x: number, z: number): [number, number] => [x, z]
  it('finds a crown at its highest point with its height, clear of buildings', () => {
    const trees = deriveTrees(place, PATCH, (x, z) => x >= 20 && x <= 30 && z >= 0 && z <= 10, asIs, () => 10)
    expect(trees).toEqual([[40.5, 5.5, 12]])
  })
  it('keeps short trees close to the water only (the triangle budget)', () => {
    const short: Heights = { ...place, above: (x, z) => (Math.hypot(x - 40, z - 5) < 3 ? 6 - Math.hypot(x - 40, z - 5) : 0) }
    expect(deriveTrees(short, PATCH, everywhere, asIs, () => 30)).toHaveLength(1)
    expect(deriveTrees(short, PATCH, everywhere, asIs, () => 50)).toHaveLength(0)
  })
  it('keeps a tree over 12 m to 120 m back and one of 8–12 m to 70 m', () => {
    const tree = (h: number): Heights => ({ ...place, above: (x, z) => (Math.hypot(x - 40, z - 5) < 3 ? h - Math.hypot(x - 40, z - 5) : 0) })
    expect(deriveTrees(tree(13), PATCH, everywhere, asIs, () => 110)).toHaveLength(1)
    expect(deriveTrees(tree(13), PATCH, everywhere, asIs, () => 130)).toHaveLength(0)
    expect(deriveTrees(tree(10), PATCH, everywhere, asIs, () => 60)).toHaveLength(1)
    expect(deriveTrees(tree(10), PATCH, everywhere, asIs, () => 80)).toHaveLength(0)
  })
  it('takes two peaks of one crown as one tree', () => {
    const two: Heights = { ...place, above: (x, z) => Math.max(0, 14 - Math.hypot(x - 40, z - 5), 13.5 - Math.hypot(x - 45, z - 5)) }
    expect(deriveTrees(two, PATCH, everywhere, asIs, () => 10)).toEqual([[40.5, 5.5, 14]])
  })
  it('keeps one tree where two crowns over the water are moved onto the same spot of bank', () => {
    const two: Heights = { ...place, above: (x, z) => Math.max(0, 12 - Math.hypot(x - 40, z - 5), 10 - Math.hypot(x - 50, z - 5)) }
    const bank = (): [number, number] => [45, -2]
    expect(deriveTrees(two, PATCH, everywhere, bank, () => 10)).toEqual([[45, -2, 12]])
  })
  it('looks for crowns hanging over the water only in a vegetation canopy (overWater): there the first surface is boats', () => {
    const over: Heights = { ground: (x) => (x < 0 ? 0.1 : 1), above: (x, z) => (Math.hypot(x + 3, z - 5) < 3 ? 11 - Math.hypot(x + 3, z - 5) : 0) }
    const bank = (): [number, number] => [2, 5]
    expect(deriveTrees(over, PATCH, everywhere, bank, () => 2)).toEqual([])
    expect(deriveTrees(over, PATCH, everywhere, bank, () => 2, () => true, true)).toEqual([[2, 5, 11]])
  })
  it('skips one out over the water, as the bank says', () => {
    expect(deriveTrees(place, PATCH, everywhere, () => null, () => 10)).toEqual([])
  })
})

// A little-endian float32 GeoTIFF as the EA's: one tile of tw × th holding a width × height image.
function tiff(width: number, height: number, tw: number, th: number, value: (c: number, r: number) => number): Uint8Array {
  const tags: Array<[number, number, number]> = [[256, 3, width], [257, 3, height], [258, 3, 32], [259, 3, 1], [322, 3, tw], [323, 3, th], [324, 4, 8 + 2 + 9 * 12 + 4], [325, 4, tw * th * 4], [339, 3, 3]]
  const data = 8 + 2 + tags.length * 12 + 4
  const buf = new DataView(new ArrayBuffer(data + tw * th * 4))
  buf.setUint8(0, 0x49); buf.setUint8(1, 0x49); buf.setUint16(2, 42, true); buf.setUint32(4, 8, true)
  buf.setUint16(8, tags.length, true)
  tags.forEach(([tag, type, v], k) => {
    const at = 10 + k * 12
    buf.setUint16(at, tag, true); buf.setUint16(at + 2, type, true); buf.setUint32(at + 4, 1, true)
    if (type === 3) buf.setUint16(at + 8, v, true); else buf.setUint32(at + 8, v, true)
  })
  for (let r = 0; r < th; r++) for (let c = 0; c < tw; c++) buf.setFloat32(data + (r * tw + c) * 4, c < width && r < height ? value(c, r) : -9999, true)
  return new Uint8Array(buf.buffer)
}

describe('readTile and mosaic', () => {
  it("reads an EA tile's image out of its padded tile, row 0 north", () => {
    const t = readTile(tiff(3, 2, 4, 4, (c, r) => 10 * r + c + 0.5))
    expect([t.width, t.height]).toEqual([3, 2])
    expect(Array.from(t.values)).toEqual([0.5, 1.5, 2.5, 10.5, 11.5, 12.5])
  })
  it('lays tiles side by side by their south-west corners, with none where a square is missing', () => {
    const one = (v: number) => ({ width: 2, height: 2, values: [v, v, v, v] })
    const g = mosaic([{ west: 100, south: 200, ...one(1) }, { west: 102, south: 202, ...one(2) }])
    expect([g.west, g.north, g.width, g.height]).toEqual([100, 204, 4, 4])
    expect(sampleGrid(g, 103.5, 203.5)).toBe(2) // the north-east square
    expect(sampleGrid(g, 100.5, 200.5)).toBe(1) // the south-west one
    expect(sampleGrid(g, 100.5, 203.5)).toBeNull() // the north-west: no tile
  })
})

describe('groundBlocks', () => {
  const n = BLOCK / 5
  // Two blocks across, one down: a slope rising 1 dm a cell eastward.
  const ground = { w: 2 * n + 1, h: n + 1, dm: Array.from({ length: (2 * n + 1) * (n + 1) }, (_, k) => k % (2 * n + 1)) }
  it('writes each kept block as its rows of steps, and reads back the same points', () => {
    const blocks = groundBlocks(ground, [-BLOCK, 0, BLOCK, BLOCK], (i) => i === 1)
    expect(Object.keys(blocks)).toEqual(['0,0'])
    const v = blockValues(blocks['0,0'])
    expect(v.length).toBe((n + 1) ** 2)
    expect(v[0]).toBe(n) // its west edge is the slope's middle
    expect(v[n]).toBe(2 * n)
    expect(blocks['0,0'].split(',').slice(1, 4)).toEqual(['1', '1', '1'])
  })
  it("counts a point on a block's edge or corner as in the block, whichever side it touches from", () => {
    const kept = new Set(['-5,-2'])
    for (const [x, z] of [[-1250, -500], [-1000, -500], [-1250, -250], [-1000, -250], [-1100, -250]]) expect(inBlocks(kept, x, z)).toBe(true)
    expect(inBlocks(kept, -1251, -300)).toBe(false)
  })
})

describe('bankSkyline', () => {
  it("is how high a bank's trees stand at its edge from 20 m out on the water: a 20 m tree 20 m back, behind a bare lawn, as 10 m", () => {
    // The left bank: lawn (0) for its first 18 m, then 20 m trees; the right bank: 8 m trees at the edge; nothing past 300 m.
    const above = (s: number, side: -1 | 1, d: number) => (s > 300 ? null : side < 0 ? (d >= 20 ? 20 : 0) : d <= 4 ? 8 : 0)
    const [left, right] = bankSkyline(400, 50, above)
    expect(left[2]).toBeCloseTo(10, 1) // 20 × 20 / (20 + 20)
    expect(right[2]).toBeCloseTo(8, 1)
    expect(left[8]).toBeNull()
  })
  it("stops at the first building: trees behind a house don't show in the water", () => {
    const above = (_s: number, _side: -1 | 1, d: number) => (d < 6 ? 0 : d < 16 ? -1 : 20)
    const [left] = bankSkyline(200, 50, above)
    expect(left[2]).toBe(0)
  })
  it('takes the trees, not the gaps between them: the 80th percentile along 30 m either way', () => {
    // Trees 15 m high at the edge on two stretches in five along the bank.
    const above = (s: number, _side: -1 | 1, d: number) => (d === 0 && Math.floor(s / 6) % 5 < 2 ? 15 : 0)
    const [left] = bankSkyline(200, 50, above)
    expect(left[2]).toBe(15)
    const [bare] = bankSkyline(200, 50, () => 0)
    expect(bare[2]).toBe(0)
  })
})

describe('bankCanopy', () => {
  it("is how much of the first 14 m by the water is under canopy over 3 m, per bank, every step", () => {
    // The left bank wooded for its first 8 m from 100 m up; the right bank open; nothing measured past 300 m.
    const above = (s: number, side: -1 | 1, d: number) => (s > 300 ? null : side < 0 && s >= 100 && d <= 8 ? 12 : 0.5)
    const [left, right] = bankCanopy(400, 50, above)
    expect(left.slice(0, 2)).toEqual([0, 0])
    expect(left[4]).toBeCloseTo(0.6, 1) // 3 of the 5 rows out from the edge
    expect(right.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0])
    expect(left[8]).toBeNull()
  })
  it('counts canopy over 3 m: 3.5 m of willow scrub is wooded, 2.5 m of reeds is not', () => {
    const [low] = bankCanopy(100, 50, () => 2.5)
    const [high] = bankCanopy(100, 50, () => 3.5)
    expect(low[1]).toBe(0)
    expect(high[1]).toBe(1)
  })
  it('gives a value with half the strip measured, and none with less', () => {
    // The strip's rows out from the edge are at 2, 5, 8, 11 and 14 m; along it, 16 samples.
    const half = (s: number) => bankCanopy(400, 100, (q) => (q - s < 0 ? 5 : null))[0][2]
    expect(half(200 + 2)).not.toBeNull() // 8 of the 16 columns measured
    expect(half(200 - 6)).toBeNull() // 6 of them
  })
})

describe('toBank', () => {
  // Water west of x = 0, land east of it.
  const land = { inside: (x: number) => x < 0, nearest: (x: number, z: number) => ({ x: 0, z, d: Math.abs(x) }) }
  it('leaves a tree on land alone, and puts one at the edge or hanging over the water 2 m up the bank', () => {
    expect(toBank(land, 10, 5)).toEqual([10, 5])
    expect(toBank(land, 1, 5)).toEqual([2, 5])
    expect(toBank(land, -7, 5)).toEqual([2, 5])
  })
  it('drops a crown more than 8 m out: over the water, not hanging from the bank', () => {
    expect(toBank(land, -9, 5)).toBeNull()
  })
})

describe('bankEdge', () => {
  it("is the leaves' height in the first 8 m by the water where most of it is canopy, else none", () => {
    // Left: 10 m willow along the edge from 100 m up, open below; right: a 4 m hedge on one row only.
    const above = (s: number, side: -1 | 1, d: number) => (side < 0 ? (s >= 100 ? 10 : 0) : d === 4 ? 4 : 0)
    const [left, right] = bankEdge(300, 50, above)
    expect(left.slice(0, 2)).toEqual([null, null])
    expect(left[3]).toBe(10)
    expect(right.every((h) => h === null)).toBe(true)
    expect(bankEdge(100, 50, () => null)[0]).toEqual([null, null, null])
  })
  it("takes the 80th percentile of the first 8 m (not past it), over 3 m, where at least half is canopy", () => {
    // Rows out from the edge at 0, 2, 4, 6, 8 m (and a 30 m tree at 10 m, past the strip).
    const graded = (s: number, side: -1 | 1, d: number) => (d > 8 ? 30 : [4, 6, 8, 10, 12][d / 2])
    expect(bankEdge(100, 50, graded)[0][1]).toBe(12)
    const quartiles = (s: number, side: -1 | 1, d: number) => (d > 8 ? 30 : [4, 5, 6, 7, 8][d / 2] + 0.25)
    expect(bankEdge(100, 50, quartiles)[0][1]).toBe(8.3) // rounded to 0.1
    // Exactly half over 3 m counts; less doesn't; 3 m itself isn't canopy.
    const rows = (over: number[], h = 5) => (s: number, side: -1 | 1, d: number) => (over.includes(d) ? h : 1)
    expect(bankEdge(100, 50, rows([0, 2, 4]))[0][1]).not.toBeNull()
    expect(bankEdge(100, 50, rows([0, 2]))[0][1]).toBeNull()
    expect(bankEdge(100, 50, rows([0, 2, 4, 6, 8], 3))[0][1]).toBeNull()
    // Unmeasured points don't count either way: half of what was measured is enough.
    const holes = (s: number, side: -1 | 1, d: number) => (d >= 6 ? null : d === 4 ? 1 : 5)
    expect(bankEdge(100, 50, holes)[0][1]).toBe(5)
  })
})

describe('canopyAt', () => {
  // The river runs north (-z) up x = 0, 20 m wide; a building on the left bank 30 to 40 m up.
  const river = { length: 100 }
  const at = (s: number) => ({ x: 0, z: -s, tx: 0, tz: -1, half: 10 })
  const building = (x: number, z: number) => x < 0 && z < -30 && z > -40
  const sample = canopyAt(river, at, () => true, building, () => 9)
  it("finds each bank's side: left is west going north (-x), right is east", () => {
    const seen: Array<[number, number]> = []
    canopyAt(river, at, (x, z) => (seen.push([x, z]), true), () => false, () => 9)(50, -1, 4)
    canopyAt(river, at, (x, z) => (seen.push([x, z]), true), () => false, () => 9)(50, 1, 4)
    expect(seen).toEqual([[-14, -50], [14, -50]])
  })
  it("counts a roof as open bank (-1: no canopy, and bankSkyline stops there), and nothing off the river or where there's no lidar", () => {
    expect(sample(35, -1, 4)).toBe(-1)
    expect(sample(35, 1, 4)).toBe(9)
    expect(sample(120, 1, 4)).toBeNull()
    expect(canopyAt(river, at, () => false, building, () => 9)(50, 1, 4)).toBeNull()
  })
})

describe('lidarModule', () => {
  it("writes a module the game can import, with the licence's attribution", async () => {
    const n = BLOCK / 5
    const blocks = groundBlocks({ w: n + 1, h: n + 1, dm: new Array((n + 1) ** 2).fill(10) }, [0, 0, BLOCK, BLOCK], () => true)
    const src = lidarModule(blocks, [[25, 5, 9]], [[40.5, 5.5, 12]], 'somewhere', { step: 10, sides: [[0.5, null], [1, 0]] }, { step: 8, sides: [[null, 9.5], [12, null]] })
    expect(src.replace(/\n\/\/ /g, ' ')).toContain('© Environment Agency copyright and/or database right')
    const { LIDAR } = await import(`data:text/javascript,${encodeURIComponent(src)}`)
    expect(LIDAR.ground).toMatchObject({ cell: 5, block: BLOCK })
    expect(Array.from(blockValues(LIDAR.ground.blocks['0,0']))).toEqual(new Array((n + 1) ** 2).fill(10))
    expect(LIDAR.buildings).toEqual([[25, 5, 9]])
    expect(LIDAR.trees).toEqual([[40.5, 5.5, 12]])
    expect(LIDAR.woods).toEqual({ step: 10, sides: [[0.5, null], [1, 0]] })
    expect(LIDAR.edge).toEqual({ step: 8, sides: [[null, 9.5], [12, null]] })
  })
})

// Roofs from the first surface: synthetic lidar over a footprint, each form
// with known eaves, ridge and ridge direction, plus 0.1 m of noise.
describe('fitRoof', () => {
  // A rectangle `len` along `deg` degrees by `wid` across, centred on (cx, cz).
  const rect = (cx: number, cz: number, deg: number, len: number, wid: number): Array<[number, number]> => {
    const [ux, uz] = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)]
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [cx + ux * (a * len) / 2 - uz * (b * wid) / 2, cz + uz * (a * len) / 2 + ux * (b * wid) / 2])
  }
  // (Deterministic noise, so the tests don't flake.)
  const noise = (x: number, z: number) => (Math.sin(x * 12.9898 + z * 78.233) * 43758.5453 % 1) * 0.1
  const local = (cx: number, cz: number, deg: number) => (x: number, z: number) => {
    const [ux, uz] = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)]
    return [(x - cx) * ux + (z - cz) * uz, -(x - cx) * uz + (z - cz) * ux]
  }
  const cellsOf = (ring: Array<[number, number]>, h: (x: number, z: number) => number): Array<[number, number, number]> => {
    const out: Array<[number, number, number]> = []
    for (let x = -30; x < 30; x++) for (let z = -30; z < 30; z++) out.push([x + 0.5, z + 0.5, inside(ring, x + 0.5, z + 0.5) ? h(x + 0.5, z + 0.5) + noise(x, z) : noise(x, z)])
    return out
  }
  // The ridge's direction in degrees (mod 180) of a fitted single part.
  const ridgeDeg = (rec: Roof) => (((rec[2] as number) + 90 * (((rec[4] as RoofPart)[1] as number) ?? 0)) % 180 + 180) % 180
  const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThan(tol)
  const angleNear = (a: number, b: number, tol: number) => expect(Math.min(Math.abs(a - b) % 180, 180 - (Math.abs(a - b) % 180))).toBeLessThan(tol)

  it('finds a flat roof at its height', () => {
    const ring = rect(0, 0, 20, 14, 9)
    const rec = fitRoof(ring, cellsOf(ring, () => 9), 'other')
    expect(rec[4]).toEqual(['flat', expect.any(Number)])
    near((rec[4] as RoofPart)[1] as number, 9, 0.15)
  })
  it('finds a gable: its ridge along the long side, the ridge and eaves heights', () => {
    const ring = rect(1, -2, 30, 12, 8)
    const at = local(1, -2, 30)
    const rec = fitRoof(ring, cellsOf(ring, (x, z) => 8 - (3 * Math.abs(at(x, z)[1])) / 4), 'house')
    const part = rec[4] as RoofPart
    expect(part[0]).toBe('gable')
    angleNear(ridgeDeg(rec), 30, 3)
    near(part[3] as number, 8, 0.25)
    near(part[2] as number, 5, 0.3)
    near(part[4] as number, 0.5, 0.1)
  })
  it('finds a gable whose ridge runs across a short, deep house (gable to the street)', () => {
    const ring = rect(0, 0, -15, 7, 11)
    const at = local(0, 0, -15)
    const rec = fitRoof(ring, cellsOf(ring, (x, z) => 7.5 - (3 * Math.abs(at(x, z)[0])) / 3.5), 'house')
    expect((rec[4] as RoofPart)[0]).toBe('gable')
    angleNear(ridgeDeg(rec), 75, 3)
    near((rec[4] as RoofPart)[3] as number, 7.5, 0.25)
  })
  it('finds a hip: the ridge shortened by the hips at its ends', () => {
    const ring = rect(0, 0, 50, 14, 9)
    const at = local(0, 0, 50)
    // Every face at the same pitch, 3 m up over 4.5 m: the ridge 5 m long, 4.5 m in from each end.
    const rec = fitRoof(ring, cellsOf(ring, (x, z) => { const [u, v] = at(x, z); return 5.5 + (3 / 4.5) * Math.min(4.5 - Math.abs(v), 7 - Math.abs(u)) }), 'house')
    const part = rec[4] as RoofPart
    expect(part[0]).toBe('hip')
    angleNear(ridgeDeg(rec), 50, 3)
    near(part[3] as number, 8.5, 0.25)
    near(part[2] as number, 5.5, 0.3)
    near(part[5] as number, 4.5, 1)
  })
  it('finds a mono-pitch (lean-to) roof and which way it rises', () => {
    const ring = rect(0, 0, 0, 10, 6)
    const rec = fitRoof(ring, cellsOf(ring, (x, z) => 3 + ((z + 3) / 6) * 1.5), 'other')
    const part = rec[4] as RoofPart
    expect(part[0]).toBe('shed')
    // Rising towards +z: the part's +v is +z.
    expect(((rec[2] as number) + 90 * (part[1] as number)) % 360).toBeCloseTo(0, 0)
    near(part[2] as number, 3, 0.3)
    near(part[3] as number, 4.5, 0.3)
  })
  it('splits a terrace stepping down a hill into parts at their own heights', () => {
    const ring = rect(0, 0, 10, 24, 8)
    const at = local(0, 0, 10)
    const rec = fitRoof(ring, cellsOf(ring, (x, z) => { const [u, v] = at(x, z); return (u < 0 ? 9 : 7) - (2.5 * Math.abs(v)) / 4 }), 'house')
    expect((rec[3] as number[]).length).toBe(1)
    near((rec[3] as number[])[0], 0, 1.5)
    const [a, b] = rec.slice(4) as RoofPart[]
    expect([a[0], b[0]]).toEqual(['gable', 'gable'])
    near(a[3] as number, 9, 0.3)
    near(b[3] as number, 7, 0.3)
  })
  it('gives an L its two ridges, square to each other', () => {
    // An L: a 16 x 7 range along x and a 7-wide wing down from its east end, 9 more metres.
    const ring: Array<[number, number]> = [[-8, -3.5], [8, -3.5], [8, 12.5], [1, 12.5], [1, 3.5], [-8, 3.5]]
    const range = (z: number) => 7 - (2.5 * Math.abs(z)) / 3.5
    const wing = (x: number) => 7 - (2.5 * Math.abs(x - 4.5)) / 3.5
    const h = (x: number, z: number) => (x <= 1 ? range(z) : z > 3.5 ? wing(x) : Math.max(range(z), wing(x)))
    const cells = cellsOf(ring, h)
    const rec = fitRoof(ring, cells, 'house')
    const parts = rec.slice(4) as RoofPart[]
    expect(parts.length).toBe(2)
    expect(parts.every((p) => p[0] === 'gable')).toBe(true)
    const dirs = parts.map((p) => (((rec[2] as number) + 90 * (p[1] as number)) % 180 + 180) % 180)
    angleNear(Math.abs(dirs[0] - dirs[1]), 90, 3)
    const err = roofError(ring, rec, cells.filter(([x, z]) => inside(ring, x, z)))
    expect(err.inliers).toBeGreaterThan(0.9)
  })
  it('sees past a tree over part of the roof', () => {
    const ring = rect(0, 0, 0, 12, 8)
    const rec = fitRoof(ring, cellsOf(ring, (x, z) => (Math.hypot(x - 4, z - 2) < 2.5 ? 13 : 8 - (3 * Math.abs(z)) / 4)), 'house')
    expect((rec[4] as RoofPart)[0]).toBe('gable')
    near((rec[4] as RoofPart)[3] as number, 8, 0.3)
  })
  it("refuses to guess where there's too little lidar, or it's noise", () => {
    const small = rect(0, 0, 0, 3, 3)
    expect(fitRoof(small, cellsOf(small, () => 4), 'other')[2]).toBe('few')
    const ring = rect(0, 0, 0, 12, 8)
    const rough = (x: number, z: number) => 4 + (Math.sin(x * 91.7 + z * 13.1) * 9e3 % 1 + 1) * 4
    expect(fitRoof(ring, cellsOf(ring, rough), 'house')[2]).toBe('noisy')
  })
  it('takes a house over three storeys for a tree over it', () => {
    const ring = rect(0, 0, 0, 12, 8)
    expect(fitRoof(ring, cellsOf(ring, () => 14), 'house')[2]).toBe('tall')
  })
  it("draws the surface it fitted: roofs.js's height there is the lidar's", () => {
    const ring = rect(3, 4, 12, 12, 8)
    const at = local(3, 4, 12)
    const truth = (x: number, z: number) => 8 - (3 * Math.abs(at(x, z)[1])) / 4
    const rec = fitRoof(ring, cellsOf(ring, truth), 'house')
    for (const [x, z] of [[3, 4], [5, 5], [1, 2.5]] as Array<[number, number]>) near(roofHeight(ring, rec, x, z), truth(x, z), 0.3)
  })
})

describe('registerFootprint', () => {
  it("finds how far the lidar's building stands from the map's footprint", () => {
    const ring: Array<[number, number]> = [[0, 0], [10, 0], [10, 7], [0, 7]]
    // The lidar's building is 2.5 m east and 1.5 m north (-z) of the map's.
    const high = (x: number, z: number) => x > 2.5 && x < 12.5 && z > -1.5 && z < 5.5
    const { shift } = registerFootprint([ring], high)
    expect(shift).toEqual([2.5, -1.5])
  })
})

// On the real lidar, where it's on this computer (it never goes in the repo,
// so CI skips this): the roofs fitted round Caversham Bridge against the first
// surface they were fitted to. Measured 2026-11-26: see games/CLAUDE.md.
const TILES = path.join(os.homedir(), '.paddlesnitch/lidar/reading-thames/tiles')
describe.skipIf(!fs.existsSync(TILES))('fitRoof on the real lidar', () => {
  it("fits most of the houses by Caversham Bridge, to about 0.3 m", async () => {
    const reading = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../../../games/reading-thames/courses/reading.json'), 'utf8'))
    const { toLatLng } = projection([51.46175, -0.96945])
    const bng = (x: number, z: number) => wgs84ToBng(...toLatLng([x, z]))
    const [X0, Z0, X1, Z1] = [-700, -700, 200, 200]
    const corners = [bng(X0, Z0), bng(X1, Z1), bng(X0, Z1), bng(X1, Z0)]
    const [E0, E1] = [Math.min(...corners.map((c) => c[0])) - 260, Math.max(...corners.map((c) => c[0])) + 10]
    const [N0, N1] = [Math.min(...corners.map((c) => c[1])) - 260, Math.max(...corners.map((c) => c[1])) + 10]
    const grid = (kind: string) => mosaic(fs.readdirSync(TILES).flatMap((name) => {
      const m = name.match(new RegExp(`^${kind}-(\\d+)-(\\d+)\\.tif$`))
      if (!m || +m[1] < E0 || +m[1] > E1 || +m[2] < N0 || +m[2] > N1) return []
      return [{ west: +m[1], south: +m[2], ...readTile(fs.readFileSync(path.join(TILES, name))) }]
    }))
    const [dtm, dsm] = [grid('dtm'), grid('dsm')]
    const h: Heights = {
      ground: (x, z) => sampleGrid(dtm, ...bng(x, z)),
      above: (x, z) => { const [E, N] = bng(x, z); const [s, g] = [sampleGrid(dsm, E, N), sampleGrid(dtm, E, N)]; return s === null || g === null ? null : s - g },
    }
    const groundAt = (x: number, z: number) => { const v: number[] = []; for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { const g = h.ground(x + a, z + b); if (g !== null) v.push(g) } return v.sort((p, q) => p - q)[v.length >> 1] ?? 0 }
    const { roofs, errors, cells } = deriveRoofs(h, reading.buildings, [X0, Z0, X1, Z1], groundAt)
    const fittedOnes = roofs.flatMap((r, i) => (Array.isArray(r[3]) ? [i] : []))
    expect(roofs.length).toBeGreaterThan(60)
    expect(fittedOnes.length).toBeGreaterThan(roofs.length * 0.6)
    // Per building: the RMS of the cells within TAU of the roof, and the median miss over all of them (trees and all).
    const rms = fittedOnes.map((i) => errors[i]!.rms).sort((a, b) => a - b)
    const miss = fittedOnes.map((i) => errors[i]!.median).sort((a, b) => a - b)
    const at = (a: number[], q: number) => a[Math.floor(a.length * q)]
    expect(at(rms, 0.5)).toBeLessThan(0.3)
    expect(at(rms, 0.9)).toBeLessThan(0.4)
    expect(at(miss, 0.5)).toBeLessThan(0.35)
    expect(at(miss, 0.9)).toBeLessThan(0.65)
    // And the ridge: the roof's highest point against the lidar's (its 95th percentile) over the footprint.
    const ridge = fittedOnes.map((i) => {
      const rec = roofs[i] as Roof
      const top = Math.max(...(rec.slice(4) as RoofPart[]).map((p) => (p[0] === 'flat' ? p[1] : p[3])))
      const hs = cells[i].map((c) => c[2]).sort((a, b) => a - b)
      return Math.abs(top - hs[Math.floor(hs.length * 0.95)])
    }).sort((a, b) => a - b)
    console.log(`real roofs: ${fittedOnes.length} of ${roofs.length} fitted; RMS median ${at(rms, 0.5).toFixed(2)} m, 90% ${at(rms, 0.9).toFixed(2)}; median miss ${at(miss, 0.5).toFixed(2)}, 90% ${at(miss, 0.9).toFixed(2)}; ridge off by median ${at(ridge, 0.5).toFixed(2)}, 90% ${at(ridge, 0.9).toFixed(2)} m`)
    expect(at(ridge, 0.5)).toBeLessThan(0.5)
  }, 300_000)
})
