// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { deviceSummaries, fmtDist, fmtDur, type DeviceView } from './device-view'
import type { DeviceSessionMeta } from '@/lib/devices'

const dev = (deviceId: string, over: Partial<DeviceView> = {}): DeviceView =>
  ({ deviceId, name: `Tracker ${deviceId}`, model: 'lilygo-tbeam-s3-supreme', lastSeenAt: '2026-09-01T00:00:00Z', ...over })

const sess = (deviceId: string, over: Partial<DeviceSessionMeta> = {}): DeviceSessionMeta => ({
  sessionId: `s-${deviceId}-${over.filename ?? '1'}`, deviceId, userId: 'u1',
  filename: 'track_0001.csv', uploadedAt: '2026-09-10T10:00:00Z', points: 100, ...over,
})

describe('deviceSummaries (My Devices cards)', () => {
  it('lists a linked device with no uploads yet, so a freshly paired tracker is visibly there', () => {
    const [row] = deviceSummaries([dev('AAAAAAAA')], [])
    expect(row).toMatchObject({ deviceId: 'AAAAAAAA', linked: true, sessions: 0, totalDistanceM: 0 })
    expect(row.latestAt).toBeUndefined()
  })

  it('counts sessions, motion sidecars and total distance per device', () => {
    const [row] = deviceSummaries([dev('AAAAAAAA')], [
      sess('AAAAAAAA', { filename: 'a.csv', distanceMetres: 1200 }),
      sess('AAAAAAAA', { filename: 'b.csv', distanceMetres: 800, motion: { uploadedAt: 'x', bytes: 1, rows: 1 } }),
    ])
    expect(row).toMatchObject({ sessions: 2, motionSessions: 1, totalDistanceM: 2000 })
  })

  it('keeps sessions from a revoked device, flagged as not linked', () => {
    // Revoking deletes the device record but not its uploads. Dropping the rows
    // would hide data the user can still open.
    const rows = deviceSummaries([], [sess('BBBBBBBB', { distanceMetres: 500 })])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ deviceId: 'BBBBBBBB', linked: false, sessions: 1, name: 'Tracker BBBBBBBB' })
  })

  it('sorts linked devices first, then by most recent activity', () => {
    const rows = deviceSummaries(
      [dev('OLD'), dev('NEW')],
      [
        sess('OLD', { startedAt: '2026-08-01T00:00:00Z' }),
        sess('NEW', { startedAt: '2026-09-15T00:00:00Z' }),
        sess('GONE', { startedAt: '2026-09-18T00:00:00Z' }), // newest, but unlinked
      ],
    )
    expect(rows.map(r => r.deviceId)).toEqual(['NEW', 'OLD', 'GONE'])
  })

  it('dates a session by when it was paddled, falling back to when it was uploaded', () => {
    const [withStart] = deviceSummaries([dev('A')], [sess('A', { startedAt: '2026-09-11T06:00:00Z', uploadedAt: '2026-09-12T06:00:00Z' })])
    expect(withStart.latestAt).toBe('2026-09-11T06:00:00Z')
    const [noStart] = deviceSummaries([dev('A')], [sess('A', { uploadedAt: '2026-09-12T06:00:00Z' })])
    expect(noStart.latestAt).toBe('2026-09-12T06:00:00Z')
  })
})

describe('formatters', () => {
  it('switches to km at 1000 m and says — for nothing at all', () => {
    expect(fmtDist(999)).toBe('999 m')
    expect(fmtDist(1000)).toBe('1.00 km')
    expect(fmtDist(undefined)).toBe('—')
  })
  it('formats durations without leaking float seconds', () => {
    expect(fmtDur(45)).toBe('45s')
    expect(fmtDur(125.4)).toBe('2m 5s')
    expect(fmtDur(null)).toBe('—')
  })
})
