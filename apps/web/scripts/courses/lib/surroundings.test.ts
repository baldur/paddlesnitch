import { describe, it, expect } from 'vitest'
import { CELL, SURROUND_BLOCK, SURROUND_CELL, blockFile, blockKey, buildingsQuery, cellKind, coverageUrl, footprints, fromRowSteps, measureFootprint, newFootprints, roofRise, rowSteps, runs, seamSink, tileName, tileOf, tilesFor, type Footprint } from './surroundings'
import type { XZ } from './river'

describe('the EA squares', () => {
  it("lands on the corridor's own grid (466450, 175400 is one of its squares)", () => {
    expect(tileOf(466450, 175400)).toEqual([466450, 175400])
    expect(tileOf(466699.9, 175649.9)).toEqual([466450, 175400])
    expect(tileOf(466700, 175650)).toEqual([466700, 175650])
    expect(tileOf(466449, 175399)).toEqual([466200, 175150])
  })
  it('lists each square under the points once, south to north then west to east', () => {
    expect(tilesFor([[466500, 175500], [466460, 175410], [466710, 175410], [466500, 175700]])).toEqual([[466450, 175400], [466700, 175400], [466450, 175650]])
  })
  it("asks the EA's WCS for exactly that square, named as course:lidar reads it", () => {
    const url = coverageUrl('dsm', [466450, 175400])
    expect(url.startsWith('https://environment.data.gov.uk/spatialdata/lidar-composite-digital-surface-model-first-return-dsm-1m/wcs?')).toBe(true)
    expect(url).toContain('SUBSET=E(466450,466700)&SUBSET=N(175400,175650)')
    expect(url).toContain('format=image/tiff')
    expect(coverageUrl('vom', [1, 2])).toContain('/vegetation-object-model/wcs?')
    expect(tileName('vom', [466450, 175400])).toBe('vom-466450-175400.tif')
  })
})

describe('the buildings', () => {
  it('asks Overpass for every building within the distance of the river line', () => {
    expect(buildingsQuery([[51.46, -0.97], [51.461, -0.98]], 1060)).toBe('[out:json][timeout:180];(way["building"](around:1060,51.46000,-0.97000,51.46100,-0.98000););out geom;')
  })
  const way = (id: number, tags: Record<string, string>, n = 5) => ({ type: 'way', id, tags, geometry: Array.from({ length: n }, (_, k) => ({ lat: 51.46 + (k % 2) * 0.0001, lon: -0.97 + (k >= 2 ? 0.0001 : 0) })) })
  const toXZ = ([lat, lng]: [number, number]): XZ => [(lng + 0.97) * 1e5, (51.46 - lat) * 1e5]
  it("takes course-file's kinds and heights: levels × 3 + 1, else by kind", () => {
    const f = footprints([way(1, { building: 'detached' }), way(2, { building: 'apartments', 'building:levels': '5' }), way(3, { building: 'industrial' }), way(4, { building: 'boathouse' })], toXZ)
    expect(f.map((b) => [b.kind, b.height])).toEqual([['house', 7], ['flats', 16], ['other', 6], ['boathouse', 6]])
  })
  it('skips nodes, untagged ways and rings under 4 points, and thins a long outline to 12 or so', () => {
    expect(footprints([way(1, { highway: 'path' }), way(2, { building: 'yes' }, 3), { type: 'node', id: 3, tags: { building: 'yes' } }], toXZ)).toEqual([])
    expect(footprints([way(4, { building: 'yes' }, 40)], toXZ)[0].shape.length).toBeLessThanOrEqual(14)
  })
  const square = (x: number, z: number, w: number): XZ[] => [[x, z], [x + w, z], [x + w, z + w], [x, z + w], [x, z]]
  it("leaves out what the course file already has (its middle inside one, or within 2 m of one's middle)", () => {
    const all: Footprint[] = [{ id: 1, shape: square(0, 0, 10), kind: 'house', height: 7 }, { id: 2, shape: square(100, 0, 10), kind: 'house', height: 7 }, { id: 3, shape: square(200, 0, 2), kind: 'other', height: 6 }]
    expect(newFootprints(all, [{ shape: square(1, 1, 9) }, { shape: square(195, -5, 20) }]).map((f) => f.id)).toEqual([2])
  })
  it("measures a flat roof at the 90th percentile of the surface over it, a pitched one's eaves under its rise", () => {
    const g = () => 2
    const flat = measureFootprint({ id: 1, shape: square(0, 0, 10), kind: 'other', height: 6 }, g, () => 14)!
    expect(flat).toEqual({ ground: 2, base: 2, height: 12 })
    const house = measureFootprint({ id: 1, shape: square(0, 0, 10), kind: 'house', height: 7 }, g, () => 11)!
    expect(house.height).toBeCloseTo(9 - roofRise(square(0, 0, 10).slice(0, -1)), 1)
  })
  it('keeps the mapped height for a house measured over three storeys (a tree over it), or with too little lidar', () => {
    expect(measureFootprint({ id: 1, shape: square(0, 0, 10), kind: 'house', height: 7 }, () => 0, () => 20)!.height).toBe(7)
    expect(measureFootprint({ id: 1, shape: square(0, 0, 2), kind: 'other', height: 6 }, () => 0, () => 20)!.height).toBe(6)
    expect(measureFootprint({ id: 1, shape: square(0, 0, 10), kind: 'other', height: 6 }, () => null, () => 20)).toBeNull()
  })
  it("goes down to its lowest corner's ground, on a slope", () => {
    const m = measureFootprint({ id: 1, shape: square(0, 0, 10), kind: 'other', height: 6 }, (x) => x / 2, (x) => x / 2 + 8)!
    expect(m.base).toBe(0)
    expect(m.ground).toBe(2.5)
  })
})

