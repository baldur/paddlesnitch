import { describe, it, expect } from 'vitest'
import { axisTicks, envelopeXLabels, histogramHalfRangeDeg } from './boat-motion-chart'

describe('boat-motion axis ticks', () => {
  it('stay inside the chart and are symmetric (a ±10 chart had a -12 tick and no +12)', () => {
    expect(axisTicks(10)).toEqual([-9, -6, -3, 0, 3, 6, 9])
    for (const max of [1, 5.9, 6.1, 10.57, 12.1, 14.21, 25]) {
      const t = axisTicks(max)
      expect(t.every(v => Math.abs(v) <= max)).toBe(true)
      expect(t).toEqual([...t].reverse().map(v => (v === 0 ? 0 : -v)))
    }
  })
  it('step 2 up to 6°, 3 up to 12°, 5 beyond', () => {
    expect(axisTicks(6)).toEqual([-6, -4, -2, 0, 2, 4, 6])
    expect(axisTicks(12)).toEqual([-12, -9, -6, -3, 0, 3, 6, 9, 12])
    expect(axisTicks(14.21)).toEqual([-10, -5, 0, 5, 10])
  })
})

describe('boat-motion envelope x labels', () => {
  it('reads seconds under two minutes (a 20 s recording read "0 min … 0 min")', () => {
    expect(envelopeXLabels(20_000)).toEqual(['0 s', '20 s'])
    expect(envelopeXLabels(119_400)).toEqual(['0 s', '119 s'])
  })
  it('reads whole minutes from two minutes', () => {
    expect(envelopeXLabels(120_000)).toEqual(['0 min', '2 min'])
    expect(envelopeXLabels(43 * 60_000 + 20_000)).toEqual(['0 min', '43 min'])
  })
})

describe('boat-motion histogram x range', () => {
  it('reaches half a bin past the outermost centre, so the edge bars sit inside the frame', () => {
    const bins = [-7.5, -2.5, 2.5, 7.5].map(centreDeg => ({ centreDeg, count: 1 }))
    expect(histogramHalfRangeDeg({ binWidthDeg: 5, bins })).toBe(10)
  })
  it('is at least 1°', () => {
    expect(histogramHalfRangeDeg({ binWidthDeg: 0.2, bins: [{ centreDeg: 0.1, count: 3 }] })).toBe(1)
  })
})
