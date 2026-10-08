// @vitest-environment node
// "Download my data" for a well-used account. The file used to come straight
// back from the server, and a Lambda can return at most 6 MB: with each paddle
// ~0.1 MB of map points, an account past ~40 paddles got an error instead of
// its data. The page now asks for a link (POST) and downloads from S3.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@paddlesnitch/core/strava', async (orig) => ({ ...(await orig<typeof import('@paddlesnitch/core/strava')>()), revoke: vi.fn() }))
// Production storage, on demand: S3 isn't reachable from tests, so the "S3"
// test swaps in a recorder for the two calls the large-account path makes.
const s3 = vi.hoisted(() => ({ on: false, puts: [] as { key: string; body: string }[], presigned: [] as unknown[][] }))
vi.mock('@/lib/storage', async (orig) => {
  const real = await orig<typeof import('@/lib/storage')>()
  return {
    ...real,
    usesLocalStorage: () => (s3.on ? false : real.usesLocalStorage()),
    putObject: async (key: string, body: string) => { if (s3.on) { s3.puts.push({ key, body }); return } return real.putObject(key, body) },
    presignGetUrl: async (...args: unknown[]) => { s3.presigned.push(args); return 'https://s3.example/signed' },
  }
})

import { cookies } from 'next/headers'
import { GET as exportFile, POST as exportLink } from '@/app/api/account/export/route'
import { DELETE as deleteAccount } from '@/app/api/account/route'
import { listKeys, putObject } from '@/lib/storage'
import { saveSession, type AnalysisSession } from '@paddlesnitch/analysis/analysis-store'

function signInAs(idToken: string) {
  vi.mocked(cookies).mockResolvedValue({ get: (n: string) => (n === 'tt_id' ? { name: n, value: idToken } : undefined) } as never)
}

// A paddle the size real ones are: ~860 rounded map points.
function realSizePaddle(userId: string, id: string): AnalysisSession {
  const points = Array.from({ length: 860 }, (_, i) => ({
    lat: 51.512345 + i * 0.000031, lng: -0.912345 + i * 0.000012, t: i * 4.2, speed: 2.913, sr: 58.4, dps: 2.987,
  }))
  return {
    id, userId, createdAt: '2026-09-01T10:00:00Z', paddledAt: '2026-09-01T09:00:00Z', source: { type: 'file' },
    doubleStrokeRate: false, note: '', insight: 'summary',
    result: { points, surges: [], stops: [], distanceKm: 8, durationS: 3600, cruiseSpeed: 2.9, avgSR: 58, avgDps: 3, insight: 'summary' },
  } as unknown as AnalysisSession
}

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir(); s3.on = false; s3.puts = []; s3.presigned = [] })
afterEach(async () => { await cleanDataDir(dataDir) })

describe('Download my data, for an account with many paddles', () => {
  it('is more than a Lambda can send back in one answer (why the old download failed)', async () => {
    const me = await makeUser('Busy')
    for (let i = 0; i < 60; i++) await saveSession(realSizePaddle(me.id, `p${i}`))
    signInAs(me.idToken)
    const bytes = (await (await exportFile()).arrayBuffer()).byteLength
    expect(bytes).toBeGreaterThan(6 * 1024 * 1024)
  })

  it('is written to private storage and handed over as a short-lived download link', async () => {
    const me = await makeUser('Busy')
    for (let i = 0; i < 60; i++) await saveSession(realSizePaddle(me.id, `p${i}`))
    signInAs(me.idToken)
    s3.on = true
    const res = await exportLink()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: 'https://s3.example/signed' })
    expect(s3.puts).toHaveLength(1)
    expect(s3.puts[0].key).toMatch(new RegExp(`^exports/${me.id}/[^/]+\\.json$`))
    expect(JSON.parse(s3.puts[0].body).paddles).toHaveLength(60)
    const [key, seconds, , opts] = s3.presigned[0] as [string, number, unknown, { downloadAs: string }]
    expect(key).toBe(s3.puts[0].key)
    expect(seconds).toBeLessThanOrEqual(300)
    expect(opts.downloadAs).toMatch(new RegExp(`^paddlesnitch-data-${me.id}-\\d{4}-\\d{2}-\\d{2}\\.json$`))
  })

  it('locally, the link is the direct download', async () => {
    const me = await makeUser('Local')
    signInAs(me.idToken)
    expect(await (await exportLink()).json()).toEqual({ url: '/api/account/export' })
  })

  it('is only for the signed-in user', async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never)
    expect((await exportLink()).status).toBe(401)
  })

  it('a prepared file is deleted with the account', async () => {
    const me = await makeUser('Leaving')
    await putObject(`exports/${me.id}/abc.json`, '{}')
    signInAs(me.idToken)
    expect((await deleteAccount()).status).toBe(200)
    expect(await listKeys(`exports/${me.id}/`)).toEqual([])
  })
})
