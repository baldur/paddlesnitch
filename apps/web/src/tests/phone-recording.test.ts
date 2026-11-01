// @vitest-environment node
// A phone that records (C3, mobile/contract/README.md § Phone recording): the
// app adds its phone to the account, then uploads each recording as its owner
// through the tracker's own upload handling. The recording becomes a paddle
// with stroke rate, and export and erasure cover it like a tracker's.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'
import { sidecar, trackCsv } from './tracker-fixtures'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@paddlesnitch/timing/weather', () => ({ getWeatherAt: async () => null }))
vi.mock('@paddlesnitch/analysis/llm', () => ({ generateInsight: async () => null }))
vi.mock('@paddlesnitch/timing/river-flow', () => ({ getFlowAt: () => Promise.resolve(null) }))

import { cookies } from 'next/headers'
import { POST as addPhoneRoute } from '@/app/api/account/devices/phone/route'
import { POST as upload } from '@/app/api/account/devices/[deviceId]/sessions/route'
import { DELETE as removeDevice } from '@/app/api/account/devices/route'
import { POST as claim } from '@/app/api/devices/claim/route'
import { POST as tokenRoute } from '@/app/api/devices/token/route'
import { POST as linkBluetooth } from '@/app/api/account/devices/link-bluetooth/route'
import { GET as stagedParts } from '@/app/api/account/devices/[deviceId]/sessions/route'
import { createHash } from 'crypto'
import { Uploaded } from '@paddlesnitch/api/contract'
import { publishFirmware, promoteFirmware } from '@/lib/firmware'
import { deflateSync } from 'zlib'
import { TEST_DEVICE_PUBKEY, linkProof } from './device-proof'
import { isPhoneId, isTrackerId, isDeviceId, phoneDeviceId, listUserDevices, listUserDeviceSessions, MAX_PHONES, addPhone, exportUserDevices, eraseUserDevices, redeemToken, enrolDeviceKey, linkByTokenHash, revokeDevice, getUserDevice } from '@/lib/devices'
import { isPhoneDeviceId, trackerSummaries } from '@/lib/device-view'
import { deviceList } from '@/lib/device-list'
import { listKeys, putJson, getJson } from '@/lib/storage'
import { runJob } from '@/lib/jobs'
import { trackerPaddleId } from '@paddlesnitch/analysis/tracker-paddle'
import { getSession } from '@paddlesnitch/analysis/analysis-store'

let dataDir: string
beforeEach(async () => {
  dataDir = await makeDataDir()
  // Apps send no cookie: only the Bearer token signs them in.
  vi.mocked(cookies).mockResolvedValue({ get: () => undefined, set: () => {}, delete: () => {} } as unknown as Awaited<ReturnType<typeof cookies>>)
})
afterEach(async () => { await cleanDataDir(dataDir) })

const INSTALL = 'install-0123456789abcdef'
const NAME = 'track_20261101_070000.csv'
const TRACK = trackCsv(300, 9, { startMs: 400_000 })
const MOTION = sidecar({ seconds: 300, hz: 10, strokesPerMin: 56, startMs: 400_000 })

const req = (url: string, token: string | null, init: { method?: string; body?: BodyInit; type?: string } = {}) =>
  new NextRequest(`http://x${url}`, {
    method: init.method ?? 'POST',
    body: init.body,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': init.type ?? 'application/json',
      'x-paddlesnitch-app': 'android/0.1.0',
    },
  })
const params = (deviceId: string) => ({ params: Promise.resolve({ deviceId }) })
const add = (token: string | null, body: object = { installId: INSTALL, model: 'phone-android' }) =>
  addPhoneRoute(req('/api/account/devices/phone', token, { body: JSON.stringify(body) }))
const send = (token: string, deviceId: string, filename: string, body: string) =>
  upload(req(`/api/account/devices/${deviceId}/sessions?filename=${filename}`, token, { body, type: 'text/csv' }), params(deviceId))
const runJobs = async () => { for (const k of await listKeys('jobs/tracker-paddle/')) expect(await runJob(k)).toBe('done') }

