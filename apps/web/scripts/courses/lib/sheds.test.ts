import { describe, expect, it } from 'vitest'
import { missingFrom, overlaps, shapefilePolygons, shedHeight } from './sheds'

const square = (x: number, z: number, s = 4): Array<[number, number]> => [[x, z], [x + s, z], [x + s, z + s], [x, z + s], [x, z]]

describe('shapefilePolygons', () => {
  // A shapefile of one polygon record (type 5) and one point record (type 1) after the 100-byte header.
  const file = (...rings: Array<Array<[number, number]>>) => {
    const pts = rings.flat()
    const head = 44 + rings.length * 4
    const poly = Buffer.alloc(8 + head + pts.length * 16)
    poly.writeInt32BE(1, 0)
    poly.writeInt32BE((poly.length - 8) / 2, 4)
    poly.writeInt32LE(5, 8)
    const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1])
    ;[Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].forEach((v, k) => poly.writeDoubleLE(v, 12 + k * 8))
    poly.writeInt32LE(rings.length, 44); poly.writeInt32LE(pts.length, 48)
    rings.reduce((at, r, k) => { poly.writeInt32LE(at, 52 + k * 4); return at + r.length }, 0)
    pts.forEach(([x, y], k) => { poly.writeDoubleLE(x, 8 + head + k * 16); poly.writeDoubleLE(y, 16 + head + k * 16) })
    const point = Buffer.alloc(8 + 20)
    point.writeInt32BE(2, 0); point.writeInt32BE(10, 4); point.writeInt32LE(1, 8)
    return Buffer.concat([Buffer.alloc(100), poly, point])
  }
  it('reads a polygon inside the box and skips other records', () => {
    expect(shapefilePolygons(file(square(10, 20)), [0, 0, 100, 100])).toEqual([square(10, 20)])
  })
  it('keeps only the first ring of a record of two (a building drawn in two outlines)', () => {
    const [one, two] = [square(10, 20), square(40, 20)]
    expect(shapefilePolygons(file(one, two), [0, 0, 100, 100])).toEqual([one])
  })
  it('skips a polygon outside the box', () => {
    expect(shapefilePolygons(file(square(500, 20)), [0, 0, 100, 100])).toEqual([])
  })
})

describe('missingFrom', () => {
  it("keeps only the footprints that touch none of the game's", () => {
    const os = [square(0, 0), square(10, 0), square(20, 0)]
    const game = [square(1, 1, 2), square(12, 3, 6)]
    expect(missingFrom(os, game)).toEqual([square(20, 0)])
    expect(overlaps(square(0, 0), square(3, 3))).toBe(true)
    expect(overlaps(square(0, 0), square(5, 5))).toBe(false)
  })
  it('counts two thin footprints laid across each other like a plus as overlapping', () => {
    const across: Array<[number, number]> = [[0, 4], [10, 4], [10, 6], [0, 6], [0, 4]]
    const along: Array<[number, number]> = [[4, 0], [6, 0], [6, 10], [4, 10], [4, 0]]
    expect(overlaps(across, along)).toBe(true)
    expect(missingFrom([across], [along])).toEqual([])
  })
})

describe('shedHeight', () => {
  it('the 80th percentile of the bare surface, a tree over it left out', () => {
    const s: Array<[number, number | null]> = [[2.4, 0], [2.6, 0], [2.8, 0], [3.0, 0], [3.2, null], [11, 9], [12, 10]]
    expect(shedHeight(s)).toBe(3.2)
  })
  it("a shed's height at least; over 6 m isn't the shed (a missed tree, a wall behind), so unknown", () => {
    expect(shedHeight([[0.5, 0], [0.6, 0], [0.7, 0]])).toBe(1.8)
    expect(shedHeight([[9, 0], [9, 0], [9, 0]])).toBeNull()
    expect(shedHeight([[5.9, 0], [5.9, 0], [5.9, 0]])).toBe(5.9)
  })
  it('the 80th percentile, not the highest, of many samples; rounded to 10 cm', () => {
    const many: Array<[number, number]> = [1, 2, 3, 4, 5, 2.04, 2.04, 2.04, 2.04, 5.9].map((h) => [h, 0])
    expect(shedHeight(many)).toBe(5)
    expect(shedHeight([[2.04, 0], [2.04, 0], [2.04, 0]])).toBe(2)
  })
  it('a low reading of vegetation (under 1.5 m) is bare; two bare samples are too few', () => {
    expect(shedHeight([[3, 1.4], [3, 1.4], [3, 1.4]])).toBe(3)
    expect(shedHeight([[3, 0], [3, 0], [10, 8]])).toBeNull()
  })
  it('none where it is all under trees or unmeasured', () => {
    expect(shedHeight([[10, 8], [11, 9], [null, null]])).toBeNull()
  })
})
