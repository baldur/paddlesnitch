// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { deviceSummaries, deviceIsBehind, deviceIsQuiet, fmtAgo, fmtDist, fmtDur, type DeviceView, crashNote } from './device-view'
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

describe('fleet state — version drift and liveness', () => {
  it('will not claim "up to date" when either version is unknown', () => {
    // A null answer must render as neither behind nor current. Showing an
    // unknown device as up to date is the one wrong answer available here.
    expect(deviceIsBehind(undefined, '0.14.0')).toBeNull()
    expect(deviceIsBehind('0.12.0', null)).toBeNull()
    expect(deviceIsBehind(undefined, null)).toBeNull()
  })

  it('reports a device behind the released version', () => {
    expect(deviceIsBehind('0.12.0', '0.14.0')).toBe(true)
    expect(deviceIsBehind('0.14.0', '0.14.0')).toBe(false)
  })

  it('treats a device never heard from as quiet', () => {
    expect(deviceIsQuiet(undefined)).toBe(true)
    expect(deviceIsQuiet('not-a-date')).toBe(true)
  })

  it('flags silence past the quiet threshold, not before', () => {
    const now = Date.parse('2026-09-27T12:00:00Z')
    const recent = new Date(now - 60 * 60 * 1000).toISOString()        // 1h
    const stale  = new Date(now - 3 * 24 * 3600 * 1000).toISOString()  // 3d
    expect(deviceIsQuiet(recent, now)).toBe(false)
    expect(deviceIsQuiet(stale, now)).toBe(true)
  })

  it('formats an age a person can read at a glance', () => {
    const now = Date.parse('2026-09-27T12:00:00Z')
    const ago = (ms: number) => fmtAgo(new Date(now - ms).toISOString(), now)
    expect(ago(30 * 1000)).toBe('30s ago')
    expect(ago(10 * 60 * 1000)).toBe('10m ago')
    expect(ago(5 * 3600 * 1000)).toBe('5h ago')
    expect(ago(3 * 24 * 3600 * 1000)).toBe('3d ago')
    expect(fmtAgo(undefined)).toBe('never')
  })
})

describe('crashNote', () => {
  const now = Date.parse('2026-10-05T20:00:00Z')
  it('says a tracker crashed recently, and where', () => {
    expect(crashNote({ at: '2026-10-05T18:00:00Z', task: 'uplink' }, now)).toBe('crashed 2h ago (uplink)')
  })
  it('says nothing about a crash more than a week old, or none', () => {
    expect(crashNote({ at: '2026-09-20T18:00:00Z', task: 'uplink' }, now)).toBeNull()
    expect(crashNote(undefined, now)).toBeNull()
  })
  it('leaves the task out when the chip saved none', () => {
    expect(crashNote({ at: '2026-10-05T19:30:00Z', task: '' }, now)).toBe('crashed 30m ago')
  })
})
