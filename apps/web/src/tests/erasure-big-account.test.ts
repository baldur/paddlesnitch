// @vitest-environment node
// Deleting a well-used account must finish inside the server's 30 s limit, or
// it stops halfway: some data gone, the rest kept, and an error on screen.
// Erasure used to make one storage call at a time (each paddle's files, each
// recording's, every trial's listing), so its time grew with the account.
//
// Here every storage call costs 10 ms (S3 from the Lambda is ~20-40 ms) while
// the account is deleted, and the test measures the wall time.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@paddlesnitch/core/strava', async (orig) => ({ ...(await orig<typeof import('@paddlesnitch/core/strava')>()), revoke: vi.fn() }))
const slow = vi.hoisted(() => ({ ms: 0, calls: 0 }))
vi.mock('@paddlesnitch/core/storage', async (orig) => {
  const real = await orig<typeof import('@paddlesnitch/core/storage')>()
  const wrap = <A extends unknown[], R>(f: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => {
    if (slow.ms) { slow.calls++; await new Promise(r => setTimeout(r, slow.ms)) }
    return f(...a)
  }
  const out: Record<string, unknown> = { ...real }
  for (const name of ['getObject', 'putObject', 'listKeys', 'deleteObject', 'deleteObjects', 'getJson', 'putJson'] as const) {
    if (typeof (real as Record<string, unknown>)[name] === 'function') out[name] = wrap((real as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name])
  }
  return out
})

import { cookies } from 'next/headers'
import { DELETE as deleteAccount } from '@/app/api/account/route'
import { listKeys } from '@/lib/storage'
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
beforeEach(async () => { dataDir = await makeDataDir(); slow.ms = 0; slow.calls = 0 })
afterEach(async () => { slow.ms = 0; await cleanDataDir(dataDir) })

describe('deleting a well-used account', () => {
  it('takes about the same time for 150 paddles and 60 recordings as for a few', async () => {
    const me = await makeUser('Busy')
    for (let i = 0; i < 150; i++) await saveSession(paddle(me.id, `p${i}`))
    const claim = await createClaim('ABCD1234', 'T-Beam', '0.18.0')
    await linkClaim(claim.claimCode, me.id, 'Boat')
    await redeemToken('ABCD1234', claim.claimSecret)
    for (let i = 0; i < 60; i++) {
      await storeDeviceSession({ deviceId: 'ABCD1234', userId: me.id, filename: `track_${String(i).padStart(4, '0')}.csv`, startedAt: '2026-09-01T09:00:00Z', endedAt: '2026-09-01T10:00:00Z', distanceMetres: 1000, points: 10 }, 'lat,lon,timestamp\n')
    }
    signInAs(me.idToken)

    slow.ms = 10
    const t0 = Date.now()
    expect((await deleteAccount()).status).toBe(200)
    const took = Date.now() - t0
    slow.ms = 0

    expect(await listKeys(`analysis/${me.id}/`)).toEqual([])
    expect((await listKeys('devices/ABCD1234/sessions/'))).toEqual([])
    // One call at a time this was ~800 calls: 8+ s here, 30 s+ against S3.
    expect(took, `${slow.calls} storage calls in ${took} ms`).toBeLessThan(2000)
  }, 60_000)
})
