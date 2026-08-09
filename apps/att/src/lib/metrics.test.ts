import { describe, it, expect, vi } from 'vitest'
import { buildEmf, emitMetric, isMetricEvent, NAMESPACE } from './metrics'

describe('metrics EMF', () => {
  it('builds a valid EMF document with Event as the only dimension', () => {
    const emf = buildEmf('signup')
    expect(emf.Event).toBe('signup')
    expect(emf.Count).toBe(1)
    const m = emf._aws.CloudWatchMetrics[0]
    expect(m.Namespace).toBe(NAMESPACE)
    expect(m.Dimensions).toEqual([['Event']])
    expect(m.Metrics).toEqual([{ Name: 'Count', Unit: 'Count' }])
    expect(typeof emf._aws.Timestamp).toBe('number')
  })

  it('attaches props (e.g. path) WITHOUT making them metric dimensions', () => {
    const emf = buildEmf('pageview', { path: '/att', sid: 'abc' }) as Record<string, unknown>
    expect(emf.path).toBe('/att')
    expect(emf.sid).toBe('abc')
    // path/sid must not appear as dimensions (would explode metric cardinality)
    const dims = (emf._aws as { CloudWatchMetrics: Array<{ Dimensions: string[][] }> }).CloudWatchMetrics[0].Dimensions
    expect(dims).toEqual([['Event']])
  })

  it('emitMetric writes a single JSON line and never throws', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    emitMetric('upload', { path: '/x' })
    expect(spy).toHaveBeenCalledTimes(1)
    const parsed = JSON.parse(spy.mock.calls[0][0] as string)
    expect(parsed.Event).toBe('upload')
    spy.mockRestore()
  })

  it('uses the supplied timestamp (batched events keep their capture time)', () => {
    const t = 1_700_000_000_000
    const emf = buildEmf('pageview', {}, t)
    expect(emf._aws.Timestamp).toBe(t)
  })

  it('emitMetric forwards a timestamp when given', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    emitMetric('login', {}, 1_700_000_000_123)
    const parsed = JSON.parse(spy.mock.calls[0][0] as string)
    expect(parsed._aws.Timestamp).toBe(1_700_000_000_123)
    spy.mockRestore()
  })

  it('isMetricEvent gates the allowlist', () => {
    expect(isMetricEvent('pageview')).toBe(true)
    expect(isMetricEvent('signup')).toBe(true)
    expect(isMetricEvent('hax')).toBe(false)
    expect(isMetricEvent(42)).toBe(false)
    expect(isMetricEvent(undefined)).toBe(false)
  })
})
