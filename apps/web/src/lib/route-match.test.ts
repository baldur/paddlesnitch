import { describe, it, expect } from 'vitest'
import { resampleLine, routeCells, cellOverlap, comparability, MIN_SHARED_M } from '@paddlesnitch/analysis/route-match'
import { sharedSameWayM, type LinePoint } from '@paddlesnitch/analysis/line-compare'

const LAT0 = 51.46, LNG0 = -0.93
const toLL = (x: number, y: number) => ({ lat: LAT0 + y / 110_540, lng: LNG0 + x / (Math.cos(51 * Math.PI / 180) * 111_320) })
function boat(path: [number, number][], speed = 3, every = 1): LinePoint[] {
  const out: LinePoint[] = []; let seg = 0, along = 0, t = 0
  const L = (i: number) => Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1])
  while (seg < path.length - 1) {
    const f = along / L(seg), [x0, y0] = path[seg], [x1, y1] = path[seg + 1]
    out.push({ t, ...toLL(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f) })
    along += speed * every; t += every
    while (seg < path.length - 1 && along >= L(seg)) { along -= L(seg); seg++ }
  }
  return out
}
const m = (a: LinePoint, b: LinePoint) => Math.hypot((a.lat - b.lat) * 110_540, (a.lng - b.lng) * Math.cos(51 * Math.PI / 180) * 111_320)

describe('route matching', () => {
  it('resamples every 25 m, whatever the recording rate (a watch every second, a tracker every 10 s)', () => {
    for (const every of [1, 10]) {
      const r = resampleLine(boat([[0, 0], [0, 2000]], 3, every))
      const gaps = r.slice(1).map((p, i) => m(r[i], p))
      expect(Math.max(...gaps.slice(0, -1))).toBeCloseTo(25, 0)
      expect(r.length).toBeGreaterThan(75)
    }
  })

  it("two lines on either side of a river share squares; another river doesn't", () => {
    const a = routeCells(boat([[0, 0], [0, 2000]])), b = routeCells(boat([[40, 0], [40, 2000]]))
    expect(cellOverlap(a, b)).toBeGreaterThan(0.95)
    expect(cellOverlap(a, routeCells(boat([[3000, 0], [3000, 2000]])))).toBe(0)
  })

  it('a short paddle on part of a long route overlaps fully (the smaller route counts)', () => {
    expect(cellOverlap(routeCells(boat([[0, 0], [0, 5000]])), routeCells(boat([[0, 1000], [0, 2000]])))).toBe(1)
  })

  it('an out-and-back turned at different places shares both legs, not just the longest', () => {
    // The owner's club outings: out ~5 km and back, each turning at its own spot.
    const a = resampleLine(boat([[0, 0], [0, 5000], [20, 5000], [20, 0]]))
    const b = resampleLine(boat([[0, 0], [0, 4600], [20, 4600], [20, 0]]))
    expect(sharedSameWayM(a, b)).toBeGreaterThan(8500)
  })

  it('the other direction shares nothing the same way', () => {
    const a = resampleLine(boat([[0, 0], [0, 3000]])), b = resampleLine(boat([[0, 3000], [0, 0]]))
    expect(sharedSameWayM(a, b)).toBe(0)
  })

  it('says why a paddle is worth comparing, or that it is not', () => {
    expect(comparability({ together: true, sharedM: 0, aKm: 10, bKm: 3 })?.kind).toBe('together')
    expect(comparability({ together: false, sharedM: 9800, aKm: 10.3, bKm: 10.8 })?.kind).toBe('same_route')
    expect(comparability({ together: false, sharedM: 2700, aKm: 15, bKm: 19.9 })?.kind).toBe('partly')
    expect(comparability({ together: false, sharedM: MIN_SHARED_M - 1, aKm: 10, bKm: 10 })).toBeNull()
    // Same water, but one paddled four times as far: not "the same route".
    expect(comparability({ together: false, sharedM: 2500, aKm: 2.5, bKm: 10 })?.kind).toBe('partly')
  })
})
