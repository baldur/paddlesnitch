import { describe, it, expect } from 'vitest'
import { sourceLabel, weekStart, weeklyKm, weekStreak, monthKm, groupSameOuting, paddlingSummary } from '@paddlesnitch/core/paddles'

describe('sourceLabel', () => {
  it.each([
    ['strava', ' · STRAVA'],
    ['trial', ' · TIME TRIAL'],
    ['device', ' · TRACKER'],
    ['file', ''],
    [undefined, ''],
  ])('%s → %j', (type, expected) => {
    expect(sourceLabel(type)).toBe(expected)
  })
})

// The logbook on /paddles.
describe('logbook', () => {
  const p = (at: string, km = 5, durationS = 3600, type = 'file') => ({ paddledAt: at, distanceKm: km, durationS, source: { type } })
  const NOW = new Date('2026-10-07T12:00:00Z')   // a Wednesday

  it('counts weeks from Monday', () => {
    expect(weekStart(new Date('2026-10-07T12:00:00Z')).toISOString()).toBe('2026-10-05T00:00:00.000Z')
    expect(weekStart(new Date('2026-10-05T00:30:00Z')).toISOString()).toBe('2026-10-05T00:00:00.000Z')
    expect(weekStart(new Date('2026-10-04T23:30:00Z')).toISOString()).toBe('2026-09-28T00:00:00.000Z')
  })

  it('adds up kilometres per week, this week last', () => {
    const w = weeklyKm([p('2026-10-06T08:00:00Z', 4), p('2026-10-01T08:00:00Z', 6), p('2026-09-30T08:00:00Z', 2.5), p('2025-01-01T08:00:00Z', 99)], NOW, 4)
    expect(w.map(x => x.km)).toEqual([0, 0, 8.5, 4])
    expect(w[3].week).toBe('2026-10-05')
  })

  it('counts a streak of weeks, not broken before the first paddle of this week', () => {
    expect(weekStreak([p('2026-10-01T08:00:00Z'), p('2026-09-24T08:00:00Z'), p('2026-09-03T08:00:00Z')], NOW)).toBe(2)
    expect(weekStreak([p('2026-10-06T08:00:00Z'), p('2026-10-01T08:00:00Z')], NOW)).toBe(2)
    expect(weekStreak([p('2026-09-03T08:00:00Z')], NOW)).toBe(0)
  })

  it('compares this month with last', () => {
    expect(monthKm([p('2026-10-02T08:00:00Z', 3), p('2026-09-30T08:00:00Z', 7), p('2026-08-30T08:00:00Z', 1)], NOW)).toEqual({ thisMonth: 3, lastMonth: 7 })
  })

  it('shows one outing recorded twice once, led by the tracker', () => {
    const strava = { ...p('2026-10-06T09:01:00Z', 8.1, 3500, 'strava'), id: 's' }
    const tracker = { ...p('2026-10-06T09:00:00Z', 8, 3600, 'device'), id: 't' }
    const other = { ...p('2026-10-01T09:00:00Z', 5, 3600, 'file'), id: 'o' }
    const g = groupSameOuting([strava, tracker, other])
    expect(g.map(x => [x.lead.id, x.others.map(o => o.id)])).toEqual([['t', ['s']], ['o', []]])
  })
})

describe('paddlingSummary (your own profile)', () => {
  const q = (id: string, at: string, km: number, speed: number) => ({ id, paddledAt: at, distanceKm: km, durationS: 3600, cruiseSpeed: speed })
  it('picks this year, the longest and the fastest cruise, with links', () => {
    const s = paddlingSummary([q('a', '2026-03-01T08:00:00Z', 12, 2.8), q('b', '2026-10-01T08:00:00Z', 6, 3.4), q('c', '2025-12-30T08:00:00Z', 20, 3.0)], new Date('2026-10-07T12:00:00Z'))
    expect(s.thisYearKm).toBe(18)
    expect(s.longest?.id).toBe('c')
    expect(s.fastest?.id).toBe('b')
    expect(s.count).toBe(3)
  })
})
