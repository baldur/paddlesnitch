import { describe, it, expect } from 'vitest'
import { shareCard, projectRoute } from './share-card'
import type { AnalysisSession } from './analysis-store'
import type { AnalysisResult } from './analysis'

function session(over: Partial<AnalysisResult> = {}, extra: Partial<AnalysisSession> = {}): AnalysisSession {
  const result = {
    durationS: 3620, distanceKm: 12.42, avgSpeed: 3, avgSR: 84.4, avgDps: 2.5, srCv: 5,
    cruiseSpeed: 3.55, strokeRateDoubled: false,
    points: Array.from({ length: 500 }, (_, i) => ({ t: i, lat: 51.46 + i * 0.00003, lng: -0.93 + i * 0.00001, speed: 3, sr: 84, dps: 2.5 })),
    stops: [], surges: [], sets: [], insight: '',
    ...over,
  } as AnalysisResult
  return { paddledAt: '2026-08-10T08:00:00Z', boatClass: 'K1', result, ...extra } as unknown as AnalysisSession
}

describe('shareCard', () => {
  it('formats the headline stats', () => {
    const c = shareCard(session())
    expect(c.distance).toBe('12.4 km')
    expect(c.duration).toBe('1:00:20')     // 3620s → h:mm:ss past an hour
    expect(c.pace).toMatch(/\/500$/)
    expect(c.spm).toBe('84 spm')
    expect(c.date).toBe('10 Aug 2026')
    expect(c.tag).toBe('K1')
  })

  it('uses m:ss for sub-hour paddles and omits spm when absent', () => {
    const c = shareCard(session({ durationS: 3500, avgSR: null }))
    expect(c.duration).toBe('58:20')
    expect(c.spm).toBeNull()
  })

  it('shows "—" pace only below the speed threshold', () => {
    expect(shareCard(session({ cruiseSpeed: 0.1 })).pace).toBe('—')
    expect(shareCard(session({ cruiseSpeed: 3.55 })).pace).not.toBe('—')
  })

  it('projects the route inside the viewbox and downsamples', () => {
    const c = shareCard(session())
    expect(c.pts.length).toBeGreaterThan(1)
    expect(c.pts.length).toBeLessThanOrEqual(220)
    for (const [x, y] of c.pts) {
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(c.viewW)
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(c.viewH)
    }
  })
})

describe('projectRoute', () => {
  it('returns nothing for fewer than two points', () => {
    expect(projectRoute([], 100, 100, 10)).toEqual([])
    expect(projectRoute([{ lat: 1, lng: 1 }], 100, 100, 10)).toEqual([])
  })
  it('keeps points within the padded box', () => {
    const pts = projectRoute([{ lat: 0, lng: 0 }, { lat: 0.01, lng: 0.02 }, { lat: 0.005, lng: 0.03 }], 200, 100, 10)
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(10); expect(x).toBeLessThanOrEqual(190)
      expect(y).toBeGreaterThanOrEqual(10); expect(y).toBeLessThanOrEqual(90)
    }
  })
})
