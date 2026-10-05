// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash, createHmac, randomBytes } from 'crypto'
import { deflateSync } from 'zlib'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { POST as relay } from '@/app/api/account/devices/[deviceId]/sessions/route'
import { POST as linkBluetooth } from '@/app/api/account/devices/link-bluetooth/route'
import { listUserDeviceSessions, uploadReceipt } from '@/lib/devices'
import { cookies } from 'next/headers'

// Recordings home over Bluetooth (docs/features/tracker-bluetooth-sync.md): the
// owner's browser reads a recording off the tracker and uploads it AS THE
// SIGNED-IN USER -- the tracker's token never crosses Bluetooth. The answer
// carries a receipt the tracker can check (HMAC keyed with sha256 of its own
// token), and only then does the tracker mark the recording sent.

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir); vi.restoreAllMocks() })

function mockAuth(idToken: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name === 'tt_id' && idToken ? { name, value: idToken } : undefined),
  } as ReturnType<typeof cookies> extends Promise<infer T> ? T : never)
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const DEVICE = '435AC17C'
const TRACK = [
  'timestamp,lat,lon,tx_seq',
  '2026-10-05T06:10:02Z,51.4600,-0.9300,1',
  '2026-10-05T06:10:03Z,51.4601,-0.9301,2',
  '2026-10-05T06:10:04Z,51.4602,-0.9302,3',
].join('\n')
const NAME = 'track_20261005_061002.csv'
const params = (p: { deviceId: string }) => ({ params: Promise.resolve(p) })
const post = (qs: string, body: Buffer | string, type = 'text/csv') =>
  new Request(`http://x/api/account/devices/${DEVICE}/sessions?${qs}`, { method: 'POST', body: body as BodyInit, headers: { 'content-type': type } })

async function ownerWithTracker() {
  const u = await makeUser('Relay Owner')
  mockAuth(u.idToken)
  const token = randomBytes(32).toString('base64url')
  await linkBluetooth(new Request('http://x', { method: 'POST', body: JSON.stringify({ deviceId: DEVICE, tokenHash: sha(token), model: 'm', firmware: 'f' }), headers: { 'content-type': 'application/json' } }))
  return { u, token }
}

describe('uploading a recording relayed over Bluetooth', () => {
  it("stores it as the tracker's recording and answers with a receipt the tracker can check", async () => {
    const { u, token } = await ownerWithTracker()
    const res = await relay(post(`filename=${NAME}`, TRACK), params({ deviceId: DEVICE }))
    expect(res.status).toBe(201)
    const b = await res.json()
    expect(b.points).toBe(3)
    // What the tracker computes from its own token: HMAC-SHA256 keyed with the
    // hex sha256 of the token, over "ps-receipt:v1|<id>|<file>".
    const expected = createHmac('sha256', sha(token)).update(`ps-receipt:v1|${DEVICE}|${NAME}`).digest('hex')
    expect(b.receipt).toBe(expected)
    expect(uploadReceipt(sha(token), DEVICE, NAME)).toBe(expected)
    expect((await listUserDeviceSessions(u.id)).map(s => s.filename)).toEqual([NAME])
  })

  it('gives the receipt again for a recording already uploaded, so a lost answer is not sent for ever', async () => {
    await ownerWithTracker()
    await relay(post(`filename=${NAME}`, TRACK), params({ deviceId: DEVICE }))
    const again = await relay(post(`filename=${NAME}`, TRACK), params({ deviceId: DEVICE }))
    expect(again.status).toBe(409)
    const b = await again.json()
    expect(b.error).toBe('already_uploaded')
    expect(b.receipt).toMatch(/^[0-9a-f]{64}$/)
  })

  it('takes compressed pieces like the tracker sends over WiFi', async () => {
    await ownerWithTracker()
    const res = await relay(post(`filename=${NAME}&part=1&parts=1&enc=zlib`, deflateSync(Buffer.from(TRACK)), 'application/octet-stream'), params({ deviceId: DEVICE }))
    expect(res.status).toBe(201)
  })

  it("won't take recordings for someone else's tracker (404, not revealing it exists)", async () => {
    await ownerWithTracker()
    const other = await makeUser('Not The Owner')
    mockAuth(other.idToken)
    expect((await relay(post(`filename=${NAME}`, TRACK), params({ deviceId: DEVICE }))).status).toBe(404)
  })

  it('needs a signed-in user', async () => {
    mockAuth(null)
    expect((await relay(post(`filename=${NAME}`, TRACK), params({ deviceId: DEVICE }))).status).toBe(401)
  })
})
