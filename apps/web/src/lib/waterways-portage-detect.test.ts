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

  // Measured on the Kennet, 8 Nov 2026: a carry done at a jog, a stop either side of the lock.
  it('a carry walked slowly keeps its take-out before the lock, not at it', () => {
    const [s] = portagesFromTrack(track([[1440, 0, 2.5], [130, 15, 0.7], [1500, 0, 2.5]]), [lock])
    expect(s.landings[0][1]).toBeLessThan(-40 * M)
    expect(s.carryM).toBeGreaterThan(110)
  })

  describe('a carry that is run, not walked', () => {
    const STOP: [number, number, number] = [2, 15, 0.1]            // 20 s at the bank
    const IN: [number, number, number] = [1440, 0, 2.8], OUT: [number, number, number] = [1500, 0, 2.8]
    const carry = track([IN, STOP, [120, 15, 2.4], STOP, OUT])

    it('finds it: stopped, past the lock at 2.4 m/s, stopped', () => {
      const [s] = portagesFromTrack(carry, [lock])
      expect(s.featureId).toBe('ea-lock:test')
      expect(s.carryM).toBeGreaterThan(100)
    })

    it('takes the last stop before paddling again as the put-in, when the carry paused after the lock', () => {
      const pts = track([IN, STOP, [90, 15, 2.4], [2, 15, 0.2], [60, 15, 2.2], STOP, OUT])
      expect(portagesFromTrack(pts, [lock])[0].landings[1][1]).toBeGreaterThan(pts.filter(p => p.speed === 0.2).at(-1)!.lng)
    })

    it('a brief slowing well before the lock is not the take-out', () => {
      const pts = track([[1400, 0, 2.8], [1, 0, 0.3], [30, 0, 2.8], STOP, [120, 15, 2.4], STOP, OUT])
      const stopAt = pts.filter(p => p.lat > 51.5 && p.speed === 0.1)[0]
      expect(portagesFromTrack(pts, [lock])[0].landings[0][1]).toBeCloseTo(stopAt.lng, 3)
    })

    it('a slow paddler\'s put-in is the end of the carry, not their next rest', () => {
      const pts = track([[1440, 0, 1.5], STOP, [120, 15, 2.4], STOP, [120, 0, 1.5], STOP, [1400, 0, 1.5]])
      expect(portagesFromTrack(pts, [lock])[0].carryM).toBeLessThan(160)
    })

    it('one bad speed reading in a dense track isn\'t a stop', () => {
      const dense: TrackPoint[] = Array.from({ length: 1200 }, (_, i) => ({ t: i, lat: 51.5 + 15 / 111_000, lng: (i - 600) * 2.8 * M, speed: i === 570 || i === 640 ? 0.1 : 2.8 }))
      expect(portagesFromTrack(dense, [lock])).toEqual([])
    })

    it('still finds it at the spacing of a saved paddle, a point every 10 s', () => {
      expect(portagesFromTrack(carry.filter((_, i) => i % 2 === 0), [lock])).toHaveLength(1)
    })

    it('one stopped point counts at that spacing, where a short stop is all there is', () => {
      const pts = track([IN, [0.5, 15, 0.1], [120, 15, 2.4], STOP, OUT]).filter((_, i, all) => i % 2 === 0 || all[i].speed === 0.1)
      expect(pts.filter(p => p.speed === 0.1).length).toBeGreaterThan(1)
      expect(portagesFromTrack(pts, [lock])).toHaveLength(1)
    })

    it('is not a carry when you paddle straight through (Ufton has no gates)', () => {
      expect(portagesFromTrack(track([[3000, 0, 2.8]]), [lock])).toEqual([])
    })

    it('is not a carry when you stop on one side and paddle on past the lock', () => {
      expect(portagesFromTrack(track([IN, STOP, [120, 15, 2.8], OUT]), [lock])).toEqual([])
    })

    it('says when you got out', () => {
      const [s] = portagesFromTrack(carry, [lock])
      expect(carry.find(p => p.t === s.t)?.speed).toBe(0.1)
    })
  })
})
