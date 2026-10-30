import { describe, it, expect } from 'vitest'
import { along, joinRuns, offLand, routePoints, smoothTurns, tightest } from './route'
import { routePlaces } from './course-file'
import { cumulative, resample, type XZ } from './river'

// Open water everywhere but a square island (x and z from 0 to 20).
const island = (x: number, z: number) => x > 0 && x < 20 && z > 0 && z < 20
const water = {
  inside: (x: number, z: number) => !island(x, z),
  nearest(x: number, z: number) {
    const cx = Math.max(0, Math.min(20, x))
    const cz = Math.max(0, Math.min(20, z))
    if (!island(x, z)) return { x: cx, z: cz, d: Math.hypot(x - cx, z - cz) }
    const sides = [{ x: 0, z, d: x }, { x: 20, z, d: 20 - x }, { x, z: 0, d: z }, { x, z: 20, d: 20 - z }]
    return sides.reduce((a, b) => (a.d < b.d ? a : b))
  },
}
const clear = ([x, z]: XZ) => water.inside(x, z) && water.nearest(x, z).d >= 3

describe('a racing line round islands', () => {
  it('rounds a right-angle corner off to a turn a K1 can make, where there is water for it', () => {
    const corner: XZ[] = [[-100, -50], [-50, -50], [-50, -100]]
    expect(tightest(resample(corner, 5))).toBeLessThan(5)
    const line = smoothTurns(corner, () => true, 12, 5)
    expect(tightest(line)).toBeGreaterThanOrEqual(11)
  })

  it('never rounds a corner across land: a turn round an island stays off it', () => {
    // Round the island's corner at (20, 20), close in.
    const round: XZ[] = [[24, -40], [24, 24], [-40, 24]]
    const line = smoothTurns(round, clear, 30, 5)
    for (const p of resample(line, 1)) expect(water.inside(p[0], p[1])).toBe(true)
  })

  it('moves a leg that clips an island off it, out onto the water', () => {
    const across: XZ[] = [[-10, 10], [30, 10]] // straight through the island
    for (const [x, z] of offLand(across, water, 3)) expect(clear([x, z])).toBe(true)
  })

  it('joins legs along the river line with points between them', () => {
    const river: XZ[] = Array.from({ length: 11 }, (_, i) => [i * 10, 0] as XZ)
    const toXZ = ([lat, lng]: [number, number]): XZ => [lng, lat]
    const out = routePoints([{ along: [[0, 80], [0, 20]] }, [5, 40]], river, toXZ)
    expect(out[0]).toEqual([80, 0])
    expect(out.at(-2)).toEqual([20, 0])
    expect(out.at(-1)).toEqual([40, 5])
  })

  it('finds a point on the pass going the way it is asked: out and back is two passes', () => {
    // Out along z = 0 heading east, back along z = 10 heading west.
    const line: XZ[] = [...Array.from({ length: 11 }, (_, i) => [i * 10, 0] as XZ), ...Array.from({ length: 11 }, (_, i) => [100 - i * 10, 10] as XZ)]
    expect(along(line, [50, 4]).s).toBeCloseTo(50)
    expect(along(line, [50, 4], 270).s).toBeGreaterThan(100) // heading west: the way back
    expect(along(line, [50, 4], 90).lateral).toBeCloseTo(4) // right of travel is +z heading east
  })

  it("names a place only on the pass going the way it's given", () => {
    const line: XZ[] = [...Array.from({ length: 101 }, (_, i) => [i * 10, 0] as XZ), ...Array.from({ length: 101 }, (_, i) => [1000 - i * 10, 40] as XZ)]
    const shapes = [{ name: 'Club', shape: [[500, 20] as XZ] }]
    expect(routePlaces(shapes, ['Club'], line, [0, 2000]).length).toBe(2)
    const back = routePlaces(shapes, [{ name: 'Club', label: 'Club', heading: 270 }], line, [0, 2000])
    expect(back.length).toBe(1)
    expect(back[0].s).toBeGreaterThan(1000)
  })
})

describe('a portage: a run over land between two stretches of water', () => {
  it('joins the water before and after with the run, and says where you land and put in', () => {
    const up: XZ[] = [[0, 0], [0, -100]] // up the river
    const down: XZ[] = [[-20, -60], [-20, 0]] // back down the other side
    const { line, portages } = joinRuns([resample(up, 5), resample(down, 5)], [[[-10, -100], [-10, -60]]])
    expect(portages).toHaveLength(1)
    const cum = cumulative(line)
    const at = (s: number) => line[cum.findIndex((c) => c >= s - 0.01)]
    // Landing where the water ends, 100 m along; putting in where the next water starts.
    expect(portages[0].from).toBeCloseTo(100, 0)
    expect(at(portages[0].from)).toEqual([0, -100])
    expect(at(portages[0].to)).toEqual([-20, -60])
    // The run goes by its points: 10 + 40 + 10 m.
    expect(portages[0].to - portages[0].from).toBeCloseTo(60, 0)
    expect(line.at(-1)![1]).toBeGreaterThan(-6)
  })
})
