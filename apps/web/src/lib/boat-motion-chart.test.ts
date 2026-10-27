import { describe, it, expect } from 'vitest'
import { axisTicks } from './boat-motion-chart'

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
