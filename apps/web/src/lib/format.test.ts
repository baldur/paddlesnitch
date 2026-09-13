import { describe, it, expect } from 'vitest'
import { paceFor500m, speedKmh, speedMs, utcDateString } from './format'

describe('paceFor500m', () => {
  it('returns "2:00.0" for 500m in 120s', () => {
    expect(paceFor500m(500, 120)).toBe('2:00.0')
  })

  it('returns "1:30.0" for 1000m in 180s (1:30 per 500m)', () => {
    expect(paceFor500m(1000, 180)).toBe('1:30.0')
  })

  it('returns "—" for zero distance', () => {
    expect(paceFor500m(0, 120)).toBe('—')
  })

  it('returns "—" for zero elapsed time', () => {
    expect(paceFor500m(500, 0)).toBe('—')
  })

  it('preserves decimal precision', () => {
    // 500m in 121.5s → 2:01.5 per 500m
    expect(paceFor500m(500, 121.5)).toBe('2:01.5')
  })
})

describe('speedKmh', () => {
  it('returns "15.0 km/h" for 500m in 120s', () => {
    // 500m / 120s = 4.166 m/s = 15 km/h
    expect(speedKmh(500, 120)).toBe('15.0 km/h')
  })

  it('returns "—" for zero distance or time', () => {
    expect(speedKmh(0, 120)).toBe('—')
    expect(speedKmh(500, 0)).toBe('—')
  })

  it('rounds to one decimal', () => {
    // 1000m in 333.33s → 10.8 km/h
    expect(speedKmh(1000, 333.33)).toBe('10.8 km/h')
  })
})

describe('speedMs', () => {
  it('returns "4.17 m/s" for 500m in 120s', () => {
    expect(speedMs(500, 120)).toBe('4.17 m/s')
  })

  it('returns "—" for zero distance or time', () => {
    expect(speedMs(0, 120)).toBe('—')
    expect(speedMs(500, 0)).toBe('—')
  })
})

describe('utcDateString', () => {
  it('extracts YYYY-MM-DD from an ISO timestamp', () => {
    expect(utcDateString('2024-06-01T15:30:00Z')).toBe('2024-06-01')
  })

  it('handles Date instances', () => {
    expect(utcDateString(new Date('2024-06-01T23:59:59Z'))).toBe('2024-06-01')
  })

  it('uses UTC, not local timezone', () => {
    // Same UTC instant should give the same date regardless of TZ
    expect(utcDateString('2024-06-01T00:00:00Z')).toBe('2024-06-01')
  })
})

