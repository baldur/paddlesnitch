import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'crypto'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'
import { POST as claim } from '@/app/api/devices/claim/route'
import { POST as token } from '@/app/api/devices/token/route'
import { POST as link } from '@/app/api/account/devices/link/route'
import { POST as uploadSession } from '@/app/api/devices/sessions/route'
import { getDeviceSessionMotion } from '@/lib/devices'
import { cookies } from 'next/headers'

const DEVICE = '5A43CA48'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
function mockAuth(idToken: string | null) {
  ;(cookies as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    get: (n: string) => (n === 'tt_id' && idToken ? { value: idToken } : undefined),
    set: () => {}, delete: () => {},
  })
}
const jreq = (body: unknown) =>
  new Request('http://x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir); vi.restoreAllMocks() })

async function boundToken(u: { id: string; idToken: string }): Promise<string> {
  const { claimCode, claimSecret } = await (await claim(jreq({ deviceId: DEVICE, model: 'm', firmware: 'f' }))).json()
  mockAuth(u.idToken)
  await link(jreq({ claimCode }))
  return (await (await token(jreq({ deviceId: DEVICE, claimSecret }))).json()).deviceToken
}

const TRACK = [
  'timestamp,lat,lon,tx_seq',
  '2026-09-18T06:10:02Z,51.4600,-0.9300,1',
  '2026-09-18T06:10:03Z,51.4601,-0.9301,2',
  '2026-09-18T06:10:04Z,51.4602,-0.9302,3',
].join('\n')

const put = (qs: string, body: string | Buffer, dt: string) =>
  new Request(`http://x/api/devices/sessions?${qs}`, {
    method: 'POST', body, headers: { authorization: `Bearer ${dt}`, 'content-type': 'text/csv' },
  })

/** A motion CSV big enough to be worth chunking, with identifiable rows. */
function motionCsv(rows: number): string {
  const out = ['ms,ax_g,ay_g,az_g,gx_dps,gy_dps,gz_dps']
  for (let i = 0; i < rows; i++) {
    out.push(`${i * 90},${(i % 100) / 100},0.02,1.00,${i % 50}.5,1.2,0.3`)
  }
  return out.join('\n') + '\n'
}

/** Split into n byte-slices, the way the device will: fixed size, remainder last. */
function chunk(s: string, n: number): Buffer[] {
  const buf = Buffer.from(s, 'utf8')
  const size = Math.ceil(buf.length / n)
  const parts: Buffer[] = []
  for (let i = 0; i < buf.length; i += size) parts.push(buf.subarray(i, Math.min(buf.length, i + size)))
  return parts
}

async function uploadTrack(dt: string, name = 'track_20260918_061002.csv') {
  const res = await uploadSession(put(`filename=${name}`, TRACK, dt))
  expect(res.status).toBe(201)
  return (await res.json()).sessionId as string
}

describe('chunked motion sidecar upload', () => {
  it('assembles parts into exactly the original bytes', async () => {
    const u = await makeUser('Chunker')
    const dt = await boundToken(u)
    const sessionId = await uploadTrack(dt)

    const csv = motionCsv(4000)
    const parts = chunk(csv, 7)
    for (let i = 0; i < parts.length; i++) {
      const res = await uploadSession(
        put(`filename=track_20260918_061002_imu.csv&part=${i + 1}&parts=${parts.length}`, parts[i], dt))
      expect(res.status).toBe(i === parts.length - 1 ? 201 : 202)
    }

    // Byte-for-byte, not "looks about right" — a concat bug is silent otherwise.
    const stored = await getDeviceSessionMotion(u.id, DEVICE, sessionId)
    expect(stored).not.toBeNull()
    expect(stored!.toString('utf8')).toBe(csv)
  })

  it('reassembles correctly when parts arrive out of order', async () => {
    // The device retries individual parts, so order is not guaranteed. Assembly
    // must key off the index, never arrival order.
    const u = await makeUser('Shuffled')
    const dt = await boundToken(u)
    const sessionId = await uploadTrack(dt)

    const csv = motionCsv(1500)
    const parts = chunk(csv, 5)
    const order = [2, 4, 1, 3, 5]            // last part still sent last
    for (const n of order) {
      const res = await uploadSession(
        put(`filename=track_20260918_061002_imu.csv&part=${n}&parts=5`, parts[n - 1], dt))
      expect(res.status).toBe(n === 5 ? 201 : 202)
    }
    expect((await getDeviceSessionMotion(u.id, DEVICE, sessionId))!.toString('utf8')).toBe(csv)
  })

  it('refuses to assemble while a part is missing, and completes on the retry', async () => {
    const u = await makeUser('Gappy')
    const dt = await boundToken(u)
    const sessionId = await uploadTrack(dt)

    const csv = motionCsv(900)
    const parts = chunk(csv, 4)
    // 1, 2, 4 — part 3 never sent.
    for (const n of [1, 2]) {
      expect((await uploadSession(put(`filename=track_20260918_061002_imu.csv&part=${n}&parts=4`, parts[n - 1], dt))).status).toBe(202)
    }
    const early = await uploadSession(put('filename=track_20260918_061002_imu.csv&part=4&parts=4', parts[3], dt))
    expect(early.status).toBe(409)
    expect((await early.json()).missing).toEqual([3])
    // Nothing half-written.
    expect(await getDeviceSessionMotion(u.id, DEVICE, sessionId)).toBeNull()

    // Fill the gap, re-send the last part, and it completes.
    expect((await uploadSession(put('filename=track_20260918_061002_imu.csv&part=3&parts=4', parts[2], dt))).status).toBe(202)
    expect((await uploadSession(put('filename=track_20260918_061002_imu.csv&part=4&parts=4', parts[3], dt))).status).toBe(201)
    expect((await getDeviceSessionMotion(u.id, DEVICE, sessionId))!.toString('utf8')).toBe(csv)
  })

  it('a re-sent part overwrites rather than duplicating, so a reboot resumes', async () => {
    const u = await makeUser('Resumer')
    const dt = await boundToken(u)
    const sessionId = await uploadTrack(dt)

    const csv = motionCsv(600)
    const parts = chunk(csv, 3)
    await uploadSession(put('filename=track_20260918_061002_imu.csv&part=1&parts=3', parts[0], dt))
    await uploadSession(put('filename=track_20260918_061002_imu.csv&part=1&parts=3', parts[0], dt))  // retry
    await uploadSession(put('filename=track_20260918_061002_imu.csv&part=2&parts=3', parts[1], dt))
    expect((await uploadSession(put('filename=track_20260918_061002_imu.csv&part=3&parts=3', parts[2], dt))).status).toBe(201)
    expect((await getDeviceSessionMotion(u.id, DEVICE, sessionId))!.toString('utf8')).toBe(csv)
  })

  it('verifies sha256 over the assembled whole and rejects a corrupted part', async () => {
    // Assembling from pieces creates a way to produce a wrong file silently that
    // a single PUT never had. This is the guard against it.
    const u = await makeUser('Hashed')
    const dt = await boundToken(u)
    await uploadTrack(dt)

    const csv = motionCsv(800)
    const sha = createHash('sha256').update(Buffer.from(csv, 'utf8')).digest('hex')
    const parts = chunk(csv, 3)
    const corrupted = Buffer.from(parts[1]); corrupted[10] = corrupted[10] ^ 0xff

    await uploadSession(put('filename=track_20260918_061002_imu.csv&part=1&parts=3', parts[0], dt))
    await uploadSession(put('filename=track_20260918_061002_imu.csv&part=2&parts=3', corrupted, dt))
    const res = await uploadSession(
      put(`filename=track_20260918_061002_imu.csv&part=3&parts=3&sha256=${sha}`, parts[2], dt))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('sha256_mismatch')
  })

  it('accepts a correct sha256', async () => {
    const u = await makeUser('Honest')
    const dt = await boundToken(u)
    const sessionId = await uploadTrack(dt)
    const csv = motionCsv(800)
    const sha = createHash('sha256').update(Buffer.from(csv, 'utf8')).digest('hex')
    const parts = chunk(csv, 3)
    await uploadSession(put('filename=track_20260918_061002_imu.csv&part=1&parts=3', parts[0], dt))
    await uploadSession(put('filename=track_20260918_061002_imu.csv&part=2&parts=3', parts[1], dt))
    expect((await uploadSession(
      put(`filename=track_20260918_061002_imu.csv&part=3&parts=3&sha256=${sha}`, parts[2], dt))).status).toBe(201)
    expect((await getDeviceSessionMotion(u.id, DEVICE, sessionId))!.toString('utf8')).toBe(csv)
  })

  it('409s a chunk whose track has not been uploaded, so the device retries', async () => {
    const u = await makeUser('Orphan')
    const dt = await boundToken(u)
    const res = await uploadSession(put('filename=track_99999999_999999_imu.csv&part=1&parts=2', 'ms,a\n1,2\n', dt))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('track_not_uploaded')
  })

  it('still accepts a whole-file sidecar, so small ones need no chunking', async () => {
    const u = await makeUser('Whole')
    const dt = await boundToken(u)
    const sessionId = await uploadTrack(dt)
    const csv = motionCsv(50)
    expect((await uploadSession(put('filename=track_20260918_061002_imu.csv', csv, dt))).status).toBe(201)
    expect((await getDeviceSessionMotion(u.id, DEVICE, sessionId))!.toString('utf8')).toBe(csv)
  })

  it('rejects a nonsensical part index instead of storing it somewhere odd', async () => {
    const u = await makeUser('Bad')
    const dt = await boundToken(u)
    await uploadTrack(dt)
    for (const qs of ['part=0&parts=3', 'part=4&parts=3', 'part=-1&parts=3', 'part=x&parts=3']) {
      const res = await uploadSession(put(`filename=track_20260918_061002_imu.csv&${qs}`, 'ms,a\n1,2\n', dt))
      expect(res.status).toBe(409)
    }
  })
})