describe('adding a phone to the account', () => {
  it('adds it once: the same install asked again is the same phone', async () => {
    const u = await makeUser('Phone Owner')
    const first = await add(u.idToken)
    expect(first.status).toBe(201)
    const phone = await first.json()
    expect(phone).toEqual({ deviceId: phoneDeviceId(u.id, INSTALL), name: 'Android phone', model: 'phone-android' })
    expect(isPhoneId(phone.deviceId)).toBe(true)
    expect((await (await add(u.idToken)).json()).deviceId).toBe(phone.deviceId)
    expect((await listUserDevices(u.id)).map(d => d.deviceId)).toEqual([phone.deviceId])
  })

  it('makes a different phone for the same install on another account', async () => {
    const a = await makeUser('A'), b = await makeUser('B')
    expect((await (await add(a.idToken)).json()).deviceId).not.toBe((await (await add(b.idToken)).json()).deviceId)
  })

  it('names an iPhone as one', async () => {
    const u = await makeUser('iPhone Owner')
    expect((await (await add(u.idToken, { installId: INSTALL, model: 'phone-ios' })).json()).name).toBe('iPhone')
  })

  it('refuses a bad install ID or model, and anyone not signed in', async () => {
    const u = await makeUser('Careless')
    expect((await add(u.idToken, { installId: 'short', model: 'phone-android' })).status).toBe(400)
    expect((await add(u.idToken, { installId: INSTALL, model: 'tracker' })).status).toBe(400)
    expect((await add(u.idToken, { installId: '../../devices/x/metadata', model: 'phone-ios' })).status).toBe(400)
    expect((await add(null)).status).toBe(401)
  })

  it(`stops at ${MAX_PHONES} phones, with words to show`, async () => {
    const u = await makeUser('Many Phones')
    for (let i = 0; i < MAX_PHONES; i++) expect('error' in await addPhone(u.id, { installId: `install-number-${String(i).padStart(4, '0')}`, model: 'phone-ios' })).toBe(false)
    const res = await add(u.idToken)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/Remove one on Devices/)
  })

  it("never takes over another account's phone record, even on a matching ID", async () => {
    const victim = await makeUser('Victim'), attacker = await makeUser('Attacker')
    // As if the attacker had found an install ID whose ID lands on the victim's phone:
    // the record at that ID belongs to the victim.
    const deviceId = phoneDeviceId(attacker.id, INSTALL)
    const record = { deviceId, userId: victim.id, name: 'iPhone', model: 'phone-ios', firmware: '', linkedAt: '2026-11-01T07:00:00Z', lastSeenAt: '2026-11-01T07:00:00Z', tokenHash: '' }
    await putJson(`devices/${deviceId}/metadata.json`, record)
    const res = await add(attacker.idToken)
    expect(res.status).toBe(400)
    expect(await getJson(`devices/${deviceId}/metadata.json`)).toEqual(record)
    expect(await listUserDevices(attacker.id)).toEqual([])
  })

  it('never lets a phone ID start a tracker claim', async () => {
    const u = await makeUser('Claimer')
    const id = phoneDeviceId(u.id, INSTALL)
    expect(isTrackerId(id)).toBe(false)
    expect(isDeviceId(id)).toBe(true)
    const res = await claim(new Request('http://x/api/devices/claim', { method: 'POST', body: JSON.stringify({ deviceId: id, model: 'm', firmware: 'f' }), headers: { 'content-type': 'application/json' } }))
    expect(res.status).toBe(400)
  })

  it('the browser-safe phone test agrees with the server one', () => {
    for (const id of ['P0123456789ABCDEF', 'PABCDEF0123456789', '435AC17C', 'P0123456789abcdef', 'P0123456789ABCDE', 'Q0123456789ABCDEF', 'P0123456789ABCDEF0', 'P0123456789A']) {
      expect(isPhoneDeviceId(id)).toBe(isPhoneId(id))
    }
  })
})

