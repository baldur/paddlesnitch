// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { POST as claim } from '@/app/api/devices/claim/route'
import { POST as token } from '@/app/api/devices/token/route'
import { POST as link } from '@/app/api/account/devices/link/route'
import { POST as uploadSession } from '@/app/api/devices/sessions/route'
import { GET as getFirmware } from '@/app/api/devices/firmware/route'
import { POST as ackFirmware } from '@/app/api/devices/firmware/ack/route'
import { GET as downloadFirmware } from '@/app/api/devices/firmware/download/route'
import { GET as adminEvents } from '@/app/api/admin/devices/[deviceId]/firmware-events/route'
import {
  publishFirmware, promoteFirmware, getChannelVersion, firmwareOfferFor,
  isFirmwareVersion, compareVersionsDesc, listPublishedVersions,
  recordFirmwareBooted, listDeviceFirmwareEvents, __clearChannelCache,
} from '@/lib/firmware'
import { cookies } from 'next/headers'

let dataDir: string
beforeEach(async () => {
  dataDir = await makeDataDir()
  __clearChannelCache()
  delete process.env.ADMIN_USER_IDS
})
afterEach(async () => {
  await cleanDataDir(dataDir)
  __clearChannelCache()
  delete process.env.ADMIN_USER_IDS
  vi.restoreAllMocks()
})

function mockAuth(idToken: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name === 'tt_id' && idToken ? { name, value: idToken } : undefined),
  } as ReturnType<typeof cookies> extends Promise<infer T> ? T : never)
}