describe('the blocks', () => {
  it('keys a point by the 500 m block it is in', () => {
    expect([blockKey(0, 0), blockKey(-1, 499.9), blockKey(500, -500)]).toEqual(['0,0', '-1,0', '1,-1'])
  })
  it('writes a grid as row steps and reads it back', () => {
    const v = [5, 7, 7, 10, -2, -3, 0, 0, 40]
    expect(rowSteps(v, 3)).toBe('5,2,0,10,-12,-1,0,0,40')
    expect(Array.from(fromRowSteps(rowSteps(v, 3), 3))).toEqual(v)
  })
  it("sinks the ground a metre under the game's land, easing out to nothing 40 m beyond it", () => {
    expect(seamSink(30)).toBe(1)
    expect(seamSink(0)).toBe(1)
    expect(seamSink(-20)).toBeCloseTo(0.5, 5)
    expect(seamSink(-40)).toBe(0)
    expect(seamSink(-400)).toBe(0)
  })
  it("names a cell: not drawn under the game's land, then water, town, woods, grass", () => {
    expect(cellKind({ canopy: 1, built: 1, wet: true, covered: true })).toBe(CELL.none)
    expect(cellKind({ canopy: 1, built: 1, wet: true, covered: false })).toBe(CELL.water)
    expect(cellKind({ canopy: 1, built: 0.2, wet: false, covered: false })).toBe(CELL.town)
    expect(cellKind({ canopy: 0.6, built: 0, wet: false, covered: false })).toBe(CELL.woods)
    expect(cellKind({ canopy: 0.4, built: 0.1, wet: false, covered: false })).toBe(CELL.grass)
  })
  it('writes runs of cells as digit and count', () => {
    expect(runs([0, 0, 0, 0, 2, 2, 4])).toBe('04,22,41')
  })
  it("writes a block's buildings and trees in decimetres from its corner", () => {
    const n = SURROUND_BLOCK / SURROUND_CELL + 1
    const text = blockFile({ i: 1, j: -1 }, new Array(n * n).fill(3), new Array((n - 1) ** 2).fill(0),
      [{ shape: [[510, -490], [520, -490], [520, -480], [510, -490]], kind: 'flats', ground: 1.2, base: 0.9, height: 12.5 }], [[600.04, -100, 11.26]])
    const f = JSON.parse(text)
    expect([f.i, f.j, f.cell]).toEqual([1, -1, SURROUND_CELL])
    expect(f.buildings).toEqual([[100, 100, 200, 100, 200, 200, 12, 9, 125, 1]])
    expect(f.trees).toEqual([[1000, 4000, 113]])
    expect(f.cells).toBe(`0${(n - 1) ** 2}`)
    expect(Array.from(fromRowSteps(f.ground, n)).every((v) => v === 3)).toBe(true)
  })
})
