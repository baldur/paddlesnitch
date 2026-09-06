// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

// Mock the data + QR so the smoke test is cheap and deterministic; we assert the
// route returns a 200 image for a valid share and a branded fallback (never
// throws) for an unknown one. We do NOT consume the body (Satori render is
// deferred), keeping this fast.
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,AAAA') } }))
const getSharedSession = vi.fn()
vi.mock('@/lib/analysis-store', () => ({ getSharedSession: (...a: unknown[]) => getSharedSession(...a) }))

import Image, { size, contentType } from './opengraph-image'

const fakeSession = () => ({
  paddledAt: '2026-08-10T08:00:00Z', boatClass: 'K1',
  result: {
    durationS: 3620, distanceKm: 12.4, avgSpeed: 3, avgSR: 84, avgDps: 2.5, cruiseSpeed: 3.55, strokeRateDoubled: false,
    points: Array.from({ length: 100 }, (_, i) => ({ t: i, lat: 51.46 + i * 0.00003, lng: -0.93 + i * 0.00001, speed: 3, sr: 84, dps: 2.5 })),
    stops: [], surges: [], sets: [], insight: '',
  },
})

describe('shared paddle opengraph-image', () => {
  it('declares a 1200×630 PNG', () => {
    expect(size).toEqual({ width: 1200, height: 630 })
    expect(contentType).toBe('image/png')
  })

  it('returns a 200 image for a valid shared paddle', async () => {
    getSharedSession.mockResolvedValueOnce(fakeSession())
    const res = await Image({ params: Promise.resolve({ shareId: 'abc123' }) })
    expect(res.status).toBe(200)
  })

  it('returns a branded fallback (not an error) for an unknown/revoked link', async () => {
    getSharedSession.mockResolvedValueOnce(null)
    const res = await Image({ params: Promise.resolve({ shareId: 'gone' }) })
    expect(res.status).toBe(200)
  })
})
