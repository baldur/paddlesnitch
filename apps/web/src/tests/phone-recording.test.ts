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
import { isPhoneId, isTrackerId, isDeviceId, phoneDeviceId, listUserDevices, listUserDeviceSessions, MAX_PHONES, addPhone, exportUserDevices, eraseUserDevices } from '@/lib/devices'
import { isPhoneDeviceId, trackerSummaries } from '@/lib/device-view'
import { deviceList } from '@/lib/device-list'
import { listKeys } from '@/lib/storage'
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

  it('never lets a phone ID start a tracker claim', async () => {
    const u = await makeUser('Claimer')
    const id = phoneDeviceId(u.id, INSTALL)
    expect(isTrackerId(id)).toBe(false)
    expect(isDeviceId(id)).toBe(true)
    const res = await claim(new Request('http://x/api/devices/claim', { method: 'POST', body: JSON.stringify({ deviceId: id, model: 'm', firmware: 'f' }), headers: { 'content-type': 'application/json' } }))
    expect(res.status).toBe(400)
  })

  it('the browser-safe phone test agrees with the server one', () => {
    for (const id of ['P0123456789A', 'PABCDEF01234', '435AC17C', 'P0123456789a', 'P0123456789', 'Q0123456789A', 'P0123456789AB']) {
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
    const [card] = trackerSummaries([], [{ sessionId: 's', deviceId: 'P0123456789A', userId: 'u', filename: NAME, uploadedAt: '2026-11-01T07:00:00Z', points: 3 }], null)
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
