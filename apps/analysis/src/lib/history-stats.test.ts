import { describe, it, expect } from 'vitest'
import { computeHistoryStats, renderHistoryFacts, selectRelevantPaddles, renderRelevant } from './history-stats'
import type { SessionSummary } from './analysis-store'

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

  it('returns nothing when no paddle is relevant', () => {
    const prior = [paddle({ startLat: 40, startLng: 40, boatClass: '8+', distanceKm: 40 })]
    expect(selectRelevantPaddles(current, prior)).toEqual([])
    expect(renderRelevant([])).toBe('')
  })
})
