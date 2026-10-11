// @vitest-environment node
// A tracker ID is not a secret: it is derived from the board's MAC and shown on
// its setup hotspot. Before this, anyone signed in could claim an ID nobody owned
// yet -- by code (start a claim, type the code, collect the token) or over the
// Bluetooth link route (post the ID with a token hash they made up) -- and the
// real owner would get "owned elsewhere". Now binding needs a signature from the
// key that tracker was enrolled with when it was flashed.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash, generateKeyPairSync, randomBytes } from 'crypto'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'
import { provedPoll, enrolTestDevice, linkProof, strangerProof, TEST_DEVICE_PUBKEY } from './device-proof'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { POST as claim } from '@/app/api/devices/claim/route'
import { POST as token } from '@/app/api/devices/token/route'
import { POST as link } from '@/app/api/account/devices/link/route'
import { POST as linkBluetooth } from '@/app/api/account/devices/link-bluetooth/route'
import { POST as identity } from '@/app/api/devices/identity/route'
import { claimProofMessage, linkProofMessage } from '@/lib/devices'
import { getJson } from '@/lib/storage'
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
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

const DEVICE = '435C09C8'

async function startAndLink(userIdToken: string) {
  const { claimCode, claimSecret } = await (await claim(jreq({ deviceId: DEVICE, model: 'm', firmware: 'f' }))).json()
  mockAuth(userIdToken)
  expect((await link(jreq({ claimCode }))).status).toBe(200)
  return claimSecret as string
}

