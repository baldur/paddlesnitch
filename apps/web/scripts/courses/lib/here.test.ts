import { describe, it, expect } from 'vitest'
import { HERE_DIRS, HERE_VIEW, lensYaw, oneAcrossChapters, passesNear, tenths } from './here'
import { destination, haversine } from './stations'

const P = { lat: 51.4676, lng: -0.9822 }
/** A fix a second, `metres` a second along compass `deg` from `from`, starting at `t0`. */
const leg = (from: { lat: number; lng: number }, deg: number, n: number, metres: number, t0: number) =>
  Array.from({ length: n }, (_, k) => { const q = destination(from, deg, k * metres); return [t0 + k, q.lat, q.lng, metres] })

describe('passesNear', () => {
  it('finds one pass going past, at its closest fix', () => {
    // East along a line 5 m north of the point, from 100 m west to 100 m east.
    const track = leg(destination(destination(P, 0, 5), 270, 100), 90, 101, 2, 0)
    const passes = passesNear(track, P, 20)
    expect(passes).toHaveLength(1)
    expect(passes[0].metres).toBeCloseTo(5, 0)
    expect(passes[0].ft).toBe(50)
  })
  it('counts there and back on one paddle as two passes', () => {
    const start = destination(P, 270, 100)
    const out = leg(start, 90, 101, 2, 0)
    const back = leg(destination(start, 90, 200), 270, 101, 2, 101)
    expect(passesNear([...out, ...back], P, 20).map((p) => p.ft)).toEqual([50, 151])
  })
  it('splits a pass where the camera was off for a while, but not for a short gap', () => {
    const a = [[0, P.lat, P.lng, 0], [10, P.lat, P.lng, 0]]
    expect(passesNear([...a, [25, P.lat, P.lng, 0]], P, 10)).toHaveLength(1)
    expect(passesNear([...a, [100, P.lat, P.lng, 0]], P, 10)).toHaveLength(2)
  })
  it('finds nothing when the track never comes that close', () => {
    expect(passesNear(leg(destination(P, 0, 50), 90, 50, 2, 0), P, 30)).toEqual([])
  })
  it('keeps every pass within the radius', () => {
    const track = leg(destination(P, 270, 100), 90, 101, 2, 0)
    for (const p of passesNear(track, P, 10)) expect(haversine(p, P)).toBeLessThanOrEqual(10)
  })
})

describe('oneAcrossChapters', () => {
  it("keeps one of a pass found at a chapter's end and the next one's start: the closer", () => {
    const end = { recording: 'r1', t: 1_000_000, metres: 9, ch: 1 }, start = { recording: 'r1', t: 1_001_000, metres: 2, ch: 2 }
    expect(oneAcrossChapters([end, start])).toEqual([start])
  })
  it('keeps passes of other recordings, or the same one minutes apart', () => {
    const a = { recording: 'r1', t: 0, metres: 3 }
    expect(oneAcrossChapters([a, { recording: 'r2', t: 0, metres: 1 }, { recording: 'r1', t: 600_000, metres: 2 }])).toHaveLength(3)
  })
})

describe('the pictures', () => {
  it('turns a view from the bow into the lens angle for the way the camera faces', () => {
    // Mounted looking back (180): ahead of the boat is the lens's 180, left is its 90.
    expect(Object.fromEntries(HERE_DIRS.map((d) => [d.name, lensYaw(d.fromBow, 180)]))).toEqual({ left: 90, ahead: 180, right: 270, behind: 0 })
    expect(lensYaw(0, 0)).toBe(0)
  })
  it('are about as sharp as the camera: 90° views near its 15 px a degree', () => {
    expect(HERE_VIEW.w / HERE_VIEW.hFov).toBeGreaterThan(15)
    expect(HERE_VIEW.w / HERE_VIEW.hFov).toBeLessThan(20)
    expect(HERE_VIEW.vFov / HERE_VIEW.hFov).toBeCloseTo(0.69, 1)
  })
  it('address a moment in whole tenths of a second, never below zero', () => {
    expect(tenths(12.34)).toBe(123)
    expect(tenths(-1)).toBe(0)
  })
})
