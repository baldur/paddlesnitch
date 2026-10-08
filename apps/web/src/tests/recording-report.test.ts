// @vitest-environment node
// A tracker recording's report (diagnostics, stroke rate, boat motion) is
// worked out once per recording version, not on every view, and sent with that
// version as its ETag (docs/features/performance.md, phase 1).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir } from './helpers'
import { sidecar, trackCsv } from './tracker-fixtures'

const auth = vi.hoisted(() => ({ user: null as null | { id: string; email: string; displayName: string } }))
vi.mock('@/lib/auth', () => ({ getAuthUser: async () => auth.user }))

import { GET } from '@/app/api/account/devices/sessions/[sessionId]/route'
import { storeDeviceSession, storeDeviceMotion } from '@/lib/devices'
import { _clearDerivedMemory } from '@paddlesnitch/core/derived'
import { listKeys, deleteObject } from '@/lib/storage'

const NAME = 'track_20261006_090000.csv'
let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir(); _clearDerivedMemory() })
afterEach(async () => { await cleanDataDir(dataDir); vi.restoreAllMocks() })

const get = (sessionId: string, etag?: string) => GET(
  new Request(`http://x/api/account/devices/sessions/${sessionId}?deviceId=435AC17C`, { headers: etag ? { 'if-none-match': etag } : {} }),
  { params: Promise.resolve({ sessionId }) },
)
const recording = async () => (await storeDeviceSession(
  { deviceId: '435AC17C', userId: 'u1', filename: NAME, startedAt: '', endedAt: '', distanceMetres: 750, points: 300 },
  trackCsv(300, 9, { startMs: 400_000 }),
)).sessionId

describe("a recording's report", () => {
  it('is worked out once, not on every view', async () => {
    auth.user = { id: 'u1', email: 'a@x', displayName: 'A' }
    const id = await recording()
    await storeDeviceMotion('435AC17C', 'u1', NAME, sidecar({ seconds: 300, hz: 10, strokesPerMin: 56, startMs: 400_000 }), 3000)
    const first = await (await get(id)).json()
    expect(first.attitude).not.toBeNull()
    // Take the raw files away: a second view can only come from the saved
    // report, even after a cold start (the warm memory gone).
    for (const k of await listKeys('devices/435AC17C/sessions/')) if (/trace\.csv$|motion\.csv$/.test(k)) await deleteObject(k)
    _clearDerivedMemory()
    const second = await get(id)
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual(first)
    expect(await listKeys('derived/u/u1/')).toHaveLength(1)
  })

  it('answers 304 with no body when the browser already has this version', async () => {
    auth.user = { id: 'u1', email: 'a@x', displayName: 'A' }
    const id = await recording()
    const first = await get(id)
    const etag = first.headers.get('etag')!
    expect(first.headers.get('cache-control')).toBe('private, no-cache')
    const again = await get(id, etag)
    expect(again.status).toBe(304)
    expect(await again.text()).toBe('')
  })

  it('still answers 304 when a hop on the way weakened the ETag (W/)', async () => {
    auth.user = { id: 'u1', email: 'a@x', displayName: 'A' }
    const id = await recording()
    const etag = (await get(id)).headers.get('etag')!
    expect((await get(id, `W/${etag}`)).status).toBe(304)
  })

  it('is a new report, with a new ETag, when the motion data lands', async () => {
    auth.user = { id: 'u1', email: 'a@x', displayName: 'A' }
    const id = await recording()
    const before = await get(id)
    expect((await before.json()).attitude).toBeNull()
    await storeDeviceMotion('435AC17C', 'u1', NAME, sidecar({ seconds: 300, hz: 10, strokesPerMin: 56, startMs: 400_000 }), 3000)
    const after = await get(id, before.headers.get('etag')!)
    expect(after.status).toBe(200)
    expect(after.headers.get('etag')).not.toBe(before.headers.get('etag'))
    expect((await after.json()).attitude).not.toBeNull()
  })

  it("is not found for someone else, and nothing is worked out for them", async () => {
    auth.user = { id: 'u1', email: 'a@x', displayName: 'A' }
    const id = await recording()
    auth.user = { id: 'u2', email: 'b@x', displayName: 'B' }
    expect((await get(id)).status).toBe(404)
    expect(await listKeys('derived/')).toEqual([])
  })
})
