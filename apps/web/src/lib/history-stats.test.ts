import { describe, it, expect } from 'vitest'
import { computeHistoryStats, renderHistoryFacts, selectRelevantPaddles, renderRelevant, paddleHighlights } from '@paddlesnitch/analysis/history-stats'
import type { SessionSummary } from '@paddlesnitch/analysis/analysis-store'

// Minimal SessionSummary factory. cruiseSpeed in m/s; higher = faster.
function paddle(over: Partial<SessionSummary>): SessionSummary {
  return {
    id: Math.random().toString(36).slice(2), createdAt: '', paddledAt: '2026-07-01T08:00:00Z',
    source: { type: 'file' }, durationS: 1800, distanceKm: 5, avgSR: 60, cruiseSpeed: 3.0,
    effortCount: 0, avgDps: 3, note: '', insight: '', ...over,
  }
}
const NOW = new Date('2026-07-20T12:00:00Z')

describe('computeHistoryStats', () => {
  it('has no comparative facts on a first paddle', () => {
    const s = computeHistoryStats({ paddledAt: '2026-07-20T08:00:00Z', cruiseSpeed: 3, distanceKm: 5, avgSR: 60, avgDps: 3 }, [], NOW)
    expect(s.priorCount).toBe(0)
    expect(renderHistoryFacts(s)).toBe('')
    expect(s.isCruisePB).toBe(false)
  })

  it('flags a cruise PB and computes the vs-90-day delta', () => {
    const prior = [
      paddle({ paddledAt: '2026-07-05T08:00:00Z', cruiseSpeed: 2.5 }), // slower (2.5 m/s → 200s/500)
      paddle({ paddledAt: '2026-07-12T08:00:00Z', cruiseSpeed: 2.6 }),
    ]
    const s = computeHistoryStats({ paddledAt: '2026-07-20T08:00:00Z', cruiseSpeed: 3.0, distanceKm: 5, avgSR: 60, avgDps: 3 }, prior, NOW)
    expect(s.isCruisePB).toBe(true)               // faster than both priors
    expect(s.cruiseRank).toBe(1)
    expect(s.vs90dPaceDeltaSec).toBeLessThan(0)   // faster than the 90-day average
    expect(renderHistoryFacts(s)).toContain('personal best')
  })

  it('ranks a mid-pack paddle and reports slower-than-average', () => {
    const prior = [
      paddle({ paddledAt: '2026-07-05T08:00:00Z', cruiseSpeed: 3.5 }),
      paddle({ paddledAt: '2026-07-12T08:00:00Z', cruiseSpeed: 3.4 }),
    ]
    const s = computeHistoryStats({ paddledAt: '2026-07-20T08:00:00Z', cruiseSpeed: 3.0, distanceKm: 5, avgSR: 60, avgDps: 3 }, prior, NOW)
    expect(s.isCruisePB).toBe(false)
    expect(s.cruiseRank).toBe(3)                  // 2 priors faster
    expect(s.vs90dPaceDeltaSec).toBeGreaterThan(0)
  })

  it('detects a per-class PB', () => {
    const prior = [
      paddle({ paddledAt: '2026-07-05T08:00:00Z', cruiseSpeed: 2.5, boatClass: 'K1' }),
      paddle({ paddledAt: '2026-07-06T08:00:00Z', cruiseSpeed: 4.0, boatClass: '8+' }), // faster but different class
    ]
    const s = computeHistoryStats({ paddledAt: '2026-07-20T08:00:00Z', cruiseSpeed: 3.0, distanceKm: 5, avgSR: 60, avgDps: 3, boatClass: 'K1' }, prior, NOW)
    expect(s.isClassPB).toBe(true)
    expect(renderHistoryFacts(s)).toContain('boat class')
  })

  it('counts volume + this-week sessions + days since last', () => {
    const prior = [
      paddle({ paddledAt: '2026-07-18T08:00:00Z', distanceKm: 6 }),  // within 7d of NOW
      paddle({ paddledAt: '2026-06-01T08:00:00Z', distanceKm: 100 }), // old
    ]
    const s = computeHistoryStats({ paddledAt: '2026-07-19T08:00:00Z', cruiseSpeed: 3, distanceKm: 5, avgSR: 60, avgDps: 3 }, prior, NOW)
    expect(s.sessionsThisWeek).toBe(2)          // 18th + the new 19th
    expect(s.distanceThisWeekKm).toBeCloseTo(11, 5)
    expect(s.daysSinceLast).toBe(1)             // last prior was the 18th, current the 19th
  })

  it('reports a distance milestone crossing', () => {
    const prior = [paddle({ distanceKm: 48 })]  // cumulative 48
    const s = computeHistoryStats({ paddledAt: '2026-07-20T08:00:00Z', cruiseSpeed: 3, distanceKm: 5, avgSR: 60, avgDps: 3 }, prior, NOW)
    expect(s.crossedMilestoneKm).toBe(50)       // 48 → 53 crosses 50
  })
})

