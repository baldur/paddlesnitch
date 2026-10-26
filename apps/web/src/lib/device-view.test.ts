// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { deviceSummaries, deviceIsBehind, deviceIsQuiet, fmtAgo, fmtDist, fmtDur, type DeviceView, crashNote, trackerSummaries, CRASH_SHOWN_MS, DEVICE_QUIET_MS } from './device-view'
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

// GET /api/account/devices `summaries`: the apps show these as they are, so the
// judgements the page makes are made here once.
describe('trackerSummaries', () => {
  const now = Date.parse('2026-10-25T08:00:00Z')
  const devices = [
    { deviceId: 'A', name: 'Boat', firmware: '0.19.3', targetVersion: '0.19.3', lastSeenAt: '2026-10-25T07:00:00Z' },
    { deviceId: 'B', name: 'Spare', firmware: '0.18.1', targetVersion: null, lastSeenAt: '2026-10-20T18:44:00Z', lastCrash: { at: '2026-10-20T18:43:58Z', task: 'uplink' } },
    { deviceId: 'C', name: 'Old crash', firmware: '0.18.2', lastSeenAt: '2026-10-25T07:30:00Z', lastCrash: { at: '2026-10-01T00:00:00Z', task: 'gps' } },
  ]
  const sessions = [
    { deviceId: 'A', sessionId: 's1', startedAt: '2026-10-24T16:05:00Z', distanceMetres: 1000.4, motion: { uploadedAt: 'x', bytes: 1, rows: 1 } },
    { deviceId: 'A', sessionId: 's2', startedAt: '2026-10-23T16:05:00Z', distanceMetres: 2000.2 },
    { deviceId: 'Z', sessionId: 's3', startedAt: '2026-07-14T09:12:00Z', distanceMetres: 500 },
  ] as never
  const out = trackerSummaries(devices, sessions, '0.18.2', now)
  const byId = Object.fromEntries(out.map(s => [s.deviceId, s]))

  it('counts recordings, boat motion and distance (whole metres); most recent first (newest recording, else last heard from), removed trackers last', () => {
    expect(out.map(s => s.deviceId)).toEqual(['C', 'A', 'B', 'Z'])
    expect(byId.A).toMatchObject({ recordings: 2, motionRecordings: 1, distanceMetres: 3001, latestAt: '2026-10-24T16:05:00Z', linked: true })
    expect(byId.Z).toMatchObject({ linked: false, recordings: 1, name: 'Tracker Z' })
  })

  it('firmware is judged against its own target, else stable, and unknown is never "up to date"', () => {
    expect(byId.A.firmwareState).toBe('up_to_date')
    expect(byId.B.firmwareState).toBe('update_pending')
    expect(byId.C.firmwareState).toBe('up_to_date')
    expect(byId.Z.firmwareState).toBe('unknown')
    expect(trackerSummaries(devices, [], null, now).find(s => s.deviceId === 'C')!.firmwareState).toBe('unknown')
  })

  it('quiet after 2 days without a word (never for a removed tracker), and a crash only for 7 days', () => {
    expect(byId.A.quiet).toBe(false)
    expect(byId.B.quiet).toBe(true)
    expect(byId.Z.quiet).toBe(false)
    expect(byId.B.crash).toEqual({ at: '2026-10-20T18:43:58Z', task: 'uplink' })
    expect(byId.C.crash).toBeUndefined()
  })

  it('leaves latestAt out with no recordings, and counts zero for a new tracker', () => {
    expect(byId.C).not.toHaveProperty('latestAt')
    expect(byId.C).toMatchObject({ recordings: 0, motionRecordings: 0, distanceMetres: 0 })
  })

  it('judges against the tracker\'s own target even when there is no stable version', () => {
    const s = trackerSummaries([{ deviceId: 'T', name: 'T', firmware: '0.19.2', targetVersion: '0.19.3', lastSeenAt: '2026-10-25T07:00:00Z' }], [], null, now)
    expect(s[0].firmwareState).toBe('update_pending')
  })

  it('the edges the contract states: a crash exactly 7 days old still shows, 1 ms more and it goes; quiet only after 2 days', () => {
    const at = (ms: number) => new Date(now - ms).toISOString()
    const card = (lastSeenAt: string, crashAt?: string) => trackerSummaries(
      [{ deviceId: 'E', name: 'E', lastSeenAt, ...(crashAt ? { lastCrash: { at: crashAt, task: 't' } } : {}) }], [], null, now)[0]
    expect(card(at(0), at(CRASH_SHOWN_MS)).crash).toBeDefined()
    expect(card(at(0), at(CRASH_SHOWN_MS + 1)).crash).toBeUndefined()
    expect(card(at(DEVICE_QUIET_MS)).quiet).toBe(false)
    expect(card(at(DEVICE_QUIET_MS + 1)).quiet).toBe(true)
  })
})
