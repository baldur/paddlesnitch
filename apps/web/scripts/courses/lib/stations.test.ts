import { describe, it, expect } from 'vitest'
import { bearing, destination, haversine, stationsAt, travelled, type Fix } from './stations'

// A straight run due east at 2 m/s, a fix a second, from a point on the Thames.
const ORIGIN = { lat: 51.4676, lng: -0.9822 }
const east = (seconds: number, from = 0): Fix[] => Array.from({ length: seconds + 1 }, (_, k) => {
  const p = destination(ORIGIN, 90, 2 * (from + k))
  return { ft: from + k, lat: p.lat, lng: p.lng, speed: 2 }
})

describe('geometry helpers', () => {
  it('destination and haversine agree, and bearing points the way it went', () => {
    const p = destination(ORIGIN, 45, 1000)
    expect(haversine(ORIGIN, p)).toBeCloseTo(1000, 3)
    expect(bearing(ORIGIN, p)).toBeCloseTo(45, 1)
  })
})

describe('travelled', () => {
  it('does not count GPS scatter while the boat sits still', () => {
    // 10 minutes bobbing within a metre of one spot.
    const still: Fix[] = Array.from({ length: 600 }, (_, k) => ({ ft: k, lat: ORIGIN.lat + Math.sin(k) * 0.000008, lng: ORIGIN.lng + Math.cos(k) * 0.000012, speed: 0.1 }))
    expect(travelled(still).at(-1)).toBe(0)
  })
  it('counts a real run', () => {
    expect(travelled(east(500)).at(-1)).toBeCloseTo(1000, -1)
  })
})

describe('stationsAt', () => {
  const fixes = east(500) // 1000 m
  const cum = travelled(fixes)

  it('level 0 is every base metres, starting at the start', () => {
    const s = stationsAt(fixes, cum, 100, 0)
    expect(s.map((x) => x.n)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(s[3].ft).toBeCloseTo(150, -1)
    expect(s[3].heading).toBeCloseTo(90, 0)
  })

  it('each finer level only adds the points between the coarser ones', () => {
    const l0 = stationsAt(fixes, cum, 100, 0).map((s) => s.n * 100)
    const l1 = stationsAt(fixes, cum, 100, 1).map((s) => s.n * 50)
    const l2 = stationsAt(fixes, cum, 100, 2).map((s) => s.n * 25)
    expect(l1).toEqual([50, 150, 250, 350, 450, 550, 650, 750, 850, 950])
    const all = [...l0, ...l1, ...l2]
    expect(new Set(all).size).toBe(all.length)
    expect(all.sort((a, b) => a - b)).toEqual(Array.from({ length: 41 }, (_, k) => k * 25))
  })

  it('gives nothing for a clip without a usable track', () => {
    expect(stationsAt([], [], 100, 0)).toEqual([])
  })
})
