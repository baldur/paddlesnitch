import { describe, it, expect } from 'vitest'
import { passes, stations, type Placed } from './passes'

// One fix a second at `speed` m/s through each waypoint in turn.
function paddle(...waypoints: number[]): Placed[] {
  const out: Placed[] = [{ t: 0, s: waypoints[0] }]
  for (let k = 1; k < waypoints.length; k++) {
    const [a, b] = [waypoints[k - 1], waypoints[k]]
    for (let d = 2; d <= Math.abs(b - a); d += 2) out.push({ t: out.length, s: a + Math.sign(b - a) * d })
  }
  return out
}

describe('passes', () => {
  it('splits an out-and-back at the turn', () => {
    const p = paddle(1000, 6000, 1000)
    const got = passes(p)
    expect(got.map((x) => [p[x.from].s, p[x.to].s, x.dir])).toEqual([[1000, 6000, 1], [6000, 1000, -1]])
  })

  it('finds three passes when the trip first goes the other way', () => {
    // Down to the bridge, up to the lock, back to the club: the 20 Aug trip's shape.
    const p = paddle(1000, 0, 6200, 1000)
    expect(passes(p).map((x) => x.dir)).toEqual([-1, 1, -1])
  })

  it('ignores milling about smaller than the turn distance', () => {
    const p = paddle(1000, 1050, 990, 1060, 3000)
    const got = passes(p)
    expect(got).toHaveLength(1)
    expect(p[got[0].to].s).toBe(3000)
  })

  it('drops a pass shorter than the minimum', () => {
    const p = paddle(0, 3000, 2850, 2700, 2900)
    expect(passes(p, 100, 400).map((x) => x.dir)).toEqual([1])
  })
})

describe('stations', () => {
  it('picks the fix nearest each step a pass covers, either direction', () => {
    const p = paddle(0, 300, 0)
    const [out, back] = passes(p, 100, 200)
    expect(stations(p, out, 100).map((x) => x.s)).toEqual([0, 100, 200, 300])
    expect(stations(p, back, 100).map((x) => p[x.i].s)).toEqual([0, 100, 200, 300])
    expect(stations(p, back, 100).every((x) => x.i >= back.from && x.i <= back.to)).toBe(true)
  })
})