describe('uploading a phone recording', () => {
  it('becomes a paddle with stroke rate, and the answer carries no receipt', async () => {
    const u = await makeUser('Phone Paddler')
    const { deviceId } = await (await add(u.idToken)).json()

    const track = await send(u.idToken, deviceId, NAME, TRACK)
    expect(track.status).toBe(201)
    const t = await track.json()
    expect(t.points).toBeGreaterThan(0)
    expect(t).not.toHaveProperty('receipt')
    // The motion file goes under the tracker's upload name, `_imu.csv`.
    const motion = await send(u.idToken, deviceId, NAME.replace('.csv', '_imu.csv'), MOTION)
    expect(motion.status).toBe(201)
    await runJobs()

    const [rec] = await listUserDeviceSessions(u.id)
    expect(rec.deviceId).toBe(deviceId)
    expect(rec.motion?.rows).toBeGreaterThan(0)
    const paddle = (await getSession(u.id, trackerPaddleId(rec.sessionId)))!
    expect(paddle.source).toEqual({ type: 'device', deviceId, deviceSessionId: rec.sessionId })
    expect(paddle.result.avgSR).toBeGreaterThan(52)
    expect(paddle.result.avgSR).toBeLessThan(60)
  })

  it('answers 409 already_uploaded for a repeat, so the app can delete its copy', async () => {
    const u = await makeUser('Retrier')
    const { deviceId } = await (await add(u.idToken)).json()
    await send(u.idToken, deviceId, NAME, TRACK)
    const again = await send(u.idToken, deviceId, NAME, TRACK)
    expect(again.status).toBe(409)
    expect((await again.json()).error).toBe('already_uploaded')
  })

  it("won't take a recording for someone else's phone (404)", async () => {
    const owner = await makeUser('Owner'), other = await makeUser('Other')
    const { deviceId } = await (await add(owner.idToken)).json()
    expect((await send(other.idToken, deviceId, NAME, TRACK)).status).toBe(404)
    expect(await listUserDeviceSessions(other.id)).toEqual([])
  })

  it('a removed phone gets 404 until the app adds it again, then the same phone with its recordings', async () => {
    const u = await makeUser('Remover')
    const { deviceId } = await (await add(u.idToken)).json()
    await send(u.idToken, deviceId, NAME, TRACK)
    const rm = await removeDevice(req('/api/account/devices', u.idToken, { method: 'DELETE', body: JSON.stringify({ deviceId }) }))
    expect(rm.status).toBe(200)
    expect((await send(u.idToken, deviceId, 'track_20261101_080000.csv', TRACK)).status).toBe(404)
    // Its recordings stay the owner's.
    expect(await listUserDeviceSessions(u.id)).toHaveLength(1)
    expect((await (await add(u.idToken)).json()).deviceId).toBe(deviceId)
    expect((await send(u.idToken, deviceId, 'track_20261101_080000.csv', TRACK)).status).toBe(201)
  })
})

describe('a phone on Devices', () => {
  it('is a phone card: never quiet, no firmware state', async () => {
    const u = await makeUser('Card Owner')
    const { deviceId } = await (await add(u.idToken)).json()
    const { summaries, devices } = await deviceList(u.id)
    expect(summaries).toEqual([expect.objectContaining({ deviceId, kind: 'phone', name: 'Android phone', quiet: false, firmwareState: 'unknown' })])
    expect(devices[0]).not.toHaveProperty('tokenHash')
    // Silent for a week: still not quiet.
    const week = Date.now() + 7 * 24 * 3600_000
    expect(trackerSummaries(devices, [], null, week)[0].quiet).toBe(false)
  })

  it('a removed phone with recordings is called Phone', () => {
    const [card] = trackerSummaries([], [{ sessionId: 's', deviceId: 'P0123456789ABCDEF', userId: 'u', filename: NAME, uploadedAt: '2026-11-01T07:00:00Z', points: 3 }], null)
    expect(card).toMatchObject({ name: 'Phone', kind: 'phone', linked: false })
  })
})

describe('personal data', () => {
  it('the export lists the phone and its recordings; erasure removes both', async () => {
    const u = await makeUser('Leaver')
    const { deviceId } = await (await add(u.idToken)).json()
    await send(u.idToken, deviceId, NAME, TRACK)
    await send(u.idToken, deviceId, NAME.replace('.csv', '_imu.csv'), MOTION)

    const exported = await exportUserDevices(u.id)
    expect(exported.trackers.map(d => d.deviceId)).toEqual([deviceId])
    expect(exported.trackers[0]).not.toHaveProperty('tokenHash')
    expect(exported.recordings.map(r => r.filename)).toEqual([NAME])

    // What DELETE /api/account runs for devices (account-data-complete.test.ts checks it does).
    await eraseUserDevices(u.id)
    expect(await listKeys(`devices/${deviceId}/`)).toEqual([])
    expect(await listUserDevices(u.id)).toEqual([])
  })
})

