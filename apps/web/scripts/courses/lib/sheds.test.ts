import { describe, expect, it } from 'vitest'
import { missingFrom, overlaps, shapefilePolygons, shedHeight } from './sheds'

const square = (x: number, z: number, s = 4): Array<[number, number]> => [[x, z], [x + s, z], [x + s, z + s], [x, z + s], [x, z]]

describe('shapefilePolygons', () => {
  // A shapefile of one polygon record (type 5) and one point record (type 1) after the 100-byte header.
  const file = (ring: Array<[number, number]>) => {
    const poly = Buffer.alloc(8 + 44 + 4 + ring.length * 16)
    poly.writeInt32BE(1, 0)
    poly.writeInt32BE((poly.length - 8) / 2, 4)
    poly.writeInt32LE(5, 8)
    const xs = ring.map((p) => p[0]); const ys = ring.map((p) => p[1])
    ;[Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].forEach((v, k) => poly.writeDoubleLE(v, 12 + k * 8))
    poly.writeInt32LE(1, 44); poly.writeInt32LE(ring.length, 48); poly.writeInt32LE(0, 52)
    ring.forEach(([x, y], k) => { poly.writeDoubleLE(x, 56 + k * 16); poly.writeDoubleLE(y, 64 + k * 16) })
    const point = Buffer.alloc(8 + 20)
    point.writeInt32BE(2, 0); point.writeInt32BE(10, 4); point.writeInt32LE(1, 8)
    return Buffer.concat([Buffer.alloc(100), poly, point])
  }
  it('reads a polygon inside the box and skips other records', () => {
    expect(shapefilePolygons(file(square(10, 20)), [0, 0, 100, 100])).toEqual([square(10, 20)])
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
})

describe('shedHeight', () => {
  it('the 80th percentile of the bare surface, a tree over it left out', () => {
    const s: Array<[number, number | null]> = [[2.4, 0], [2.6, 0], [2.8, 0], [3.0, 0], [3.2, null], [11, 9], [12, 10]]
    expect(shedHeight(s)).toBe(3.2)
  })
  it("a shed's height at least, and no tower", () => {
    expect(shedHeight([[0.5, 0], [0.6, 0], [0.7, 0]])).toBe(1.8)
    expect(shedHeight([[9, 0], [9, 0], [9, 0]])).toBe(6)
  })
  it('none where it is all under trees or unmeasured', () => {
    expect(shedHeight([[10, 8], [11, 9], [null, null]])).toBeNull()
  })
})
