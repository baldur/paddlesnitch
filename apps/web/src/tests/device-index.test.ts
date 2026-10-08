// @vitest-environment node
// A user's trackers and recordings come from a per-user index, not from a scan
// of every tracker's files (performance.md, phase D). Same answers as the
// scan, without touching anyone else's data, and an older account builds its
// index once.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir } from './helpers'

const spy = vi.hoisted(() => ({ lists: [] as string[], reads: [] as string[] }))
vi.mock('@paddlesnitch/core/storage', async (orig) => {
  const real = await orig<typeof import('@paddlesnitch/core/storage')>()
  return {
    ...real,
    listKeys: (p: string) => { spy.lists.push(p); return real.listKeys(p) },
    getJson: (k: string) => { spy.reads.push(k); return real.getJson(k) },
  }
})

import {
  createClaim, linkClaim, redeemToken, revokeDevice, storeDeviceSession, listUserDevices, listUserDeviceSessions,
} from '@paddlesnitch/core/devices'
import { deleteObject, listKeys } from '@paddlesnitch/core/storage'

async function pair(userId: string, deviceId: string) {
  const c = await createClaim(deviceId, 'T-Beam', '0.18.0')
  await linkClaim(c.claimCode, userId, `${userId}'s tracker`)
  await redeemToken(deviceId, c.claimSecret)
}
const record = (userId: string, deviceId: string, n: number) => storeDeviceSession(
  { deviceId, userId, filename: `track_${String(n).padStart(4, '0')}.csv`, startedAt: '2026-09-01T09:00:00Z', endedAt: '2026-09-01T10:00:00Z', distanceMetres: 1000, points: 10 },
  'lat,lon,timestamp\n',
)

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir(); spy.lists = []; spy.reads = [] })
afterEach(async () => { await cleanDataDir(dataDir) })

describe("a user's trackers and recordings", () => {
  it("are listed without reading anyone else's (after the index is built)", async () => {
    await pair('me', 'AAAA0001'); await pair('them', 'BBBB0002')
    for (let i = 0; i < 3; i++) await record('me', 'AAAA0001', i)
    for (let i = 0; i < 20; i++) await record('them', 'BBBB0002', i)
    await listUserDeviceSessions('me')   // the one-time build (see the next test)
    spy.lists = []; spy.reads = []

    expect((await listUserDeviceSessions('me')).map(s => s.filename).sort()).toEqual(['track_0000.csv', 'track_0001.csv', 'track_0002.csv'])
    expect((await listUserDevices('me')).map(d => d.deviceId)).toEqual(['AAAA0001'])
    expect(spy.lists).not.toContain('devices/')
    expect(spy.reads.some(k => k.startsWith('devices/BBBB0002/'))).toBe(false)
  })

  it('an account from before the index builds it once, from one scan', async () => {
    await pair('me', 'AAAA0001')
    for (let i = 0; i < 2; i++) await record('me', 'AAAA0001', i)
    // As it was before the index: drop the entries and the marker.
    for (const k of await listKeys('users/me/')) await deleteObject(k)
    spy.lists = []

    expect(await listUserDeviceSessions('me')).toHaveLength(2)
    expect(await listUserDevices('me')).toHaveLength(1)
    expect(await listUserDeviceSessions('me')).toHaveLength(2)
    expect(spy.lists.filter(p => p === 'devices/')).toHaveLength(1)
  })

  it('a removed tracker leaves the list, its recordings stay', async () => {
    await pair('me', 'AAAA0001')
    await record('me', 'AAAA0001', 0)
    expect(await revokeDevice('me', 'AAAA0001')).toBe(true)
    expect(await listUserDevices('me')).toEqual([])
    expect(await listUserDeviceSessions('me')).toHaveLength(1)
  })

  it('a tracker passed on is listed for its new owner only, with each owner keeping their own recordings', async () => {
    await pair('me', 'AAAA0001'); await record('me', 'AAAA0001', 0)
    await revokeDevice('me', 'AAAA0001')
    await pair('them', 'AAAA0001'); await record('them', 'AAAA0001', 1)
    expect((await listUserDevices('them')).map(d => d.deviceId)).toEqual(['AAAA0001'])
    expect(await listUserDevices('me')).toEqual([])
    expect((await listUserDeviceSessions('me')).map(s => s.filename)).toEqual(['track_0000.csv'])
    expect((await listUserDeviceSessions('them')).map(s => s.filename)).toEqual(['track_0001.csv'])
  })
})
