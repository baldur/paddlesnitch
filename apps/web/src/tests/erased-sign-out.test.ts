// @vitest-environment node
// #795: a deleted account's ID token stays a valid JWT for up to 24 h, as an
// app's Bearer or a website cookie in another browser. Once the delete has
// finished (the 'done' marker, @paddlesnitch/core/erased), every signed-in
// request treats that account as signed out, so the old token writes nothing
// where erasure can no longer reach it. A 'pending' marker signs nobody out: a
// delete that fails must never lock out a live account.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createHash } from 'crypto'
import { makeDataDir, cleanDataDir, makeUser, type TestUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@paddlesnitch/core/strava', async (orig) => ({ ...(await orig<typeof import('@paddlesnitch/core/strava')>()), revoke: vi.fn() }))

import { cookies } from 'next/headers'
import { POST as trpcPost } from '@/app/api/trpc/[trpc]/route'
import { POST as analyse } from '@/app/paddles/api/analyse/route'
import { DELETE as deleteAccount } from '@/app/api/account/route'
import { getRequestUser, getAuthUser, bearerUser } from '@/lib/auth'
import { markAccountErased, markAccountErasing, clearErasedCache, CACHE_MS } from '@paddlesnitch/core/erased'
import { listKeys, getJson, putJson } from '@/lib/storage'

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir(); clearErasedCache(); cookie(null) })
afterEach(async () => { vi.useRealTimers(); await cleanDataDir(dataDir) })

/** The website's cookie jar, holding `idToken` as tt_id (or empty). */
function cookie(idToken: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name === 'tt_id' && idToken ? { name, value: idToken } : undefined),
    set: () => {}, delete: () => {},
  } as unknown as Awaited<ReturnType<typeof cookies>>)
}
const headers = (token?: string): Record<string, string> => (token ? { authorization: `Bearer ${token}` } : {})

/** The game's leaderboard post, over HTTP like the game and the apps send it. */
const submitTime = (token?: string) => trpcPost(new Request('http://localhost/api/trpc/games.submit', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers(token) },
  body: JSON.stringify({ course: 'race', time: 1900, hull: 'club' }),
}))
const leaderboardNames = async (userId: string) =>
  JSON.stringify((await getJson(`games/kayak/leaderboard/race.json`)) ?? null).includes(userId)

/** Add a paddle (REST, multipart), like the website and the apps. */
function addPaddle(token?: string) {
  const form = new FormData()
  const gpx = `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>${Array.from({ length: 120 }, (_, i) =>
    `<trkpt lat="${51.5 + i * 0.0001}" lon="-0.9"><time>${new Date(Date.UTC(2026, 9, 1, 9, 0, i * 5)).toISOString()}</time></trkpt>`).join('')}</trkseg></trk></gpx>`
  form.append('file', new File([gpx], 'p.gpx', { type: 'application/gpx+xml' }))
  return analyse(new NextRequest('http://x/paddles/api/analyse', { method: 'POST', body: form, headers: headers(token) }))
}

const markerAt = (u: TestUser, state: 'pending' | 'done') =>
  putJson(`auth/erased/${createHash('sha256').update(u.id).digest('hex')}.json`, { state, at: new Date().toISOString() })

