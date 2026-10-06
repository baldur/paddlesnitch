import { describe, it, expect } from 'vitest'
import { timeOverlapShare, trackGap, isSameOuting, strokeRateSideBySide } from '@paddlesnitch/analysis/same-outing'

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
    expect(g.medianM).toBe(8)
    expect(g.agreement).toBe(1)
  })

  it('does not match the same route paddled at another time', () => {
    expect(isSameOuting(paddle('2026-10-06T09:00:00Z', 1200), paddle('2026-10-07T09:00:00Z', 1200))).toBe(false)
  })

  it('does not match two people out at the same time somewhere else', () => {
    expect(isSameOuting(paddle('2026-10-06T09:00:00Z', 1200), paddle('2026-10-06T09:00:00Z', 1200, { lng: -0.9 }))).toBe(false)
  })

  it('lines up stroke rate from each by clock minute', () => {
    const tracker = paddle('2026-10-06T09:00:00Z', 180, { sr: 56 })
    const watch = paddle('2026-10-06T09:01:00Z', 180, { sr: 28 })        // a watch counting one side
    expect(strokeRateSideBySide(tracker, watch)).toEqual([{ minute: 1, a: 56, b: 28 }, { minute: 2, a: 56, b: 28 }])
  })
})
