// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash, randomBytes } from 'crypto'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { POST as linkBluetooth } from '@/app/api/account/devices/link-bluetooth/route'
import { POST as claim } from '@/app/api/devices/claim/route'
import { POST as token } from '@/app/api/devices/token/route'
import { POST as link } from '@/app/api/account/devices/link/route'
import { getDeviceAuth } from '@/lib/auth'
import { getJson } from '@/lib/storage'
import { cookies } from 'next/headers'

// Setting a tracker up over Bluetooth (docs/features/tracker-bluetooth-sync.md,
// "Linking over Bluetooth"). The tracker makes its own token and hands the page
// only its hash; the page registers the hash for the signed-in user. The token
// never leaves the tracker, and the server stores only the hash -- exactly
// what it stores after linking by code.

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir); vi.restoreAllMocks() })

function mockAuth(idToken: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name === 'tt_id' && idToken ? { name, value: idToken } : undefined),
  } as ReturnType<typeof cookies> extends Promise<infer T> ? T : never)
}
const jreq = (body: unknown) =>
  new Request('http://x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const bearer = (t: string) => new Request('http://x', { headers: { authorization: `Bearer ${t}` } })
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const newToken = () => randomBytes(32).toString('base64url')

const DEVICE = '435AC17C'
const body = (tokenHash: string, extra: Record<string, unknown> = {}) =>
  ({ deviceId: DEVICE, tokenHash, model: 'lilygo-tbeam-s3-supreme', firmware: '0.18.0', ...extra })

describe('linking a tracker over Bluetooth', () => {
  it("links the tracker to the signed-in account; the tracker's own token then works", async () => {
    const u = await makeUser('Bluetooth Owner')
    mockAuth(u.idToken)
    const t = newToken()
    const res = await linkBluetooth(jreq(body(sha(t), { name: "Baldur's tracker" })))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deviceId: DEVICE, model: 'lilygo-tbeam-s3-supreme' })
    // The tracker uploads with the token it never sent anywhere.
    expect(await getDeviceAuth(bearer(t))).toEqual({ deviceId: DEVICE, userId: u.id })
    const rec = await getJson<{ userId: string; name: string; tokenHash: string }>(`devices/${DEVICE}/metadata.json`)
    expect(rec?.userId).toBe(u.id)
    expect(rec?.name).toBe("Baldur's tracker")
  })

  it('needs a signed-in user', async () => {
    mockAuth(null)
    expect((await linkBluetooth(jreq(body(sha(newToken()))))).status).toBe(401)
  })

  it('rejects a malformed tracker id or token hash', async () => {
    const u = await makeUser('Sloppy')
    mockAuth(u.idToken)
    expect((await linkBluetooth(jreq(body(sha(newToken()), { deviceId: 'not-an-id' })))).status).toBe(400)
    expect((await linkBluetooth(jreq(body('abc')))).status).toBe(400)
  })

  it("won't take a tracker that is on someone else's account", async () => {
    const owner = await makeUser('Owner')
    const other = await makeUser('Other')
    mockAuth(owner.idToken)
    await linkBluetooth(jreq(body(sha(newToken()))))
    mockAuth(other.idToken)
    const res = await linkBluetooth(jreq(body(sha(newToken()))))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('owned_elsewhere')
  })

  it("won't take a tracker linked by code to someone else either", async () => {
    const owner = await makeUser('Code Owner')
    const { claimCode, claimSecret } = await (await claim(jreq({ deviceId: DEVICE, model: 'm', firmware: 'f' }))).json()
    mockAuth(owner.idToken)
    await link(jreq({ claimCode }))
    await token(jreq({ deviceId: DEVICE, claimSecret }))
    const other = await makeUser('Squatter')
    mockAuth(other.idToken)
    expect((await linkBluetooth(jreq(body(sha(newToken()))))).status).toBe(409)
  })

  // The guard this route adds: registering a hash that is already some
  // tracker's token would point that tracker's uploads at this record.
  it('refuses a token hash that is already in use', async () => {
    const owner = await makeUser('Victim')
    const { claimCode, claimSecret } = await (await claim(jreq({ deviceId: '5A43CA48', model: 'm', firmware: 'f' }))).json()
    mockAuth(owner.idToken)
    await link(jreq({ claimCode }))
    const victimToken = (await (await token(jreq({ deviceId: '5A43CA48', claimSecret }))).json()).deviceToken
    const attacker = await makeUser('Attacker')
    mockAuth(attacker.idToken)
    const res = await linkBluetooth(jreq(body(sha(victimToken))))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('token_in_use')
    // The victim's tracker still uploads as itself.
    expect(await getDeviceAuth(bearer(victimToken))).toEqual({ deviceId: '5A43CA48', userId: owner.id })
  })

  it("re-linking your own tracker replaces its token, and the old one stops working", async () => {
    const u = await makeUser('Relinker')
    mockAuth(u.idToken)
    const first = newToken()
    await linkBluetooth(jreq(body(sha(first))))
    const second = newToken()
    expect((await linkBluetooth(jreq(body(sha(second))))).status).toBe(200)
    expect(await getDeviceAuth(bearer(first))).toBeNull()
    expect(await getDeviceAuth(bearer(second))).toEqual({ deviceId: DEVICE, userId: u.id })
  })
})
