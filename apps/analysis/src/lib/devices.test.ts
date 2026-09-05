import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { storeDeviceSession } from '@paddlesnitch/core/devices'
import { listUserDeviceSessions, loadDeviceSessionTrack } from './devices'

// Device uploads live in the SHARED storage layout (devices/{deviceId}/…) the
// att upload route writes; these tests write it to a temp dir and read it back
// through the analysis bridge, the same way trials.test does (device-uplink P4).
let dir: string
const USER = 'user-abc'
const OTHER = 'user-xyz'
const DEVICE = '5A43CA48'

const CSV = [
  'timestamp,lat,lon,tx_seq',
  '2026-09-05T09:00:00Z,51.4600,-0.9300,1',
  '2026-09-05T09:00:01Z,51.4601,-0.9301,2',
  '2026-09-05T09:00:02Z,51.4602,-0.9302,3',
].join('\n')

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'att-devices-'))
  process.env.USE_LOCAL_STORAGE = 'true'
  process.env.DATA_DIR = dir
})
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); delete process.env.DATA_DIR })

describe('device sessions as an analyse source (P4)', () => {
  it('lists only the owner\'s sessions and loads+parses the stored CSV', async () => {
    const mine = await storeDeviceSession({ deviceId: DEVICE, userId: USER, filename: 'track_0001.csv', points: 3 }, CSV)
    await storeDeviceSession({ deviceId: DEVICE, userId: OTHER, filename: 'track_0009.csv', points: 3 }, CSV)

    const list = await listUserDeviceSessions(USER)
    expect(list.map(s => s.filename)).toEqual(['track_0001.csv'])

    const track = await loadDeviceSessionTrack(USER, DEVICE, mine.sessionId)
    expect(track).not.toBeNull()
    expect(track!.length).toBe(3)
    expect(track![0].lat).toBeCloseTo(51.46, 4)
  })

  it('will not load another user\'s device session', async () => {
    const theirs = await storeDeviceSession({ deviceId: DEVICE, userId: OTHER, filename: 'track_0002.csv', points: 3 }, CSV)
    expect(await loadDeviceSessionTrack(USER, DEVICE, theirs.sessionId)).toBeNull()
  })
})
