// @vitest-environment node
// Deleting a well-used account must finish inside the server's 30 s limit, or
// it stops halfway: some data gone, the rest kept, and an error on screen.
// Erasure used to make one storage call at a time (each paddle's files, each
// recording's, every trial's listing), so its time grew with the account.
//
// The rule (CLAUDE.md): deletes go through deleteObjects/deletePrefix, never a
// loop of single deletes. So the test counts delete calls, which a busy CI
// runner can't change: erasing 150 paddles and 60 recordings must make exactly
// as many delete calls as erasing 2 and 2. It used to time the erasure with a
// 2 s limit instead, and failed on a slow runner (#903).
//
// Every storage call still costs 10 ms (S3 from the Lambda is ~20-40 ms), and
// a generous time limit stays as a backstop for work that went serial, but the
// test doesn't rely on it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'
import { claimProof } from './device-proof'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
const slow = vi.hoisted(() => ({ ms: 0, calls: [] as string[] }))
vi.mock('@paddlesnitch/core/storage', async (orig) => {
  const real = await orig<typeof import('@paddlesnitch/core/storage')>()
  const wrap = <A extends unknown[], R>(name: string, f: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => {
    if (slow.ms) { slow.calls.push(name); await new Promise(r => setTimeout(r, slow.ms)) }
    return f(...a)
  }
  const out: Record<string, unknown> = { ...real }
  for (const name of ['getObject', 'putObject', 'listKeys', 'listPrefixes', 'deleteObject', 'deleteObjects', 'deletePrefix', 'getJson', 'putJson'] as const) {
    if (typeof (real as Record<string, unknown>)[name] === 'function') out[name] = wrap(name, (real as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name])
  }
  return out
})

import { cookies } from 'next/headers'
import { DELETE as deleteAccount } from '@/app/api/account/route'
import { listKeys } from '@/lib/storage'
import { sweepJobs } from '@/lib/jobs'
import { ERASE_AGAIN_AFTER_MS } from '@/lib/account-erasure'
import { saveSession, type AnalysisSession } from '@paddlesnitch/analysis/analysis-store'
import { storeDeviceSession, createClaim, linkClaim, redeemToken } from '@paddlesnitch/core/devices'

function signInAs(idToken: string) {
  vi.mocked(cookies).mockResolvedValue({ get: (n: string) => (n === 'tt_id' ? { name: n, value: idToken } : undefined) } as never)
}
const paddle = (userId: string, id: string) => ({
  id, userId, createdAt: '2026-09-01T10:00:00Z', paddledAt: '2026-09-01T09:00:00Z', source: { type: 'file' },
  doubleStrokeRate: false, note: '', insight: 's',
  result: { points: [{ lat: 51.5, lng: -0.9 }], surges: [], stops: [], distanceKm: 8, durationS: 3600, cruiseSpeed: 2.9, avgSR: 58, avgDps: 3, insight: 's' },
}) as unknown as AnalysisSession

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir(); slow.ms = 0; slow.calls = [] })
afterEach(async () => { slow.ms = 0; await cleanDataDir(dataDir) })

/** Runs `fn` with slow storage; returns its delete calls by kind and the wall time. */
async function measure(fn: () => Promise<void>) {
  slow.ms = 10
  slow.calls = []
  const t0 = Date.now()
  try { await fn() } finally { slow.ms = 0 }
  const count = (name: string) => slow.calls.filter(c => c === name).length
  return {
    deletes: { deleteObject: count('deleteObject'), deleteObjects: count('deleteObjects'), deletePrefix: count('deletePrefix') },
    calls: slow.calls.length,
    ms: Date.now() - t0,
  }
}

async function addPaddles(userId: string, n: number, tag: string) {
  for (let i = 0; i < n; i++) await saveSession(paddle(userId, `${tag}${i}`))
}
async function addRecordings(deviceId: string, userId: string, n: number, tag: string) {
  for (let i = 0; i < n; i++) {
    await storeDeviceSession({ deviceId, userId, filename: `${tag}_${String(i).padStart(4, '0')}.csv`, startedAt: '2026-09-01T09:00:00Z', endedAt: '2026-09-01T10:00:00Z', distanceMetres: 1000, points: 10 }, 'lat,lon,timestamp\n')
  }
}
async function accountWith(name: string, deviceId: string, paddles: number, recordings: number) {
  const me = await makeUser(name)
  await addPaddles(me.id, paddles, 'p')
  const claim = await createClaim(deviceId, 'T-Beam', '0.18.0')
  await linkClaim(claim.claimCode, me.id, 'Boat')
  await redeemToken(deviceId, claim.claimSecret, await claimProof(deviceId, claim.claimSecret))
  await addRecordings(deviceId, me.id, recordings, 'track')
  return me
}

/** Erases the account, then (#814) writes late data as the old token might and runs the second pass. */
async function eraseTwice(me: { id: string; idToken: string }, deviceId: string, paddles: number, recordings: number) {
  signInAs(me.idToken)
  const first = await measure(async () => {
    expect((await deleteAccount(new Request('http://x'))).status).toBe(200)
  })
  expect(await listKeys(`analysis/${me.id}/`)).toEqual([])
  expect(await listKeys(`devices/${deviceId}/sessions/`)).toEqual([])

  await addPaddles(me.id, paddles, 'late')
  await addRecordings(deviceId, me.id, recordings, 'late')
  const second = await measure(async () => {
    expect((await sweepJobs(Date.now() + ERASE_AGAIN_AFTER_MS + 1_000)).done).toBe(1)
  })
  expect(await listKeys(`analysis/${me.id}/`)).toEqual([])
  expect(await listKeys(`devices/${deviceId}/sessions/`)).toEqual([])
  return { first, second }
}

describe('deleting a well-used account', () => {
  it('makes as many delete calls for 150 paddles and 60 recordings as for a few', async () => {
    const few = await eraseTwice(await accountWith('Light', 'FEW00001', 2, 2), 'FEW00001', 2, 2)
    const many = await eraseTwice(await accountWith('Busy', 'ABCD1234', 150, 60), 'ABCD1234', 150, 60)

    // One delete per object was ~210 more calls here: 8+ s locally, 30 s+ against S3.
    expect(many.first.deletes, `first pass, ${many.first.calls} storage calls`).toEqual(few.first.deletes)
    expect(many.second.deletes, `second pass, ${many.second.calls} storage calls`).toEqual(few.second.deletes)
    // Any delete per object gets far past this: a few fixed single deletes only.
    expect(many.first.deletes.deleteObject).toBeLessThan(10)

    // Backstop, not the check: 30 s on S3 is ~7.5 s at 10 ms a call. A normal
    // run takes 1-2 s, so a busy runner has room.
    expect(many.first.ms, `${many.first.calls} storage calls`).toBeLessThan(7_500)
    expect(many.second.ms, `${many.second.calls} storage calls`).toBeLessThan(7_500)
  }, 60_000)
})
