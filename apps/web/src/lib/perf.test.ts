import { describe, it, expect } from 'vitest'
import { percentile, summarise, checkImmutable, markdown, metricData, type Sample } from './perf'

const s = (ttfbMs: number, status = 200): Sample => ({ status, ttfbMs, totalMs: ttfbMs + 5, bytes: 2048 })

describe('performance check', () => {
  it('takes percentiles by nearest rank', () => {
    expect(percentile([5, 1, 4, 2, 3], 50)).toBe(3)
    expect(percentile([5, 1, 4, 2, 3], 95)).toBe(5)
    expect(percentile([], 50)).toBeNaN()
  })

  it('keeps the first run (maybe a cold start) apart from the median', () => {
    const r = summarise('Trials', '/att', [s(2400), s(300), s(320), s(310)], 1000)
    expect(r.firstTtfbMs).toBe(2400)
    expect(r.medianTtfbMs).toBe(310)
    expect(r.overBudget).toBe(false)
  })

  it('flags a page over budget, and one that is not 200', () => {
    expect(summarise('Trials', '/att', [s(1500), s(1500), s(1500)], 1000).overBudget).toBe(true)
    expect(summarise('Gone', '/x', [s(50), s(50, 500)], 1000).status).toBe(500)
  })

  it('checks a built file is kept for a year', () => {
    expect(checkImmutable('public, max-age=31536000, immutable').ok).toBe(true)
    expect(checkImmutable(null).ok).toBe(false)
    expect(checkImmutable('max-age=60').ok).toBe(false)
  })

  it('always reports, saying which pages need a look', () => {
    const ok = summarise('Home', '/', [s(100), s(110)], 500)
    const slow = summarise('Trials', '/att', [s(1200), s(1300)], 1000)
    const md = markdown([ok, slow], [checkImmutable(null)], { baseUrl: 'https://x', runs: 2, at: 'now' })
    expect(md).toContain('| Home (`/`) | 200 | **110 ms**')
    expect(md).toContain('⚠ over 1000 ms')
    expect(md).toContain('1 page over budget or not 200:** Trials')
    expect(markdown([ok], [], { baseUrl: 'https://x', runs: 2, at: 'now' })).toContain('All pages within budget.')
  })

  it('sends one TTFB value per page to CloudWatch', () => {
    const m = metricData([summarise('Home', '/', [s(100), s(110)], 500)], new Date('2026-10-07T20:00:00Z'))
    expect(m.Namespace).toBe('Paddlesnitch/Perf')
    expect(m.MetricData).toEqual([{ MetricName: 'TTFB', Dimensions: [{ Name: 'Page', Value: 'Home' }], Timestamp: '2026-10-07T20:00:00.000Z', Value: 110, Unit: 'Milliseconds' }])
  })
})
