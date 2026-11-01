// @vitest-environment node
// #814: the second pass of account erasure. While the erasure marker is
// 'pending', and for up to a minute after 'done' on a server that cached the
// account as live, a deleted account's old token can still write after its
// area was erased. DELETE /api/account leaves an `erase-account-again` job that
// runs the same erasure ~90 s later, only for an account whose delete finished.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createHash } from 'crypto'
import { makeDataDir, cleanDataDir, makeUser, type TestUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@paddlesnitch/core/strava', async (orig) => ({ ...(await orig<typeof import('@paddlesnitch/core/strava')>()), revoke: vi.fn() }))
// A write that lands while the delete runs: after the data is erased, before
// the sign-in account goes and the marker turns 'done'.
const during = vi.hoisted(() => ({ hook: null as null | (() => Promise<void>) }))
vi.mock('@/lib/cognito', async (orig) => {
  const real = await orig<typeof import('@/lib/cognito')>()
  return { ...real, deleteUserBySub: async (sub: string) => { await during.hook?.(); return real.deleteUserBySub(sub) } }
})

import { cookies } from 'next/headers'
import { POST as trpcPost } from '@/app/api/trpc/[trpc]/route'
import { POST as analyse } from '@/app/paddles/api/analyse/route'
import { DELETE as deleteAccount } from '@/app/api/account/route'
import { runJob, sweepJobs, enqueueJob } from '@/lib/jobs'
import { eraseAccountAgain, ERASE_AGAIN_AFTER_MS } from '@/lib/account-erasure'
import { linkNoteKey } from '@/lib/google-link'
import { claimHandle } from '@/lib/profile'
import { markAccountErasing, markAccountErased, clearErasedCache, CACHE_MS, erasureState } from '@paddlesnitch/core/erased'
import { listKeys, getJson, getObject, putObject, putJson, deleteObject } from '@/lib/storage'

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir(); clearErasedCache(); cookie(null); during.hook = null })
afterEach(async () => { await cleanDataDir(dataDir) })

function cookie(idToken: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name === 'tt_id' && idToken ? { name, value: idToken } : undefined),
    set: () => {}, delete: () => {},
  } as unknown as Awaited<ReturnType<typeof cookies>>)
}
const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

const submitTime = (token: string) => trpcPost(new Request('http://localhost/api/trpc/games.submit', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...bearer(token) },
  body: JSON.stringify({ course: 'race', time: 1900, hull: 'club' }),
}))
const onLeaderboard = async (userId: string) =>
  JSON.stringify((await getJson(`games/kayak/leaderboard/race.json`)) ?? null).includes(userId)

function addPaddle(token: string) {
  const form = new FormData()
  const gpx = `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>${Array.from({ length: 120 }, (_, i) =>
    `<trkpt lat="${51.5 + i * 0.0001}" lon="-0.9"><time>${new Date(Date.UTC(2026, 9, 1, 9, 0, i * 5)).toISOString()}</time></trkpt>`).join('')}</trkseg></trk></gpx>`
  form.append('file', new File([gpx], 'p.gpx', { type: 'application/gpx+xml' }))
  return analyse(new NextRequest('http://x/paddles/api/analyse', { method: 'POST', body: form, headers: bearer(token) }))
}

const deleteAs = async (u: TestUser) => {
  cookie(u.idToken)
  const res = await deleteAccount(new Request('http://x', { method: 'DELETE' }))
  cookie(null)
  expect(res.status).toBe(200)
}
const jobKeys = () => listKeys('jobs/erase-account-again/')
/** Everything this account still has where its writes land. */
const leftOf = async (id: string) => [
  ...await listKeys(`analysis/${id}/`),
  ...await listKeys(`users/${id}/`),
  ...(await onLeaderboard(id) ? ['games leaderboard'] : []),
]

