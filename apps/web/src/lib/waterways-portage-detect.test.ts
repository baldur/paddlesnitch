// Portages from a paddler's own track (packages/waterways/src/portage-detect.ts):
// the slow stretch beside a lock is the carry; its ends are the landings.
import { describe, expect, it } from 'vitest'
import { portagesFromTrack, type TrackPoint } from '@paddlesnitch/waterways/portage-detect'
import type { Feature } from '@paddlesnitch/waterways/types'

// Heading east along latitude 51.5; a degree of longitude here is ~69.4 km.
const M = 1 / 69_400
const lock: Feature = { id: 'ea-lock:test', kind: 'lock', name: 'Test Lock', at: [51.5, 0], source: { source: 'ea-thames-locks', fetchedAt: '' } }

/** A track from legs of [metres east, metres north offset, speed m/s], a point every 5 s. */
function track(legs: [number, number, number][]): TrackPoint[] {
  const out: TrackPoint[] = []
  let x = -1500, t = 0
  for (const [dist, north, speed] of legs) {
    for (let d = 0; d < dist; d += speed * 5) { out.push({ t, lat: 51.5 + north / 111_000, lng: (x + d) * M, speed }); t += 5 }
    x += dist
  }
  return out
}

describe('portages from your own paddles', () => {
  it('finds the carry round a lock: out before it, back in after, on the bank', () => {
    // Paddle to 60 m short of the lock, carry 130 m along the north bank, paddle on.
    const [s] = portagesFromTrack(track([[1440, 0, 2.5], [130, 15, 0.9], [1500, 0, 2.5]]), [lock])
    expect(s).toMatchObject({ featureId: 'ea-lock:test', name: 'Test Lock', at: [51.5, 0] })
    expect(s.landings[0][1] / M).toBeCloseTo(-60, -1)    // got out ~60 m before
    expect(s.landings[1][1] / M).toBeCloseTo(70, -1)     // back in ~70 m after
    expect(s.carryM).toBeGreaterThan(100)
    expect(s.carryM).toBeLessThan(160)
    expect(s.minutes).toBe(2)
  })

  it('nothing when you paddle straight past (a lock you went through afloat, or a weir stream)', () => {
    expect(portagesFromTrack(track([[3000, 0, 2.5]]), [lock])).toEqual([])
  })

  it("nothing for a rest 400 m short of the lock, or for a lock you didn't pass", () => {
    expect(portagesFromTrack(track([[1100, 0, 2.5], [60, 0, 0.3], [1840, 0, 2.5]]), [lock])).toEqual([])
    expect(portagesFromTrack(track([[3000, 200, 2.5]]), [lock])).toEqual([])
  })

  it('a short burst of speed in the middle of the carry (a trolley down a ramp) does not end it', () => {
    const [s] = portagesFromTrack(track([[1440, 0, 2.5], [60, 15, 0.9], [20, 15, 2.2], [60, 15, 0.9], [1500, 0, 2.5]]), [lock])
    expect(s.carryM).toBeGreaterThan(120)
  })
})
