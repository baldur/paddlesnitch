import { describe, it, expect } from 'vitest'
import type { GpmfFix } from '@paddlesnitch/timing/gpmf'
import { usableFixes } from './telemetry'

const fix = (over: Partial<GpmfFix>): GpmfFix => ({
  lat: 51.47, lng: -0.98, alt: 40, speed: 2.346, speed3d: 2.3, timestamp: new Date('2026-11-08T09:00:00Z'), dop: 1.2, fix: 3, at: 0, ...over,
} as GpmfFix)

describe('usableFixes', () => {
  it('drops fixes without a 3D lock or with DOP over 5, as course:ingest always has', () => {
    const kept = usableFixes({ payloads: 10, fixes: [fix({ fix: 2 }), fix({ dop: 5.1 }), fix({ dop: 5 }), fix({ fix: 0 })] }, 10)
    expect(kept).toHaveLength(1)
    expect(kept[0].dop).toBe(5)
  })
  it('times each fix on the file clock from its payload position', () => {
    // 20 payloads over 100 s: payload 7.5 is 37.5 s in.
    const [f] = usableFixes({ payloads: 20, fixes: [fix({ at: 7.5 })] }, 100)
    expect(f.ft).toBe(37.5)
    expect(f.speed).toBe(2.35)
    expect(f.utc).toBe('2026-11-08T09:00:00.000Z')
  })
})