describe('selectRelevantPaddles', () => {
  const here = { lat: 51.5, lng: -1.0 }
  const current = { paddledAt: '2026-07-20T08:00:00Z', cruiseSpeed: 3, distanceKm: 5, avgSR: 60, avgDps: 3, boatClass: 'K1' as const, startLat: here.lat, startLng: here.lng }

  it('ranks same-venue + same-class + similar-distance highest', () => {
    const prior = [
      paddle({ id: 'far', startLat: 52.0, startLng: -2.0, boatClass: '8+', distanceKm: 20 }),      // nothing in common
      paddle({ id: 'here', startLat: 51.5001, startLng: -1.0001, boatClass: 'K1', distanceKm: 5 }), // everything
      paddle({ id: 'class', startLat: 52.0, startLng: -2.0, boatClass: 'K1', distanceKm: 5 }),       // class + distance
    ]
    const rel = selectRelevantPaddles(current, prior)
    expect(rel[0].summary.id).toBe('here')
    expect(rel.map(r => r.summary.id)).not.toContain('far')
    expect(rel[0].reason).toContain('same spot')
    expect(renderRelevant(rel)).toContain('comparable past paddles')
  })

  // A lower time per 500 m is faster; the model read "3:15 vs 3:25" backwards
  // (2026-11-01), so the line says which way it went.
  it('says whether this paddle was faster or slower than each past one', () => {
    const past = (id: string, cruiseSpeed: number) => ({ summary: paddle({ id, cruiseSpeed }), reason: 'same spot' })
    const out = renderRelevant([past('slow', 500 / 205), past('quick', 500 / 185), past('same', 500 / 195)], { cruiseSpeed: 500 / 195 })
    expect(out).toContain('cruise 3:25/500')
    expect(out).toMatch(/3:25\/500.*this paddle 10s\/500 faster/)
    expect(out).toMatch(/3:05\/500.*this paddle 10s\/500 slower/)
    expect(out).toContain('this paddle the same cruise pace')
    expect(renderRelevant([past('slow', 500 / 205)])).not.toContain('this paddle')
  })

  it('works the gap out from the paces as printed, and leaves it out when either has no pace', () => {
    const past = (id: string, cruiseSpeed: number, over = {}) => ({ summary: paddle({ id, cruiseSpeed, ...over }), reason: 'same spot' })
    // 3:25.4 is printed 3:25 and 3:15.6 is printed 3:16: the line must say 9, not 10.
    expect(renderRelevant([past('p', 500 / 205.4)], { cruiseSpeed: 500 / 195.6 })).toMatch(/3:25\/500.*this paddle 9s\/500 faster/)
    expect(renderRelevant([past('p', 500 / 205)], { cruiseSpeed: 0 })).not.toContain('this paddle')
    expect(renderRelevant([past('m', 0, { distanceKm: 0, noGps: true })], { cruiseSpeed: 3 })).not.toContain('this paddle')
  })

  it('writes a gap of a minute or more as a pace, not hundreds of seconds', () => {
    const past = (id: string, cruiseSpeed: number) => ({ summary: paddle({ id, cruiseSpeed }), reason: 'same spot' })
    expect(renderRelevant([past('p', 500 / 500)], { cruiseSpeed: 500 / 175 })).toContain('this paddle 5:25/500 faster')
  })

  it('returns nothing when no paddle is relevant', () => {
    const prior = [paddle({ startLat: 40, startLng: 40, boatClass: '8+', distanceKm: 40 })]
    expect(selectRelevantPaddles(current, prior)).toEqual([])
    expect(renderRelevant([])).toBe('')
  })
})

// Badges on the paddle page, measured against the paddles before it.
describe('paddleHighlights', () => {
  const now = (over: Partial<Parameters<typeof paddleHighlights>[0]> = {}) =>
    ({ paddledAt: '2026-07-20T08:00:00Z', cruiseSpeed: 3.0, distanceKm: 8, avgSR: 60, avgDps: 3, ...over })

  it('says nothing until there are two paddles to compare with', () => {
    expect(paddleHighlights(now(), [paddle({ paddledAt: '2026-07-10T08:00:00Z' })])).toEqual([])
  })

  it('names a cruise record, a longest paddle and the pace against the 90-day average', () => {
    const prior = [paddle({ paddledAt: '2026-07-05T08:00:00Z', cruiseSpeed: 2.5 }), paddle({ paddledAt: '2026-07-12T08:00:00Z', cruiseSpeed: 2.6 })]
    const h = paddleHighlights(now(), prior)
    expect(h).toContain('Fastest cruise yet')
    expect(h).toContain('Longest paddle yet')
    expect(h.some(x => /s\/500 faster than your 90-day average/.test(x))).toBe(true)
  })

  it('is a record for its boat class when the class is set', () => {
    const prior = [paddle({ paddledAt: '2026-07-05T08:00:00Z', cruiseSpeed: 2.5, boatClass: 'K1' }), paddle({ paddledAt: '2026-07-12T08:00:00Z', cruiseSpeed: 3.5 })]
    expect(paddleHighlights(now({ boatClass: 'K1' }), prior)[0]).toBe('Fastest in a K1 yet')
  })

  it('only compares with paddles before it, so an old record stays a record', () => {
    const prior = [
      paddle({ paddledAt: '2026-07-05T08:00:00Z', cruiseSpeed: 2.5 }), paddle({ paddledAt: '2026-07-12T08:00:00Z', cruiseSpeed: 2.6 }),
      paddle({ paddledAt: '2026-08-01T08:00:00Z', cruiseSpeed: 4.0, distanceKm: 20 }),   // later and faster
    ]
    expect(paddleHighlights(now(), prior)).toContain('Fastest cruise yet')
  })

  it('notes a return after a break', () => {
    const prior = [paddle({ paddledAt: '2026-06-01T08:00:00Z', cruiseSpeed: 3.5, distanceKm: 20 }), paddle({ paddledAt: '2026-06-20T08:00:00Z', cruiseSpeed: 3.5, distanceKm: 20 })]
    expect(paddleHighlights(now(), prior)).toContain('First paddle in 30 days')
  })
})