describe('DELETE /api/account leaves the second pass', () => {
  it('one job, not due until the request limit and the sign-in cache have both passed, holding only the account ID', async () => {
    const u = await makeUser('Leaver')
    const before = Date.now()
    await deleteAs(u)
    const keys = await jobKeys()
    expect(keys).toHaveLength(1)
    const job = await getJson<{ payload: unknown; notBefore: string }>(keys[0])
    expect(job!.payload).toEqual({ userId: u.id })
    expect(Date.parse(job!.notBefore) - before).toBeGreaterThanOrEqual(ERASE_AGAIN_AFTER_MS)
    // A write let in at the end of another server's cached minute still runs its 30 s.
    expect(ERASE_AGAIN_AFTER_MS).toBeGreaterThan(CACHE_MS + 30_000)
    const raw = (await getObject(keys[0]))!.toString()
    expect(raw).not.toContain(u.email)
    expect(raw).not.toContain(u.email.split('@')[0])
    expect(raw).not.toContain(linkNoteKey(u.email).split('/').pop()!.replace('.json', ''))
    // Not before it's due, then once: the file goes when it's done.
    expect(await runJob(keys[0], Date.now() + 30_000)).toBe('not_due')
    expect(await runJob(keys[0], Date.now() + ERASE_AGAIN_AFTER_MS + 1_000)).toBe('done')
    expect(await listKeys('jobs/')).toEqual([])
    expect(await listKeys('jobs-state/')).toEqual([])
  })

  it('a repeat DELETE after the first answer was lost leaves no second job', async () => {
    const u = await makeUser('Asked twice')
    await deleteAs(u)
    await deleteAs(u)
    expect(await jobKeys()).toHaveLength(1)
  })
})

describe("the second pass catches the old token's writes in the window", () => {
  it('a paddle and a game time saved while the marker was pending are gone after the job runs', async () => {
    const u = await makeUser('Pending window')
    during.hook = async () => {
      // The data is erased, the marker still says 'pending': the token still works.
      expect(await erasureState(u.id)).toBe('pending')
      expect((await addPaddle(u.idToken)).status).toBe(200)
      expect((await submitTime(u.idToken)).status).toBe(200)
      await putJson(`users/${u.id}/profile.json`, { public: true })
    }
    await deleteAs(u)
    // The first pass ends with game times, so those are already gone; the rest waits.
    expect(await onLeaderboard(u.id)).toBe(false)
    expect((await listKeys(`analysis/${u.id}/`)).length).toBeGreaterThan(0)
    expect(await getJson(`users/${u.id}/profile.json`)).not.toBeNull()

    const counts = await sweepJobs(Date.now() + ERASE_AGAIN_AFTER_MS + 1_000)
    expect(counts.done).toBe(1)
    expect(await leftOf(u.id)).toEqual([])
  })

  it('a paddle and a game time saved after done, on a server that still had the account cached as live, are gone after the job runs', async () => {
    const u = await makeUser('Cached elsewhere')
    await deleteAs(u)
    // Another server read 'none' just before the delete finished: model it by
    // letting these writes through as that server would, then writing 'done' back.
    await markAccountErasing(u.id)
    expect((await addPaddle(u.idToken)).status).toBe(200)
    expect((await submitTime(u.idToken)).status).toBe(200)
    await markAccountErased(u.id)
    expect((await listKeys(`analysis/${u.id}/`)).length).toBeGreaterThan(0)
    expect(await onLeaderboard(u.id)).toBe(true)

    await sweepJobs(Date.now() + ERASE_AGAIN_AFTER_MS + 1_000)
    expect(await leftOf(u.id)).toEqual([])
  })

  it("leaves a handle someone else claimed since, even if the old token's profile still names it", async () => {
    const u = await makeUser('Handle leaver')
    const other = await makeUser('Handle taker')
    expect(await claimHandle(u.id, 'riverfox')).toMatchObject({ handle: 'riverfox' })
    await deleteAs(u)
    expect(await getJson('usernames/riverfox.json')).toBeNull()
    expect(await claimHandle(other.id, 'riverfox')).toMatchObject({ handle: 'riverfox' })
    // The old token's profile write, landed in the window.
    await putJson(`users/${u.id}/profile.json`, { public: true, handle: 'riverfox' })
    await sweepJobs(Date.now() + ERASE_AGAIN_AFTER_MS + 1_000)
    expect(await getJson('usernames/riverfox.json')).toEqual({ userId: other.id })
    expect(await listKeys(`users/${u.id}/`)).toEqual([])
  })
})

