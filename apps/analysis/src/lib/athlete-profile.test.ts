import { describe, it, expect } from 'vitest'
import { deterministicProfile, refreshAthleteProfile } from './athlete-profile'
import type { SessionSummary } from './analysis-store'

function paddle(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: Math.random().toString(36).slice(2), createdAt: '', paddledAt: '2026-07-01T08:00:00Z',
    source: { type: 'file' }, durationS: 1800, distanceKm: 5, avgSR: 60, cruiseSpeed: 3,
    effortCount: 0, avgDps: 3, note: '', insight: '', ...over,
  }
}

describe('deterministicProfile', () => {
  it('is empty below the cold-start threshold', () => {
    expect(deterministicProfile([paddle(), paddle()])).toBe('')
  })

  it('summarises count, boat classes and note-keeping from ≥3 paddles', () => {
    const p = deterministicProfile([
      paddle({ distanceKm: 5, boatClass: 'K1', note: 'felt good' }),
      paddle({ distanceKm: 7, boatClass: 'K1' }),
      paddle({ distanceKm: 6, boatClass: '2X', note: 'tired' }),
    ])
    expect(p).toContain('3 logged paddles')
    expect(p).toContain('K1')
    expect(p).toContain('2X')
    expect(p).toContain('diary')          // 2 sessions carried notes
  })
})

describe('refreshAthleteProfile', () => {
  it('skips (returns null) during cold start — no storage/LLM touched', async () => {
    const two = [paddle(), paddle()]
    expect(await refreshAthleteProfile('u1', two[0], two, '2026-07-20T12:00:00Z')).toBeNull()
  })
})
