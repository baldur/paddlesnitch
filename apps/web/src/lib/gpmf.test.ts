import { describe, it, expect } from 'vitest'
import { parseGpmfGps } from '@paddlesnitch/timing/gpmf'

// A tiny GPMF writer, so the tests build exactly the layouts the cameras write.
type Node = { key: string; type: string; size: number; data: Uint8Array } | { key: string; children: Node[] }

function encode(nodes: Node[]): Uint8Array {
  const parts: Uint8Array[] = []
  for (const n of nodes) {
    const data = 'children' in n ? encode(n.children) : n.data
    const size = 'children' in n ? 1 : n.size
    const head = new Uint8Array(8)
    const v = new DataView(head.buffer)
    for (let i = 0; i < 4; i++) head[i] = n.key.charCodeAt(i)
    head[4] = 'children' in n ? 0 : n.type.charCodeAt(0)
    head[5] = size
    v.setUint16(6, data.length / size)
    parts.push(head, data, new Uint8Array(((data.length + 3) & ~3) - data.length))
  }
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

const int32s = (...xs: number[]) => {
  const b = new Uint8Array(xs.length * 4)
  xs.forEach((x, i) => new DataView(b.buffer).setInt32(i * 4, x))
  return b
}
const str = (s: string) => new TextEncoder().encode(s)

// One GPS9 row: lat, lon, alt, 2D speed, 3D speed, days since 2000, ms since midnight, DOP x100, fix.
function gps9Row(lat: number, lng: number, days: number, ms: number, dop: number, fix: number) {
  const b = new Uint8Array(32)
  const v = new DataView(b.buffer)
  ;[lat * 1e7, lng * 1e7, 45 * 1000, 2.5 * 1000, 2.5 * 100].forEach((x, i) => v.setInt32(i * 4, Math.round(x)))
  v.setInt32(20, days)
  v.setInt32(24, ms)
  v.setUint16(28, dop * 100)
  v.setUint16(30, fix)
  return b
}

const GPS9_SCAL = { key: 'SCAL', type: 'l', size: 4, data: int32s(1e7, 1e7, 1000, 1000, 100, 1, 1000, 100, 1) }

describe('parseGpmfGps', () => {
  it('reads GPS9 rows with their own time, DOP and fix', () => {
    // 2026-08-14 is day 9722 since 2000-01-01; 06:14:36.5 UTC.
    const ms = (6 * 3600 + 14 * 60 + 36.5) * 1000
    const buf = encode([{
      key: 'DEVC', children: [{
        key: 'STRM', children: [
          { key: 'STNM', type: 'c', size: 1, data: str('GPS (Lat., Long., Alt., 2D, 3D, days, secs, DOP, fix)') },
          GPS9_SCAL,
          { key: 'TYPE', type: 'c', size: 1, data: str('lllllllSS') },
          { key: 'GPS9', type: '?', size: 32, data: new Uint8Array([...gps9Row(51.4612345, -0.9512345, 9722, ms, 1.2, 3), ...gps9Row(51.4612445, -0.9512445, 9722, ms + 100, 1.3, 3)]) },
        ],
      }],
    }])
    const { payloads, fixes } = parseGpmfGps(buf)
    expect(payloads).toBe(1)
    expect(fixes).toHaveLength(2)
    expect(fixes[0].lat).toBeCloseTo(51.4612345, 7)
    expect(fixes[0].lng).toBeCloseTo(-0.9512345, 7)
    expect(fixes[0].alt).toBeCloseTo(45)
    expect(fixes[0].speed).toBeCloseTo(2.5)
    expect(fixes[0].timestamp.toISOString()).toBe('2026-08-14T06:14:36.500Z')
    expect(fixes[1].timestamp.toISOString()).toBe('2026-08-14T06:14:36.600Z')
    expect(fixes[0].dop).toBeCloseTo(1.2)
    expect(fixes[0].fix).toBe(3)
    expect(fixes[1].at).toBe(0.5)
  })

  it('reads GPS5 using the payload GPSU time, wherever GPSU sits in the stream', () => {
    const rows = int32s(514612345, -9512345, 45000, 2500, 2500, 514612445, -9512445, 45000, 2500, 2500)
    const strm = (gpsuFirst: boolean) => {
      const time = [
        { key: 'GPSU', type: 'U', size: 16, data: str('260814061436.000') },
        { key: 'GPSF', type: 'L', size: 4, data: int32s(3) },
        { key: 'GPSP', type: 'S', size: 2, data: new Uint8Array([0, 150]) },
      ]
      const gps = [
        { key: 'SCAL', type: 'l', size: 4, data: int32s(1e7, 1e7, 1000, 1000, 100) },
        { key: 'GPS5', type: 'l', size: 20, data: rows },
      ]
      return encode([{ key: 'DEVC', children: [{ key: 'STRM', children: gpsuFirst ? [...time, ...gps] : [...gps, ...time] }] }])
    }
    for (const first of [true, false]) {
      const { fixes } = parseGpmfGps(strm(first))
      expect(fixes).toHaveLength(2)
      expect(fixes[0].lat).toBeCloseTo(51.4612345, 7)
      expect(fixes[0].timestamp.toISOString()).toBe('2026-08-14T06:14:36.000Z')
      expect(fixes[1].timestamp.toISOString()).toBe('2026-08-14T06:14:36.500Z')
      expect(fixes[0].dop).toBe(1.5)
      expect(fixes[0].fix).toBe(3)
    }
  })

  it('numbers payloads so fixes can be placed on the video clock, and skips other sensors', () => {
    const payload = (lat: number) => ({
      key: 'DEVC', children: [
        { key: 'STRM', children: [{ key: 'SCAL', type: 's', size: 2, data: new Uint8Array([0, 1]) }, { key: 'ACCL', type: 's', size: 6, data: new Uint8Array(12) }] },
        { key: 'STRM', children: [GPS9_SCAL, { key: 'GPS9', type: '?', size: 32, data: gps9Row(lat, -0.95, 9722, 0, 1, 3) }] },
      ],
    } as Node)
    const { payloads, fixes } = parseGpmfGps(encode([payload(51.1), payload(51.2), payload(51.3)]))
    expect(payloads).toBe(3)
    expect(fixes.map((f) => f.at)).toEqual([0, 1, 2])
    expect(fixes.map((f) => f.lat.toFixed(1))).toEqual(['51.1', '51.2', '51.3'])
  })

  it('stops cleanly at a truncated payload instead of throwing', () => {
    const buf = encode([{ key: 'DEVC', children: [{ key: 'STRM', children: [GPS9_SCAL, { key: 'GPS9', type: '?', size: 32, data: gps9Row(51, -1, 9722, 0, 1, 3) }] }] }])
    expect(() => parseGpmfGps(buf.slice(0, buf.length - 10))).not.toThrow()
  })
})