const DEVICE = '5A43CA48'
const jreq = (body: unknown) =>
  new Request('http://x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

/** Mint a real device token through the pairing flow, so these tests use the
 *  same auth path a device does rather than a fabricated one. */
async function boundToken(u: { id: string; idToken: string }): Promise<string> {
  const { claimCode, claimSecret } = await (await claim(jreq({ deviceId: DEVICE, model: 'lilygo-tbeam-s3-supreme', firmware: '0.9.0' }))).json()
  mockAuth(u.idToken)
  await link(jreq({ claimCode }))
  return (await (await token(jreq({ deviceId: DEVICE, claimSecret }))).json()).deviceToken
}

const IMAGE = Buffer.from('a fake firmware image, but a real sha256 over it')

const fwReq = (deviceToken: string, query = '', headers: Record<string, string> = {}) =>
  new Request(`http://localhost:3000/api/devices/firmware${query}`, {
    headers: { authorization: `Bearer ${deviceToken}`, ...headers },
  })

// ---------------------------------------------------------------------------

describe('firmware version validation', () => {
  it('accepts semver and rejects anything that could escape the key prefix', () => {
    expect(isFirmwareVersion('0.10.0')).toBe(true)
    expect(isFirmwareVersion('1.2.3-rc.1')).toBe(true)
    // The version is device-supplied and lands in a storage key, so traversal
    // and separators must never parse as a version in the first place.
    expect(isFirmwareVersion('../../secrets')).toBe(false)
    expect(isFirmwareVersion('0.10.0/../../x')).toBe(false)
    expect(isFirmwareVersion('latest')).toBe(false)
    expect(isFirmwareVersion('')).toBe(false)
    expect(isFirmwareVersion(undefined)).toBe(false)
  })

  it('orders versions numerically, not lexically, and ranks a release above its pre-release', () => {
    expect(['0.9.0', '0.10.0', '0.2.0'].sort(compareVersionsDesc)).toEqual(['0.10.0', '0.9.0', '0.2.0'])
    expect(compareVersionsDesc('1.0.0', '1.0.0-rc.1')).toBeLessThan(0)
  })
})

describe('publish vs promote — uploading a build is not releasing it', () => {
  it('a published version reaches no device until it is promoted', async () => {
    const manifest = await publishFirmware('0.10.0', IMAGE, { notes: 'test build' })
    expect(manifest.sizeBytes).toBe(IMAGE.length)
    expect(manifest.sha256).toMatch(/^[0-9a-f]{64}$/)

    // Published, but no channel points at it.
    expect(await listPublishedVersions()).toEqual(['0.10.0'])
    expect(await getChannelVersion('stable')).toBeNull()
    expect(await firmwareOfferFor('0.9.0')).toEqual({ status: 'no_channel' })

    __clearChannelCache()
    expect(await promoteFirmware('stable', '0.10.0')).toBe('ok')
    const offer = await firmwareOfferFor('0.9.0', { origin: 'http://localhost:3000' })
    expect(offer.status).toBe('update')
  })

  it('refuses to promote a version whose image was never published', async () => {
    // A channel pointing at missing bytes turns every device's next sync into a
    // failed download, so this is refused at promote time, not discovered later.
    expect(await promoteFirmware('stable', '9.9.9')).toBe('unknown_version')
    expect(await getChannelVersion('stable')).toBeNull()
  })

  it('caches the channel read but drops the cache on promote', async () => {
    await publishFirmware('0.10.0', IMAGE, { notes: 'n' })
    await promoteFirmware('stable', '0.10.0')
    expect(await getChannelVersion('stable')).toBe('0.10.0')

    await publishFirmware('0.11.0', IMAGE, { notes: 'n' })
    await promoteFirmware('stable', '0.11.0')
    // Without the invalidation in promoteFirmware this would still read 0.10.0
    // for a minute, which is how a rollback appears not to work.
    expect(await getChannelVersion('stable')).toBe('0.11.0')
  })
})

describe('GET /api/devices/firmware', () => {
  it('401s without a device token', async () => {
    const res = await getFirmware(new Request('http://localhost:3000/api/devices/firmware'))
    expect(res.status).toBe(401)
  })

  it('404s with no_channel before anything has been promoted', async () => {
    const u = await makeUser('FW One')
    const t = await boundToken(u)
    const res = await getFirmware(fwReq(t, '?current=0.9.0'))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('no_channel')
  })

  it('304s a device already on the promoted version, with the version as its ETag', async () => {
    const u = await makeUser('FW Two')
    const t = await boundToken(u)
    await publishFirmware('0.10.0', IMAGE, { notes: 'n' })
    await promoteFirmware('stable', '0.10.0')

    const res = await getFirmware(fwReq(t, '?current=0.10.0'))
    expect(res.status).toBe(304)
    expect(res.headers.get('etag')).toBe('"0.10.0"')
    expect(await res.text()).toBe('')
  })

  it('304s on a matching If-None-Match without issuing a download URL', async () => {
    const u = await makeUser('FW Three')
    const t = await boundToken(u)
    await publishFirmware('0.10.0', IMAGE, { notes: 'n' })
    await promoteFirmware('stable', '0.10.0')

    const res = await getFirmware(fwReq(t, '?current=0.9.0', { 'if-none-match': '"0.10.0"' }))
    expect(res.status).toBe(304)
    // Nothing was offered, so nothing was recorded.
    expect(await listDeviceFirmwareEvents(DEVICE)).toEqual([])
  })

  it('200s a stale device with the manifest, a download URL, and an offer record', async () => {
    const u = await makeUser('FW Four')
    const t = await boundToken(u)
    const manifest = await publishFirmware('0.10.0', IMAGE, { notes: 'Fixes the IMU peak window.' })
    await promoteFirmware('stable', '0.10.0')

    const res = await getFirmware(fwReq(t, '?current=0.9.0'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.version).toBe('0.10.0')
    expect(body.sha256).toBe(manifest.sha256)
    expect(body.sizeBytes).toBe(IMAGE.length)
    expect(body.notes).toBe('Fixes the IMU peak window.')
    expect(body.expiresInSeconds).toBe(900)
    expect(body.url).toContain('/api/devices/firmware/download')
    expect(res.headers.get('etag')).toBe('"0.10.0"')

    const events = await listDeviceFirmwareEvents(DEVICE)
    expect(events).toHaveLength(1)
    expect(events[0].version).toBe('0.10.0')
    expect(events[0].offered?.fromVersion).toBe('0.9.0')
    expect(events[0].booted).toBeNull()
  })

  it('503s rather than silently serving nothing when the channel points at a missing manifest', async () => {
    const u = await makeUser('FW Five')
    const t = await boundToken(u)
    await publishFirmware('0.10.0', IMAGE, { notes: 'n' })
    await promoteFirmware('stable', '0.10.0')
    // Simulate a half-deleted release.
    const { deleteObject } = await import('@/lib/storage')
    await deleteObject('firmware/0.10.0/manifest.json')

    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await getFirmware(fwReq(t, '?current=0.9.0'))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('manifest_missing')
  })
})

describe('the download URL', () => {
  it('serves the exact bytes with no credentials, and refuses a tampered signature', async () => {
    const u = await makeUser('FW Six')
    const t = await boundToken(u)
    await publishFirmware('0.10.0', IMAGE, { notes: 'n' })
    await promoteFirmware('stable', '0.10.0')
    const { url } = await (await getFirmware(fwReq(t, '?current=0.9.0'))).json()

    // No Authorization header — the URL itself is the grant, exactly as the
    // device will use it.
    const ok = await downloadFirmware(new Request(url))
    expect(ok.status).toBe(200)
    expect(Buffer.from(await ok.arrayBuffer()).equals(IMAGE)).toBe(true)

    const tampered = url.replace(/sig=[0-9a-f]+/, 'sig=' + '0'.repeat(64))
    expect((await downloadFirmware(new Request(tampered))).status).toBe(403)
  })

  it('refuses an expired URL', async () => {
    const u = await makeUser('FW Seven')
    const t = await boundToken(u)
    await publishFirmware('0.10.0', IMAGE, { notes: 'n' })
    await promoteFirmware('stable', '0.10.0')
    const { url } = await (await getFirmware(fwReq(t, '?current=0.9.0'))).json()

    // 16 minutes on: past the 15-minute TTL.
    vi.setSystemTime(new Date(Date.now() + 16 * 60 * 1000))
    try {
      expect((await downloadFirmware(new Request(url))).status).toBe(403)
    } finally {
      vi.useRealTimers()
    }
  })

  it('will not serve anything but a firmware image, even correctly signed', async () => {
    // Defence in depth: the signature proves we minted the URL, the key pattern
    // proves it was for a firmware image and not somebody's session data.
    const { devPresignSignature } = await import('@paddlesnitch/core/storage')
    const key = 'devices/5A43CA48/sessions/abc/trace.csv'
    const exp = Date.now() + 60_000
    const q = new URLSearchParams({ key, exp: String(exp), sig: devPresignSignature(key, exp) })
    const res = await downloadFirmware(new Request(`http://localhost:3000/api/devices/firmware/download?${q}`))
    expect(res.status).toBe(404)
  })
})

describe('POST /api/devices/firmware/ack', () => {
  const ackReq = (t: string, body: unknown) =>
    new Request('http://localhost:3000/api/devices/firmware/ack', {
      method: 'POST', body: JSON.stringify(body),
      headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
    })

  it('records a successful boot and is idempotent on retry', async () => {
    const u = await makeUser('FW Eight')
    const t = await boundToken(u)

    const first = await ackFirmware(ackReq(t, { version: '0.10.0', previousVersion: '0.9.0', bootOk: true, resetReason: 'SW_RESET' }))
    expect(first.status).toBe(204)

    // The ack rides on a sync, and a sync can fail — a retry must not create a
    // second record or double-count the metric.
    const second = await ackFirmware(ackReq(t, { version: '0.10.0', previousVersion: '0.9.0', bootOk: true }))
    expect(second.status).toBe(204)

    const events = await listDeviceFirmwareEvents(DEVICE)
    expect(events).toHaveLength(1)
    expect(events[0].booted).toMatchObject({ bootOk: true, rolledBack: false, fromVersion: '0.9.0', resetReason: 'SW_RESET' })
  })

  it('never counts a rollback as a successful boot, even if the device claims both', async () => {
    const u = await makeUser('FW Nine')
    const t = await boundToken(u)
    await ackFirmware(ackReq(t, { version: '0.10.0', bootOk: true, rolledBack: true }))
    const [row] = await listDeviceFirmwareEvents(DEVICE)
    expect(row.booted).toMatchObject({ bootOk: false, rolledBack: true })
  })

  it('400s a version that is not a semver', async () => {
    const u = await makeUser('FW Ten')
    const t = await boundToken(u)
    expect((await ackFirmware(ackReq(t, { version: '../evil', bootOk: true }))).status).toBe(400)
    expect((await ackFirmware(ackReq(t, { bootOk: true }))).status).toBe(400)
  })

  it('401s without a device token', async () => {
    const res = await ackFirmware(new Request('http://localhost:3000/api/devices/firmware/ack', {
      method: 'POST', body: '{}', headers: { 'content-type': 'application/json' },
    }))
    expect(res.status).toBe(401)
  })
})

describe('the X-PS-Firmware signal', () => {
  const csv = [
    'timestamp,lat,lon,fix',
    '2026-09-19T09:00:00Z,51.4600,-0.9300,1',
    '2026-09-19T09:00:01Z,51.4601,-0.9301,1',
  ].join('\n')

  const upload = (t: string, filename: string) =>
    new Request(`http://localhost:3000/api/devices/sessions?filename=${filename}`, {
      method: 'POST', body: csv,
      headers: { authorization: `Bearer ${t}`, 'content-type': 'text/csv' },
    })

  it('rides on the upload the device was making anyway', async () => {
    const u = await makeUser('FW Signal')
    const t = await boundToken(u)
    await publishFirmware('0.10.0', IMAGE, { notes: 'n' })
    await promoteFirmware('stable', '0.10.0')

    const res = await uploadSession(upload(t, 'track_0001.csv'))
    expect(res.status).toBe(201)
    // This header is the entire OTA signal — without it the device would have
    // to poll, which is exactly what the design avoids.
    expect(res.headers.get('X-PS-Firmware')).toBe('0.10.0')
  })

  it('is absent when nothing is promoted, rather than claiming the device is current', async () => {
    const u = await makeUser('FW Signal Two')
    const t = await boundToken(u)
    const res = await uploadSession(upload(t, 'track_0002.csv'))
    expect(res.status).toBe(201)
    expect(res.headers.get('X-PS-Firmware')).toBeNull()
  })

  it('is stamped on error responses too, so a failing sync still learns about an update', async () => {
    const u = await makeUser('FW Signal Three')
    const t = await boundToken(u)
    await publishFirmware('0.10.0', IMAGE, { notes: 'n' })
    await promoteFirmware('stable', '0.10.0')

    // A bad filename: one of the fourteen early returns in the upload route.
    const res = await uploadSession(upload(t, 'not a valid filename!'))
    expect(res.status).toBe(400)
    expect(res.headers.get('X-PS-Firmware')).toBe('0.10.0')
  })

  it('is stamped on a 401, which is how a re-claiming device still sees the version', async () => {
    await publishFirmware('0.10.0', IMAGE, { notes: 'n' })
    await promoteFirmware('stable', '0.10.0')
    const res = await uploadSession(upload('not-a-real-token', 'track_0003.csv'))
    expect(res.status).toBe(401)
    expect(res.headers.get('X-PS-Firmware')).toBe('0.10.0')
  })
})

describe('GET /api/admin/devices/:deviceId/firmware-events', () => {
  const params = (deviceId: string) => ({ params: Promise.resolve({ deviceId }) })
  const req = () => new Request(`http://localhost:3000/api/admin/devices/${DEVICE}/firmware-events`)

  it('401s signed out and 403s a signed-in non-admin', async () => {
    const u = await makeUser('Not An Admin')
    mockAuth(null)
    expect((await adminEvents(req(), params(DEVICE))).status).toBe(401)
    mockAuth(u.idToken)
    expect((await adminEvents(req(), params(DEVICE))).status).toBe(403)
  })

  it('refuses a device token — a stolen tracker must not read the fleet', async () => {
    // The route reads cookies only; a Bearer header is simply not an identity
    // here. This is the getAuthUser / getDeviceAuth separation, asserted.
    const u = await makeUser('Device Holder')
    const t = await boundToken(u)
    mockAuth(null)
    const res = await adminEvents(
      new Request(`http://localhost:3000/api/admin/devices/${DEVICE}/firmware-events`, {
        headers: { authorization: `Bearer ${t}` },
      }),
      params(DEVICE),
    )
    expect(res.status).toBe(401)
  })

  it('returns the history to an admin and writes an audit line', async () => {
    const u = await makeUser('Real Admin')
    process.env.ADMIN_USER_IDS = `someone-else,${u.id}`
    await recordFirmwareBooted(DEVICE, '0.10.0', {
      at: '2026-09-19T10:00:00Z', fromVersion: '0.9.0', bootOk: true, rolledBack: false,
    })

    const logged: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logged.push(String(a[0])) })

    mockAuth(u.idToken)
    const res = await adminEvents(req(), params(DEVICE))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deviceId).toBe(DEVICE)
    expect(body.events[0]).toMatchObject({ version: '0.10.0', booted: { bootOk: true } })

    // The audit line is the part of this route that actually matters — reading
    // across accounts should leave a trace, including when it is the owner.
    const audit = logged.map(l => { try { return JSON.parse(l) } catch { return null } })
      .find(o => o?.audit === 'admin.firmware_events.read')
    expect(audit).toMatchObject({ actorId: u.id, actorEmail: u.email, deviceId: DEVICE })
  })

  it('400s a malformed device id', async () => {
    const u = await makeUser('Admin Two')
    process.env.ADMIN_USER_IDS = u.id
    mockAuth(u.idToken)
    expect((await adminEvents(req(), params('not-a-device'))).status).toBe(400)
  })

  it('an unset ADMIN_USER_IDS means nobody, not everybody', async () => {
    const u = await makeUser('Admin Three')
    delete process.env.ADMIN_USER_IDS
    mockAuth(u.idToken)
    expect((await adminEvents(req(), params(DEVICE))).status).toBe(403)
  })
})