describe('claiming by code needs the tracker itself', () => {
  it('someone who knows only the ID cannot collect a token, and nothing is bound', async () => {
    await enrolTestDevice(DEVICE)
    const squatter = await makeUser('Squatter')
    const claimSecret = await startAndLink(squatter.idToken)

    const noProof = await token(jreq({ deviceId: DEVICE, claimSecret }))
    expect(noProof.status).toBe(403)
    expect((await noProof.json()).error).toBe('bad_proof')

    const forged = await token(jreq({ deviceId: DEVICE, claimSecret, proof: strangerProof(claimProofMessage(DEVICE, claimSecret)) }))
    expect(forged.status).toBe(403)

    expect(await getJson(`devices/${DEVICE}/metadata.json`)).toBeNull()
  })

  it('the enrolled tracker, signing the server secret, gets its token', async () => {
    const owner = await makeUser('Owner')
    const claimSecret = await startAndLink(owner.idToken)
    const res = await token(jreq(await provedPoll(DEVICE, claimSecret)))
    expect(res.status).toBe(200)
    expect((await res.json()).deviceToken).toBeTruthy()
  })

  it('a signature over a different claim secret does not carry over (no replay)', async () => {
    await enrolTestDevice(DEVICE)
    const owner = await makeUser('Owner')
    const claimSecret = await startAndLink(owner.idToken)
    const old = await provedPoll(DEVICE, 'an-earlier-secret')
    const res = await token(jreq({ deviceId: DEVICE, claimSecret, proof: old.proof }))
    expect(res.status).toBe(403)
  })

  it('a tracker that was never enrolled cannot be claimed, and says so', async () => {
    const owner = await makeUser('Owner')
    const claimSecret = await startAndLink(owner.idToken)
    const res = await token(jreq({ deviceId: DEVICE, claimSecret, proof: strangerProof('x') }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('not_enrolled')
  })

  it('still answers pending before the code is typed, without asking for proof', async () => {
    const { claimSecret } = await (await claim(jreq({ deviceId: DEVICE, model: 'm', firmware: 'f' }))).json()
    expect((await token(jreq({ deviceId: DEVICE, claimSecret }))).status).toBe(202)
  })
})

describe('linking over Bluetooth needs the tracker itself', () => {
  const body = (tokenHash: string, extra: Record<string, unknown> = {}) =>
    ({ deviceId: DEVICE, tokenHash, model: 'lilygo-tbeam-s3-supreme', firmware: '0.19.1', ...extra })

  it('a made-up token hash for someone else\'s ID is refused', async () => {
    await enrolTestDevice(DEVICE)
    const squatter = await makeUser('Squatter')
    mockAuth(squatter.idToken)
    const h = sha(randomBytes(32).toString('base64url'))
    const res = await linkBluetooth(jreq(body(h, { signature: strangerProof(linkProofMessage(DEVICE, h)) })))
    expect(res.status).toBe(403)
    expect(await getJson(`devices/${DEVICE}/metadata.json`)).toBeNull()
  })

  it('the tracker\'s own signature over its token hash links it', async () => {
    const owner = await makeUser('Owner')
    mockAuth(owner.idToken)
    const h = sha(randomBytes(32).toString('base64url'))
    const res = await linkBluetooth(jreq(body(h, { signature: await linkProof(DEVICE, h) })))
    expect(res.status).toBe(200)
  })

  it('a signature for one token hash does not link another', async () => {
    const owner = await makeUser('Owner')
    mockAuth(owner.idToken)
    const sig = await linkProof(DEVICE, sha('a'))
    const res = await linkBluetooth(jreq(body(sha('b'), { signature: sig })))
    expect(res.status).toBe(403)
  })
})

describe('a tracker already on an account registers its own key', () => {
  async function boundToken() {
    const owner = await makeUser('Owner')
    const claimSecret = await startAndLink(owner.idToken)
    return (await (await token(jreq(await provedPoll(DEVICE, claimSecret)))).json()).deviceToken as string
  }
  const otherKey = () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64')

  it('needs the device token', async () => {
    const res = await identity(jreq({ publicKey: otherKey() }))
    expect(res.status).toBe(401)
  })

  it('never replaces a key that is already enrolled (only a cable can)', async () => {
    const t = await boundToken()   // enrolled with the test key
    const res = await identity(jreq({ publicKey: otherKey() }, { authorization: `Bearer ${t}` }))
    expect(res.status).toBe(409)
    expect((await getJson<{ publicKey: string }>(`device-keys/${DEVICE}.json`))?.publicKey).toBe(TEST_DEVICE_PUBKEY)
  })

  it('re-sending the same key is fine', async () => {
    const t = await boundToken()
    const res = await identity(jreq({ publicKey: TEST_DEVICE_PUBKEY }, { authorization: `Bearer ${t}` }))
    expect(res.status).toBe(200)
  })

  it('refuses something that is not a P-256 public key', async () => {
    const t = await boundToken()
    const { rm } = await import('fs/promises')
    await rm(`${dataDir}/device-keys/${DEVICE}.json`)
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
    expect((await identity(jreq({ publicKey: rsa }, { authorization: `Bearer ${t}` }))).status).toBe(400)
    expect((await identity(jreq({ publicKey: 'not base64 at all!' }, { authorization: `Bearer ${t}` }))).status).toBe(400)
  })

  it('registers a key for a linked tracker that has none yet', async () => {
    const t = await boundToken()
    const { rm } = await import('fs/promises')
    await rm(`${dataDir}/device-keys/${DEVICE}.json`)
    const k = otherKey()
    const res = await identity(jreq({ publicKey: k }, { authorization: `Bearer ${t}` }))
    expect(res.status).toBe(201)
    const rec = await getJson<{ publicKey: string; via: string }>(`device-keys/${DEVICE}.json`)
    expect(rec?.publicKey).toBe(k)
    expect(rec?.via).toBe('token')
  })
})

describe('the tracker and the server sign the same bytes', () => {
  it('matches firmware/include/claim_proof.h', async () => {
    const { readFileSync } = await import('fs')
    const path = await import('path')
    const header = readFileSync(path.resolve(__dirname, '../../../../firmware/include/claim_proof.h'), 'utf8')
    expect(header).toContain('"paddlesnitch-claim\\n%s\\n%s\\n", deviceId, claimSecret')
    expect(header).toContain('"paddlesnitch-link\\n%s\\n%s\\n", deviceId, tokenHash')
    expect(claimProofMessage('435C09C8', 's')).toBe('paddlesnitch-claim\n435C09C8\ns\n')
    expect(linkProofMessage('435C09C8', 'h')).toBe('paddlesnitch-link\n435C09C8\nh\n')
  })
})