describe('a phone ID never reaches a tracker-only path', () => {
  it('claim, token, key enrolment and linking by token all refuse it', async () => {
    const u = await makeUser('Prober')
    const id = phoneDeviceId(u.id, INSTALL)
    const hash = createHash('sha256').update('token').digest('hex')
    const json = (body: object) => new Request('http://x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
    expect((await tokenRoute(json({ deviceId: id, claimSecret: 's' }))).status).toBe(202)
    expect(await redeemToken(id, 's')).toEqual({ status: 'pending' })
    expect(await enrolDeviceKey(id, TEST_DEVICE_PUBKEY, 'cable')).toBe(false)
    expect(await linkByTokenHash(u.id, { deviceId: id, tokenHash: hash, model: 'm', firmware: 'f', signature: await linkProof(id, hash) })).toEqual({ error: 'bad_request' })
    const req2 = new NextRequest('http://x/api/account/devices/link-bluetooth', { method: 'POST', body: JSON.stringify({ deviceId: id, tokenHash: hash, model: 'm', firmware: 'f' }), headers: { authorization: `Bearer ${u.idToken}`, 'content-type': 'application/json' } })
    expect((await linkBluetooth(req2)).status).toBe(400)
    expect(await getUserDevice(u.id, id)).toBeNull()
  })
})

describe('the phone limit', () => {
  const fill = async (userId: string) => { for (let i = 0; i < MAX_PHONES; i++) await addPhone(userId, { installId: `install-number-${String(i).padStart(4, '0')}`, model: 'phone-ios' }) }
  it('a full account can still add a phone it already has', async () => {
    const u = await makeUser('Full')
    await fill(u.id)
    expect(await addPhone(u.id, { installId: 'install-number-0003', model: 'phone-ios' })).not.toHaveProperty('error')
  })
  it('removing one makes room', async () => {
    const u = await makeUser('Tidy')
    await fill(u.id)
    await revokeDevice(u.id, phoneDeviceId(u.id, 'install-number-0000'))
    expect((await add(u.idToken)).status).toBe(201)
  })
})

describe('a phone upload, the rest of the contract', () => {
  it("doesn't let headers change the phone's model or firmware", async () => {
    const u = await makeUser('Headers')
    const { deviceId } = await (await add(u.idToken)).json()
    const r = new NextRequest(`http://x/api/account/devices/${deviceId}/sessions?filename=${NAME}`, {
      method: 'POST', body: TRACK,
      headers: { authorization: `Bearer ${u.idToken}`, 'content-type': 'text/csv', 'x-device-model': 'lilygo', 'x-device-firmware': '9.9.9', 'x-paddlesnitch-app': 'ios/0.1.0' },
    })
    expect((await upload(r, params(deviceId))).status).toBe(201)
    expect(await getUserDevice(u.id, deviceId)).toMatchObject({ model: 'phone-android', firmware: '' })
  })

  it('takes compressed 64 KB pieces, says which it holds, and puts the file together', async () => {
    const u = await makeUser('Chunks')
    const { deviceId } = await (await add(u.idToken)).json()
    const whole = Buffer.from(trackCsv(3600, 9, { startMs: 400_000 }))
    const piece = 64 * 1024
    const pieces = Math.ceil(whole.length / piece)
    expect(pieces).toBeGreaterThan(1)
    const sha = createHash('sha256').update(whole).digest('hex')
    const send1 = (n: number) => upload(new NextRequest(`http://x/api/account/devices/${deviceId}/sessions?filename=${NAME}&part=${n}&parts=${pieces}&sha256=${sha}&enc=zlib`, {
      method: 'POST', body: deflateSync(whole.subarray((n - 1) * piece, n * piece)),
      headers: { authorization: `Bearer ${u.idToken}`, 'content-type': 'application/octet-stream' },
    }), params(deviceId))
    const first = await send1(1)
    expect(first.status).toBe(202)
    expect(Uploaded.safeParse(await first.json()).error?.issues).toBeUndefined()
    const held = await stagedParts(new NextRequest(`http://x/api/account/devices/${deviceId}/sessions?filename=${NAME}`, { headers: { authorization: `Bearer ${u.idToken}` } }), params(deviceId))
    expect((await held.json()).parts).toEqual([1])
    let last: Response | undefined
    for (let n = 2; n <= pieces; n++) last = await send1(n)
    expect(last!.status).toBe(201)
    expect(await listUserDeviceSessions(u.id)).toHaveLength(1)
  })

  it('refuses a motion file before its track (409 track_not_uploaded) and a track with no fix (422 no_points)', async () => {
    const u = await makeUser('Order')
    const { deviceId } = await (await add(u.idToken)).json()
    const early = await send(u.idToken, deviceId, NAME.replace('.csv', '_imu.csv'), MOTION)
    expect(early.status).toBe(409)
    expect((await early.json()).error).toBe('track_not_uploaded')
    const noFix = await send(u.idToken, deviceId, 'track_20261101_090000.csv', 'timestamp,lat,lon,tx_seq\n,,,1\n,,,2\n')
    expect(noFix.status).toBe(422)
    expect((await noFix.json()).error).toBe('no_points')
  })

  it("a phone's Tracker entry has no target version, even with a stable release", async () => {
    const u = await makeUser('Versions')
    await add(u.idToken)
    await publishFirmware('0.10.0', Buffer.from('a fake image'), { notes: 'n' })
    expect(await promoteFirmware('stable', '0.10.0')).toBe('ok')
    const { devices, stableVersion } = await deviceList(u.id)
    expect(stableVersion).toBe('0.10.0')
    expect(devices[0].targetVersion).toBeNull()
    expect(devices[0]).not.toHaveProperty('beta')
    expect(devices[0]).not.toHaveProperty('health')
  })
})
