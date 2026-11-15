import { describe, it, expect } from 'vitest'
import { BLOCK, bankCanopy, blockValues, deriveBuildings, deriveGround, deriveTrees, groundBlocks, groundIn, inBlocks, lidarModule, mosaic, osgb36ToBng, readTile, sampleGrid, wgs84ToBng, wgs84ToOsgb36, type Heights, type Patch } from './lidar'

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
})

describe('lidarModule', () => {
  it("writes a module the game can import, with the licence's attribution", async () => {
    const n = BLOCK / 5
    const blocks = groundBlocks({ w: n + 1, h: n + 1, dm: new Array((n + 1) ** 2).fill(10) }, [0, 0, BLOCK, BLOCK], () => true)
    const src = lidarModule(blocks, [[25, 5, 9]], [[40.5, 5.5, 12]], 'somewhere')
    expect(src.replace(/\n\/\/ /g, ' ')).toContain('© Environment Agency copyright and/or database right')
    const { LIDAR } = await import(`data:text/javascript,${encodeURIComponent(src)}`)
    expect(LIDAR.ground).toMatchObject({ cell: 5, block: BLOCK })
    expect(Array.from(blockValues(LIDAR.ground.blocks['0,0']))).toEqual(new Array((n + 1) ** 2).fill(10))
    expect(LIDAR.buildings).toEqual([[25, 5, 9]])
    expect(LIDAR.trees).toEqual([[40.5, 5.5, 12]])
  })
})
