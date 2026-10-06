import { describe, it, expect } from 'vitest'
import { reanalysed } from '../../scripts/backfill-tracker-stroke-rate'
import { analyseTrack } from '@paddlesnitch/analysis/analysis'
import type { AnalysisSession } from '@paddlesnitch/analysis/analysis-store'

const t0 = Date.parse('2026-09-13T08:00:00Z')
const track = (sr?: number) => Array.from({ length: 300 }, (_, i) => ({
  lat: 51.5 + i * 0.00003, lng: -0.1, timestamp: new Date(t0 + i * 1000), ...(sr ? { strokeRate: sr } : {}),
}))
const session = (): AnalysisSession => {
  const result = analyseTrack(track(), { conditions: { windKmh: 12 } })
  return {
    id: 'p1', userId: 'u1', createdAt: '', paddledAt: '2026-09-13T08:00:00Z',
    source: { type: 'device', deviceId: '5A43CA48', deviceSessionId: 's1' },
    doubleStrokeRate: true, note: 'windy', boatClass: 'K1',
    result: { ...result, strokeRateDoubled: true, insight: 'A steady paddle.', insightModel: 'm' },
  } as AnalysisSession
}

describe('backfill-tracker-stroke-rate', () => {
  it('adds the stroke rate and keeps the note, boat, summary and conditions', () => {
    const next = reanalysed(session(), track(56))!
    expect(next.result.avgSR).toBeCloseTo(56, 0)
    expect(next.note).toBe('windy')
    expect(next.boatClass).toBe('K1')
    expect(next.result.insight).toBe('A steady paddle.')
    expect(next.result.conditions).toEqual({ windKmh: 12 })
  })

  it('turns doubling off: the tracker already counts every stroke', () => {
    const next = reanalysed(session(), track(56))!
    expect(next.doubleStrokeRate).toBe(false)
    expect(next.result.strokeRateDoubled).toBe(false)
  })

  it('leaves a paddle alone when its recording has no motion data', () => {
    expect(reanalysed(session(), track())).toBeNull()
  })
})