describe("a deleted account's token is signed out", () => {
  it('after DELETE /api/account, the old Bearer token can neither post a game time nor add a paddle', async () => {
    const u = await makeUser('Leaver')
    cookie(u.idToken)
    expect((await deleteAccount(new Request('http://x'))).status).toBe(200)
    cookie(null)

    const t = await submitTime(u.idToken)
    expect(t.status).toBe(401)
    expect(JSON.stringify(await t.json())).toContain('UNAUTHORIZED')
    expect(await leaderboardNames(u.id)).toBe(false)

    expect((await addPaddle(u.idToken)).status).toBe(401)
    expect(await listKeys(`analysis/${u.id}/`)).toEqual([])
    expect(await listKeys(`users/${u.id}/`)).toEqual([])
  })

  it('the website cookie left in another browser is signed out too', async () => {
    const u = await makeUser('Other browser')
    await markAccountErased(u.id)
    cookie(u.idToken)
    expect(await getAuthUser()).toBeNull()
    expect(await getRequestUser(new Request('http://x'))).toBeNull()
    expect((await submitTime()).status).toBe(401)
    expect((await addPaddle()).status).toBe(401)
    expect(await leaderboardNames(u.id)).toBe(false)
    expect(await listKeys(`analysis/${u.id}/`)).toEqual([])
  })

  it('a done marker written by another server signs the token out as well', async () => {
    const u = await makeUser('Elsewhere')
    await markerAt(u, 'done')
    expect(await getRequestUser(new Request('http://x', { headers: headers(u.idToken) }))).toBeNull()
    expect(await bearerUser(new Request('http://x', { headers: headers(u.idToken) }))).toBeNull()
    expect((await submitTime(u.idToken)).status).toBe(401)
  })
})

describe('everyone else is unaffected', () => {
  it('a live account signs in and writes as before', async () => {
    const u = await makeUser('Live')
    expect((await getRequestUser(new Request('http://x', { headers: headers(u.idToken) })))?.id).toBe(u.id)
    expect((await submitTime(u.idToken)).status).toBe(200)
    expect(await leaderboardNames(u.id)).toBe(true)
    cookie(u.idToken)
    expect((await getAuthUser())?.id).toBe(u.id)
  })

  it('a pending marker (a delete still running, or one that failed) signs nobody out', async () => {
    const u = await makeUser('Pending')
    await markAccountErasing(u.id)
    expect((await getRequestUser(new Request('http://x', { headers: headers(u.idToken) })))?.id).toBe(u.id)
    expect((await submitTime(u.idToken)).status).toBe(200)
    cookie(u.idToken)
    expect((await getAuthUser())?.id).toBe(u.id)
  })

  it('a done marker older than two days is ignored (the token has long expired)', async () => {
    const u = await makeUser('Old marker')
    await putJson(`auth/erased/${createHash('sha256').update(u.id).digest('hex')}.json`, { state: 'done', at: new Date(Date.now() - 49 * 3600_000).toISOString() })
    expect((await getRequestUser(new Request('http://x', { headers: headers(u.idToken) })))?.id).toBe(u.id)
  })
})

describe('the marker is read at most once a minute per account per server', () => {
  it('a cached "not deleted" holds for CACHE_MS, then the marker is read again', async () => {
    const u = await makeUser('Cached')
    const ask = () => getRequestUser(new Request('http://x', { headers: headers(u.idToken) }))
    vi.useFakeTimers({ toFake: ['Date'] })
    expect((await ask())?.id).toBe(u.id)
    // Another server finishes the delete: this one still has 'none' cached.
    await markerAt(u, 'done')
    vi.setSystemTime(Date.now() + CACHE_MS - 1_000)
    expect((await ask())?.id).toBe(u.id)
    vi.setSystemTime(Date.now() + 2_000)
    expect(await ask()).toBeNull()
  })

  it('never caches for more than a minute', () => {
    expect(CACHE_MS).toBeLessThanOrEqual(60_000)
  })

  it('the server that ran the delete stops the token at once, cache or not', async () => {
    const u = await makeUser('Same server')
    const ask = () => getRequestUser(new Request('http://x', { headers: headers(u.idToken) }))
    expect((await ask())?.id).toBe(u.id)
    await markAccountErased(u.id)
    expect(await ask()).toBeNull()
  })

  it('a pending marker is not cached: the delete finishing is seen on the next request', async () => {
    const u = await makeUser('Pending then done')
    const ask = () => getRequestUser(new Request('http://x', { headers: headers(u.idToken) }))
    await markerAt(u, 'pending')
    expect((await ask())?.id).toBe(u.id)
    await markerAt(u, 'done')
    expect(await ask()).toBeNull()
  })
})
