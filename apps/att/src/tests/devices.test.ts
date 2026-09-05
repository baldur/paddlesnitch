// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { POST as claim } from '@/app/api/devices/claim/route'
import { POST as token } from '@/app/api/devices/token/route'
import { POST as link } from '@/app/api/account/devices/link/route'
import { GET as listDevices, DELETE as revokeDevice } from '@/app/api/account/devices/route'
import { POST as uploadSession } from '@/app/api/devices/sessions/route'
import { getDeviceAuth } from '@/lib/auth'
import { createClaim, linkClaim } from '@/lib/devices'
import { cookies } from 'next/headers'

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir); vi.restoreAllMocks() })

function mockAuth(idToken: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name === 'tt_id' && idToken ? { name, value: idToken } : undefined),
  } as ReturnType<typeof cookies> extends Promise<infer T> ? T : never)
}
const jreq = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } })
const bearer = (t: string) => new Request('http://x', { headers: { authorization: `Bearer ${t}` } })

const DEVICE = '5A43CA48'

describe('device pairing (#212 device-uplink)', () => {
  it('claim → link → token issues a token exactly once; a second token call is 410', async () => {
    const u = await makeUser('Device Owner')

    const claimRes = await claim(jreq({ deviceId: DEVICE, model: 'lilygo-tbeam-s3-supreme', firmware: '0.3.0' }))
    expect(claimRes.status).toBe(200)
    const { claimCode, claimSecret } = await claimRes.json()
    expect(claimCode).toMatch(/^[0-9A-HJ-NP-Z]{6}$/) // safe alphabet, no 0/O/1/I/U/V

    // before the user enters the code, the correct secret still only gets "pending"
    const early = await token(jreq({ deviceId: DEVICE, claimSecret }))
    expect(early.status).toBe(202)

    mockAuth(u.idToken)
    const linkRes = await link(jreq({ claimCode, name: "Baldur's tracker" }))
    expect(linkRes.status).toBe(200)
    expect((await linkRes.json()).deviceId).toBe(DEVICE)

    const tok = await token(jreq({ deviceId: DEVICE, claimSecret }))
    expect(tok.status).toBe(200)
    const body = await tok.json()
    expect(body.deviceToken).toBeTruthy()
    expect(body.userId).toBe(u.id)

    // consumed — a retry after the claim is gone returns 410
    const again = await token(jreq({ deviceId: DEVICE, claimSecret }))
    expect(again.status).toBe(410)
  })

  it('a wrong claimSecret returns 202 (pending), never revealing the claim exists', async () => {
    const u = await makeUser('Owner Two')
    const { claimCode, claimSecret } = await (await claim(jreq({ deviceId: DEVICE, model: 'm', firmware: 'f' }))).json()
    mockAuth(u.idToken)
    await link(jreq({ claimCode }))
    const res = await token(jreq({ deviceId: DEVICE, claimSecret: `${claimSecret}tampered` }))
    expect(res.status).toBe(202)
    expect((await res.json()).status).toBe('pending')
  })

  it('an expired claim is 410 from token and rejected by link (mock the clock)', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-05T12:00:00Z'))
      const forToken = await createClaim(DEVICE, 'm', 'f')
      const forLink = await createClaim(DEVICE, 'm', 'f')
      vi.setSystemTime(new Date('2026-09-05T12:11:00Z')) // +11 min, past the 10-min TTL

      const tok = await token(jreq({ deviceId: DEVICE, claimSecret: forToken.claimSecret }))
      expect(tok.status).toBe(410)

      const linkErr = await linkClaim(forLink.claimCode, 'user-x')
      expect(linkErr).toEqual({ error: 'claim_expired' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('getDeviceAuth resolves a valid token and rejects a revoked / missing one; it never reads cookies', async () => {
    const u = await makeUser('Owner Three')
    const { claimCode, claimSecret } = await (await claim(jreq({ deviceId: DEVICE, model: 'm', firmware: 'f' }))).json()
    mockAuth(u.idToken)
    await link(jreq({ claimCode }))
    const { deviceToken } = await (await token(jreq({ deviceId: DEVICE, claimSecret }))).json()

    // valid bearer → device principal
    expect(await getDeviceAuth(bearer(deviceToken))).toEqual({ deviceId: DEVICE, userId: u.id })
    // no header / unknown token → null (a device token is not a browser session)
    expect(await getDeviceAuth(new Request('http://x'))).toBeNull()
    expect(await getDeviceAuth(bearer('not-a-real-token'))).toBeNull()

    // the device shows up in the owner's list
    mockAuth(u.idToken)
    const list = await (await listDevices()).json()
    expect(list.devices.map((d: { deviceId: string }) => d.deviceId)).toContain(DEVICE)

    // revoke → the token stops working
    mockAuth(u.idToken)
    expect((await revokeDevice(jreq({ deviceId: DEVICE }))).status).toBe(200)
    expect(await getDeviceAuth(bearer(deviceToken))).toBeNull()
  })

  it('rejects a malformed deviceId at claim', async () => {
    expect((await claim(jreq({ deviceId: 'nope', model: 'm', firmware: 'f' }))).status).toBe(400)
  })
})

// Mint a real device token via the pairing flow, so upload tests use the same
// auth path a device would.
async function boundToken(u: { id: string; idToken: string }): Promise<string> {
  const { claimCode, claimSecret } = await (await claim(jreq({ deviceId: DEVICE, model: 'm', firmware: 'f' }))).json()
  mockAuth(u.idToken)
  await link(jreq({ claimCode }))
  return (await (await token(jreq({ deviceId: DEVICE, claimSecret }))).json()).deviceToken
}
const csvReq = (filename: string, csv: string, deviceToken: string) =>
  new Request(`http://x/api/devices/sessions?filename=${filename}`, {
    method: 'POST', body: csv, headers: { authorization: `Bearer ${deviceToken}`, 'content-type': 'text/csv' },
  })

const DEVICE_CSV = [
  'timestamp,lat,lon,tx_seq,battery',
  '2026-09-05T09:00:00Z,51.4600,-0.9300,1,4.05',
  '2026-09-05T09:00:01Z,51.4601,-0.9301,2,4.05',
  '2026-09-05T09:00:02Z,51.4602,-0.9302,3,4.04',
  '2026-09-05T09:00:03Z,51.4603,-0.9303,4,4.04',
].join('\n')

describe('device session upload (device-uplink P2)', () => {
  it('device CSV parses without a device-specific parser', async () => {
    const u = await makeUser('Uploader')
    const dt = await boundToken(u)
    const res = await uploadSession(csvReq('track_0005.csv', DEVICE_CSV, dt))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.points).toBe(4)
    expect(body.sessionId).toBeTruthy()
    expect(body.distanceMetres).toBeGreaterThan(0)
  })

  it('unfixed rows do not become Null Island points', async () => {
    const u = await makeUser('Indoor')
    const dt = await boundToken(u)
    const indoor = 'timestamp,lat,lon,tx_seq\n,,,\n,,,\n' // no GPS fix → empty lat/lon
    const res = await uploadSession(csvReq('track_0001.csv', indoor, dt))
    expect(res.status).toBe(422) // no usable points; device marks uploaded and stops retrying
  })

  it('re-uploading the same deviceId+filename returns 409 and does not duplicate', async () => {
    const u = await makeUser('Retry')
    const dt = await boundToken(u)
    expect((await uploadSession(csvReq('track_0007.csv', DEVICE_CSV, dt))).status).toBe(201)
    expect((await uploadSession(csvReq('track_0007.csv', DEVICE_CSV, dt))).status).toBe(409)
  })

  it('rejects an unknown/absent device token with 401', async () => {
    expect((await uploadSession(csvReq('track_0001.csv', DEVICE_CSV, 'bogus'))).status).toBe(401)
  })
})