describe('the second pass never touches a live account', () => {
  it('no marker: does nothing, and the job file goes', async () => {
    const u = await makeUser('Live')
    expect((await addPaddle(u.idToken)).status).toBe(200)
    expect((await submitTime(u.idToken)).status).toBe(200)
    await putJson(`users/${u.id}/profile.json`, { public: true })
    const before = await leftOf(u.id)
    expect(before.length).toBeGreaterThan(2)

    const key = await enqueueJob('erase-account-again', { userId: u.id })
    expect(await runJob(key)).toBe('done')
    expect(await leftOf(u.id)).toEqual(before)
    expect(await listKeys('jobs/')).toEqual([])
  })

  it("a 'pending' marker that never became 'done' (a delete that failed): does nothing", async () => {
    const u = await makeUser('Failed delete')
    during.hook = async () => { throw new Error('Cognito had a moment') }
    cookie(u.idToken)
    await expect(deleteAccount(new Request('http://x', { method: 'DELETE' }))).rejects.toThrow()
    cookie(null)
    during.hook = null
    expect(await erasureState(u.id)).toBe('pending')
    // Still a live account: it carries on.
    expect((await addPaddle(u.idToken)).status).toBe(200)
    await putJson(`users/${u.id}/profile.json`, { public: true })
    const before = await leftOf(u.id)

    expect((await sweepJobs(Date.now() + ERASE_AGAIN_AFTER_MS + 1_000)).done).toBe(1)
    expect(await leftOf(u.id)).toEqual(before)
    expect(await listKeys('jobs/')).toEqual([])
  })

  it('a done marker older than two days counts as live too', async () => {
    const u = await makeUser('Long gone')
    await putJson(`users/${u.id}/profile.json`, { public: true })
    await putJson(`auth/erased/${createHash('sha256').update(u.id).digest('hex')}.json`, { state: 'done', at: new Date(Date.now() - 49 * 3600_000).toISOString() })
    await eraseAccountAgain({ userId: u.id })
    expect(await getJson(`users/${u.id}/profile.json`)).not.toBeNull()
  })
})

describe('safe to run twice', () => {
  it("run twice (S3 announced it twice): both succeed, nothing of theirs is left, others' data stays", async () => {
    const u = await makeUser('Twice')
    const other = await makeUser('Stays')
    expect((await addPaddle(other.idToken)).status).toBe(200)
    expect((await submitTime(other.idToken)).status).toBe(200)
    await putJson(`users/${other.id}/profile.json`, { public: true })
    during.hook = async () => { expect((await addPaddle(u.idToken)).status).toBe(200) }
    await deleteAs(u)
    const [key] = await jobKeys()
    const job = await getJson<{ payload: { userId: string } }>(key)

    expect(await runJob(key, Date.now() + ERASE_AGAIN_AFTER_MS + 1_000)).toBe('done')
    await eraseAccountAgain(job!.payload)   // the second run, after the file went
    expect(await runJob(key, Date.now() + ERASE_AGAIN_AFTER_MS + 1_000)).toBe('gone')
    expect(await leftOf(u.id)).toEqual([])
    expect((await listKeys(`analysis/${other.id}/`)).length).toBeGreaterThan(0)
    expect(await onLeaderboard(other.id)).toBe(true)
    expect(await getJson(`users/${other.id}/profile.json`)).not.toBeNull()
  })

  it('a pass that fails part way is retried, then finishes', async () => {
    const u = await makeUser('Retry')
    await deleteAs(u)
    const [key] = await jobKeys()
    // A marker read that fails throws (fail closed), so the job retries.
    const marker = `auth/erased/${createHash('sha256').update(u.id).digest('hex')}.json`
    const kept = await getJson(marker)
    await deleteObject(marker)
    await putObject(marker, 'not json')
    const now = Date.now() + ERASE_AGAIN_AFTER_MS + 1_000
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await runJob(key, now)).toBe('retry')
    await putJson(marker, kept)
    await putJson(`users/${u.id}/late.json`, { x: 1 })
    expect(await runJob(key, now + 2 * 60_000)).toBe('done')
    expect(await listKeys(`users/${u.id}/`)).toEqual([])
  })
})
