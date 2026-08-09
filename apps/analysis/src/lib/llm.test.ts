import { describe, it, expect } from 'vitest'
import { withTimeout, buildPrompt, describePaddleDate, normaliseSport } from './llm'
import type { AnalysisResult } from './analysis'

// Guards the "analysis failed, but works on retry" symptom (#171): a slow/hanging
// LLM backend must not stall the analyse request — it resolves to null so the
// deterministic template stands in, rather than blowing the platform timeout.
describe('withTimeout', () => {
  it('resolves the value when the promise settles before the timeout', async () => {
    await expect(withTimeout(Promise.resolve('insight'), 1000)).resolves.toBe('insight')
  })

  it('resolves null when the promise takes longer than the timeout', async () => {
    const slow = new Promise<string>(resolve => setTimeout(() => resolve('too late'), 50))
    await expect(withTimeout(slow, 5)).resolves.toBeNull()
  })

  it('resolves null when the underlying call rejects', async () => {
    await expect(withTimeout(Promise.reject(new Error('bedrock throttled')), 1000)).resolves.toBeNull()
  })
})

// A minimal 80-minute session — just the fields buildPrompt reads.
function result(): AnalysisResult {
  return {
    durationS: 4800, distanceKm: 12.5,
    avgSpeed: 2.6, avgSR: 60, avgDps: 2.6,
    cruiseSpeed: 2.6, strokeRateDoubled: false,
    points: [], stops: [], surges: [], sets: [],
    insight: '',
  }
}

describe('buildPrompt', () => {
  it('frames the session duration in hours + minutes, not raw minutes (issue #170)', () => {
    const p = buildPrompt(result())
    expect(p).toContain('Session: 1 hour 20 minutes,')
    expect(p).not.toContain('80:00 min')
    expect(p).not.toContain('80 minutes')
  })

  it('includes the paddle date so the model does not assume an import is today', () => {
    const p = buildPrompt(result(), { paddledAt: '2025-05-12T08:00:00Z', asOf: '2026-08-09T12:00:00Z' })
    expect(p).toContain('Session date:')
    expect(p).toContain('12 May 2025')
    expect(p).toMatch(/year/) // relative age (~1 year ago)
  })

  it('omits the date line when no paddledAt is given', () => {
    expect(buildPrompt(result())).not.toContain('Session date:')
  })

  it('surfaces distance-per-stroke efficiency + overall consistency for the coach to value', () => {
    const p = buildPrompt({ ...result(), srCv: 8 })
    expect(p).toContain('distance per stroke — efficiency')
    expect(p).toContain('Stroke-rate consistency')
    expect(p).toContain('8% variation')
  })

  it('steers rowing vocabulary (and away from paddle terms)', () => {
    const p = buildPrompt(result(), { sport: 'Rowing' })
    expect(p).toContain('Sport: ROWING')
    expect(p).toMatch(/rating/)
  })

  it('steers kayak vocabulary', () => {
    expect(buildPrompt(result(), { sport: 'Kayaking' })).toContain('Sport: KAYAKING')
  })

  it('omits the sport line when the sport is unknown', () => {
    expect(buildPrompt(result(), { sport: 'Ride' })).not.toContain('Sport:')
    expect(buildPrompt(result())).not.toContain('Sport:')
  })
})

describe('normaliseSport', () => {
  it('maps Strava sport types to coaching buckets (rowing split from paddle sports)', () => {
    expect(normaliseSport('Rowing')).toBe('rowing')
    expect(normaliseSport('VirtualRow')).toBe('rowing')
    expect(normaliseSport('Kayaking')).toBe('kayak')
    expect(normaliseSport('Canoeing')).toBe('canoe')
    expect(normaliseSport('StandUpPaddling')).toBe('sup')
    expect(normaliseSport('Ride')).toBeUndefined()
    expect(normaliseSport(undefined)).toBeUndefined()
  })
})

describe('describePaddleDate', () => {
  const asOf = '2026-08-09T12:00:00Z'
  it('says today / yesterday / days / months / years appropriately', () => {
    expect(describePaddleDate('2026-08-09T06:00:00Z', asOf)).toContain('today')
    expect(describePaddleDate('2026-08-08T06:00:00Z', asOf)).toContain('yesterday')
    expect(describePaddleDate('2026-08-04T06:00:00Z', asOf)).toContain('5 days ago')
    expect(describePaddleDate('2026-05-01T06:00:00Z', asOf)).toMatch(/months ago/)
    expect(describePaddleDate('2024-08-01T06:00:00Z', asOf)).toMatch(/years ago/)
  })
  it('returns empty for an unparseable date', () => {
    expect(describePaddleDate('not-a-date', asOf)).toBe('')
  })
})
