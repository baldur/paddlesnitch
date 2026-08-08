import { describe, it, expect } from 'vitest'
import { buildPrompt } from './llm'
import type { AnalysisResult } from './analysis'

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
})
