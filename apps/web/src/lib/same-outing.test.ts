import { describe, it, expect } from 'vitest'
import { timeOverlapShare, trackGap, isSameOuting, strokeRateSideBySide, outingPlaces } from '@paddlesnitch/analysis/same-outing'
import { decodePlaces } from '@paddlesnitch/core/paddles'

// One boat heading north at 2.2 m/s from 09:00, recorded from `at` for
// `seconds`, one point a second: where it is depends on the clock, not on when
// the device started.
function paddle(at: string, seconds: number, opts: { offsetM?: number; sr?: number | null; lng?: number } = {}) {
  const { offsetM = 0, sr = null, lng = -0.93 } = opts
  const since = (Date.parse(at) - Date.parse('2026-10-06T09:00:00Z')) / 1000
  const points = Array.from({ length: seconds }, (_, t) => ({
    t, lat: 51.46 + ((since + t) * 2.2 + offsetM) / 111_000, lng, speed: 2.2, sr, dps: null,
  }))
  return { paddledAt: at, result: { durationS: seconds - 1, points } }
}

describe('the same outing from two sources', () => {
  it('measures how much of the shorter paddle the other covers in time', () => {
    const a = { paddledAt: '2026-10-06T09:00:00Z', durationS: 600 }
    expect(timeOverlapShare(a, { paddledAt: '2026-10-06T09:05:00Z', durationS: 600 })).toBeCloseTo(0.5)
    expect(timeOverlapShare(a, { paddledAt: '2026-10-06T08:00:00Z', durationS: 600 })).toBe(0)
  })

  it('reads two devices on one boat as the same outing, and says how far apart they were', () => {
    const tracker = paddle('2026-10-06T09:00:00Z', 1200)
    const watch = paddle('2026-10-06T09:01:00Z', 1100, { offsetM: 8 })    // started later, reads 8 m ahead
    expect(isSameOuting(tracker, watch)).toBe(true)
    const g = trackGap(tracker, watch)!
    expect(Math.abs(g.medianM - 8)).toBeLessThanOrEqual(1)            // positions kept to ~1 m
    expect(g.agreement).toBe(1)
  })

  it('does not match the same route paddled at another time', () => {
    expect(isSameOuting(paddle('2026-10-06T09:00:00Z', 1200), paddle('2026-10-07T09:00:00Z', 1200))).toBe(false)
  })

  it('does not match two people out at the same time somewhere else', () => {
    expect(isSameOuting(paddle('2026-10-06T09:00:00Z', 1200), paddle('2026-10-06T09:00:00Z', 1200, { lng: -0.9 }))).toBe(false)
  })

  // #852: the list decides from summaries, the page and Compare from full
  // paddles; all three read the same places.
  it('keeps where the paddle was every 20 s of clock time', () => {
    const watch = paddle('2026-10-06T09:00:30Z', 300)
    const pl = outingPlaces(watch)
    expect(pl.from).toBe(Date.parse('2026-10-06T09:00:40Z') / 1000)
    const pts = decodePlaces(pl)
    expect(pts).toHaveLength(15)                                         // 09:00:40 to 09:05:20 (it ends at 09:05:29)
    expect(pts[1]![0]).toBeCloseTo(51.46 + 60 * 2.2 / 111_000, 5)      // where the boat was at 09:01
  })

  it('leaves out an instant inside a gap of more than 30 s, rather than cutting the corner', () => {
    // North for a minute at 5 m/s, then east; this recording lost 09:00:40 to 09:01:20.
    const at = '2026-10-06T09:00:00Z'
    const pos = (t: number) => t <= 60 ? { lat: 51.46 + t * 5 / 110_540, lng: -0.93 } : { lat: 51.46 + 300 / 110_540, lng: -0.93 + (t - 60) * 5 / 69_400 }
    const points = Array.from({ length: 120 }, (_, t) => t).filter(t => t <= 40 || t >= 80).map(t => ({ t, ...pos(t), speed: 5, sr: null, dps: null }))
    const pts = decodePlaces(outingPlaces({ paddledAt: at, result: { durationS: 119, points } }))
    expect(pts.map(p => p !== null)).toEqual([true, true, true, false, true, true])   // 09:00:00, :20, :40, (:60 none), 09:01:20, :40
  })

  // Review of #891: at one sample a minute, a short piece never grouped, and
  // one bad first fix split a 3 to 6 minute one.
  it('reads a 3 minute and a 2 minute piece as one outing despite a bad first fix', () => {
    for (const seconds of [180, 120]) {
      const tracker = paddle('2026-10-06T09:00:00Z', seconds + 20)
      const phone = paddle('2026-10-06T09:00:13Z', seconds)
      for (const p of phone.result.points.slice(0, 10)) p.lat += 200 / 111_000            // cold start: 200 m off for 10 s
      expect(isSameOuting(tracker, phone)).toBe(true)
      expect(trackGap(tracker, phone)!.agreement).toBeLessThan(1)                          // the bad fix was sampled
    }
  })

  // Review of #891: Compare said "same outing" from places but showed the gap
  // from other samples. Now the gap is the rule's own samples.
  it('says how far apart from the very samples it judges by', () => {
    const tracker = paddle('2026-10-06T09:00:00Z', 1200)
    for (const offsetM of [8, 35, 45, 300]) {
      const other = paddle('2026-10-06T09:01:00Z', 1100, { offsetM })
      const g = trackGap(tracker, other)!
      expect(isSameOuting(tracker, other)).toBe(g.agreement >= 0.7)
    }
  })
  it('lines up stroke rate from each by clock minute', () => {
    const tracker = paddle('2026-10-06T09:00:00Z', 180, { sr: 56 })
    const watch = paddle('2026-10-06T09:01:00Z', 180, { sr: 28 })        // a watch counting one side
    expect(strokeRateSideBySide(tracker, watch)).toEqual([{ minute: 1, a: 56, b: 28 }, { minute: 2, a: 56, b: 28 }])
  })
})
