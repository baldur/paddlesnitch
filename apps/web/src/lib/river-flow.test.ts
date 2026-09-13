import { describe, it, expect } from 'vitest'
import { pickNearestFlowStation, pickNearestReading, getFlowAt } from './river-flow'

describe('pickNearestFlowStation', () => {
  const stations = [
    { label: 'Far', lat: 52.0, long: -0.9, measures: [{ '@id': 'm-far', parameter: 'flow' }] },
    { label: 'Near', lat: 51.51, long: -0.9, measures: [{ '@id': 'm-near', parameter: 'flow' }] },
    { label: 'NoFlow', lat: 51.5, long: -0.9, measures: [{ '@id': 'm-level', parameter: 'level' }] },
  ]
  it('picks the closest station that has a flow measure', () => {
    expect(pickNearestFlowStation(stations, 51.5, -0.9)).toEqual({ measureId: 'm-near', label: 'Near' })
  })
  it('handles a single measure object (not array)', () => {
    const s = [{ label: 'S', lat: 51.5, long: -0.9, measures: { '@id': 'm1', parameter: 'flow' } }]
    expect(pickNearestFlowStation(s, 51.5, -0.9)?.measureId).toBe('m1')
  })
  it('returns null when nothing has a flow measure', () => {
    expect(pickNearestFlowStation([{ label: 'x', lat: 1, long: 1, measures: [] }], 51.5, -0.9)).toBeNull()
    expect(pickNearestFlowStation('nonsense', 51.5, -0.9)).toBeNull()
  })
})

describe('pickNearestReading', () => {
  const items = [
    { dateTime: '2026-07-01T07:45:00Z', value: 10 },
    { dateTime: '2026-07-01T08:00:00Z', value: 12 },
    { dateTime: '2026-07-01T08:15:00Z', value: 14 },
  ]
  it('picks the reading nearest the target time', () => {
    expect(pickNearestReading(items, new Date('2026-07-01T08:05:00Z'))).toEqual({ value: 12, at: '2026-07-01T08:00:00Z' })
  })
  it('skips non-numeric / malformed rows', () => {
    const messy = [{ dateTime: 'x', value: 'n/a' }, { dateTime: '2026-07-01T08:00:00Z', value: 9 }]
    expect(pickNearestReading(messy, new Date('2026-07-01T08:00:00Z'))?.value).toBe(9)
  })
  it('returns null on empty / bad input', () => {
    expect(pickNearestReading([], new Date())).toBeNull()
    expect(pickNearestReading(null, new Date())).toBeNull()
  })
})

describe('getFlowAt', () => {
  // Dispatch by URL: the readings call contains "/readings".
  function mockFetch(stationsBody: unknown, readingsBody: unknown, opts: { readingsOk?: boolean } = {}) {
    return (async (url: string) => {
      if (String(url).includes('/readings')) {
        return { ok: opts.readingsOk ?? true, json: async () => readingsBody }
      }
      return { ok: true, json: async () => stationsBody }
    }) as unknown as typeof fetch
  }

  it('resolves nearest station + reading into a FlowReading', async () => {
    const f = mockFetch(
      { items: [{ label: 'Thames at X', lat: 51.5, long: -0.9, measures: [{ '@id': 'http://ea/measures/2200TH-flow', parameter: 'flow' }] }] },
      { items: [{ dateTime: '2026-07-01T08:00:00Z', value: 23.4 }] },
    )
    const r = await getFlowAt(51.5, -0.9, '2026-07-01T08:02:00Z', f)
    expect(r).toEqual({ stationId: 'http://ea/measures/2200TH-flow', stationLabel: 'Thames at X', valueM3s: 23.4, at: '2026-07-01T08:00:00Z' })
  })

  it('returns the station without a value when readings fail', async () => {
    const f = mockFetch(
      { items: [{ label: 'S', lat: 51.5, long: -0.9, measures: [{ '@id': 'm1', parameter: 'flow' }] }] },
      {},
      { readingsOk: false },
    )
    const r = await getFlowAt(51.5, -0.9, '2026-07-01T08:00:00Z', f)
    expect(r).toEqual({ stationId: 'm1', stationLabel: 'S' })
  })

  it('returns null when no flow station is nearby', async () => {
    const f = mockFetch({ items: [] }, { items: [] })
    expect(await getFlowAt(51.5, -0.9, '2026-07-01T08:00:00Z', f)).toBeNull()
  })
})
