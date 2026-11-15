import { describe, it, expect } from 'vitest'
import { deriveBuildings, deriveGround, deriveTrees, groundIn, lidarModule, osgb36ToBng, sampleGrid, wgs84ToBng, wgs84ToOsgb36, type Heights, type Patch } from './lidar'

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
  it('skips one out over the water, as the bank says', () => {
    expect(deriveTrees(place, PATCH, everywhere, () => null, () => 10)).toEqual([])
  })
})

describe('lidarModule', () => {
  it("writes a module the game can import, with the licence's attribution", async () => {
    const ground = deriveGround(place, PATCH)
    const src = lidarModule(PATCH, ground, [[25, 5, 9]], [[40.5, 5.5, 12]])
    expect(src.replace(/\n\/\/ /g, ' ')).toContain('© Environment Agency copyright and/or database right')
    const { LIDAR } = await import(`data:text/javascript,${encodeURIComponent(src)}`)
    expect(LIDAR.ground).toMatchObject({ x0: -20, z0: -10, cell: 5, w: 17, h: 7 })
    expect(LIDAR.ground.dm).toHaveLength(17 * 7)
    expect(LIDAR.buildings).toEqual([[25, 5, 9]])
    expect(LIDAR.trees).toEqual([[40.5, 5.5, 12]])
  })
})
