// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir, makeUser, makeCourse, makeTrial } from './helpers'
import { putJson } from '@/lib/storage'
import type { AuthUser, BoatClass } from '@/lib/types'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import {
  getProfileSettings, setProfilePublic, buildProfileStats,
  normaliseHandle, claimHandle, releaseHandle, getHandleOwner, resolveToUserId,
  getPublicProfileLinks,
} from '@/lib/profile'

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir) })

// Plant a result.json for `userId` on `trialId`, returning nothing. Mirrors the
// stored entry shape buildProfileStats reads.
async function plantResult(trialId: string, userId: string, opts: {
  displayName?: string
  raceDate: string
  boatClass?: BoatClass
  seconds: number
  submittedAt?: string
}) {
  const entryId = `${Math.random().toString(36).slice(2)}`
  await putJson(`trials/${trialId}/entries/${userId}/${entryId}/result.json`, {
    entryId, userId,
    displayName: opts.displayName ?? 'Pat Paddler',
    submittedAt: opts.submittedAt ?? new Date().toISOString(),
    filename: 'r.gpx',
    raceDate: opts.raceDate,
    boatClass: opts.boatClass ?? 'K1',
    crew: [{ seat: 1, name: 'Pat' }],
    result: { startTimestamp: '', finishTimestamp: '', totalElapsedSeconds: opts.seconds, splits: [] },
  })
}

const asViewer = (u: { id: string; email: string; displayName: string }): AuthUser =>
  ({ id: u.id, email: u.email, displayName: u.displayName })

describe('profile settings', () => {
  it('defaults to private (opt-in)', async () => {
    const u = await makeUser()
    expect((await getProfileSettings(u.id)).public).toBe(false)
  })

  it('round-trips a public flag', async () => {
    const u = await makeUser()
    await setProfilePublic(u.id, true)
    expect((await getProfileSettings(u.id)).public).toBe(true)
    await setProfilePublic(u.id, false)
    expect((await getProfileSettings(u.id)).public).toBe(false)
  })

  it('a visibility flip preserves a claimed handle', async () => {
    const u = await makeUser()
    await claimHandle(u.id, 'speedy')
    await setProfilePublic(u.id, true)
    expect((await getProfileSettings(u.id)).handle).toBe('speedy')
  })
})

describe('handles', () => {
  it('normalises and validates', () => {
    expect(normaliseHandle('BalduR')).toEqual({ slug: 'baldur' })
    expect(normaliseHandle('  Pat-99  ')).toEqual({ slug: 'pat-99' })
    expect('error' in normaliseHandle('ab')).toBe(true)          // too short
    expect('error' in normaliseHandle('-nope')).toBe(true)        // leading hyphen
    expect('error' in normaliseHandle('has space')).toBe(true)    // bad char
    expect('error' in normaliseHandle('account')).toBe(true)      // reserved
  })

  it('claims a handle and resolves it back to the user', async () => {
    const u = await makeUser()
    const res = await claimHandle(u.id, 'river-rat')
    expect('error' in res).toBe(false)
    expect(await getHandleOwner('river-rat')).toBe(u.id)
    expect(await resolveToUserId('river-rat')).toBe(u.id)
    // An unknown segment resolves to itself (treated as a userId).
    expect(await resolveToUserId(u.id)).toBe(u.id)
  })

  it('rejects a handle already taken by someone else', async () => {
    const a = await makeUser('A')
    const b = await makeUser('B')
    await claimHandle(a.id, 'shared')
    const res = await claimHandle(b.id, 'shared')
    expect(res).toEqual({ error: 'That handle is already taken.' })
  })

  it('changing handle frees the old one', async () => {
    const u = await makeUser()
    await claimHandle(u.id, 'old-name')
    await claimHandle(u.id, 'new-name')
    expect(await getHandleOwner('old-name')).toBeNull()
    expect(await getHandleOwner('new-name')).toBe(u.id)
    expect((await getProfileSettings(u.id)).handle).toBe('new-name')
  })

  it('releasing a handle frees it for others', async () => {
    const a = await makeUser('A')
    const b = await makeUser('B')
    await claimHandle(a.id, 'grab')
    await releaseHandle(a.id)
    expect(await getHandleOwner('grab')).toBeNull()
    expect((await getProfileSettings(a.id)).handle).toBeUndefined()
    // Now b can take it.
    expect('error' in (await claimHandle(b.id, 'grab'))).toBe(false)
  })
})

describe('getPublicProfileLinks', () => {
  it('returns a link only for public profiles, preferring the handle', async () => {
    const pubWithHandle = await makeUser('PH')
    const pubNoHandle = await makeUser('PN')
    const privateUser = await makeUser('PV')

    await setProfilePublic(pubWithHandle.id, true)
    await claimHandle(pubWithHandle.id, 'speedy')
    await setProfilePublic(pubNoHandle.id, true)
    // privateUser stays private (default)

    const links = await getPublicProfileLinks([pubWithHandle.id, pubNoHandle.id, privateUser.id])
    expect(links.get(pubWithHandle.id)).toBe('speedy')   // handle preferred
    expect(links.get(pubNoHandle.id)).toBe(pubNoHandle.id) // falls back to userId
    expect(links.has(privateUser.id)).toBe(false)          // private → no link
  })
})

describe('buildProfileStats', () => {
  it('aggregates totals, PBs, best pace and boat classes across visible races', async () => {
    const owner = await makeUser('Owner')
    const courseA = await makeCourse(owner.id) // distanceMetres 556
    const trialA1 = await makeTrial(courseA.id, owner.id)
    const trialA2 = await makeTrial(courseA.id, owner.id)

    await plantResult(trialA1.id, owner.id, { displayName: 'Owner', raceDate: '2026-06-01', seconds: 120, boatClass: 'K1', submittedAt: '2026-06-01T10:00:00Z' })
    await plantResult(trialA2.id, owner.id, { displayName: 'Owner', raceDate: '2026-06-10', seconds: 100, boatClass: 'K2', submittedAt: '2026-06-10T10:00:00Z' }) // faster → PB

    const stats = await buildProfileStats(owner.id, asViewer(owner), new Set())
    expect(stats.displayName).toBe('Owner')
    expect(stats.totals.races).toBe(2)
    expect(stats.totals.courses).toBe(1)
    expect(stats.totals.since).toBe('2026-06-01')
    // PB is the faster of the two on course A.
    expect(stats.personalBests).toHaveLength(1)
    expect(stats.personalBests[0].bestSeconds).toBe(100)
    expect(stats.personalBests[0].raceCount).toBe(2)
    // Best race (highest speed) is the 100s one.
    expect(stats.bestRace?.totalElapsedSeconds).toBe(100)
    // Boat classes counted.
    expect(stats.boatClasses).toEqual(expect.arrayContaining([
      { boatClass: 'K1', count: 1 },
      { boatClass: 'K2', count: 1 },
    ]))
    // History newest first.
    expect(stats.races[0].raceDate).toBe('2026-06-10')
  })

  it('hides results from a private trial when the viewer cannot see it', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    const course = await makeCourse(owner.id)
    const publicTrial = await makeTrial(course.id, owner.id, 'open', { visibility: 'public' })
    const privateTrial = await makeTrial(course.id, owner.id, 'open', { visibility: 'private' })

    await plantResult(publicTrial.id, owner.id, { raceDate: '2026-06-01', seconds: 110 })
    await plantResult(privateTrial.id, owner.id, { raceDate: '2026-06-02', seconds: 90 }) // faster, but private

    // A stranger sees only the public race.
    const asStranger = await buildProfileStats(owner.id, asViewer(stranger), new Set())
    expect(asStranger.totals.races).toBe(1)
    expect(asStranger.bestRace?.totalElapsedSeconds).toBe(110)

    // The owner sees both, including the faster private one.
    const asOwner = await buildProfileStats(owner.id, asViewer(owner), new Set())
    expect(asOwner.totals.races).toBe(2)
    expect(asOwner.bestRace?.totalElapsedSeconds).toBe(90)
  })

  it('returns an empty profile for a user with no races', async () => {
    const u = await makeUser()
    const stats = await buildProfileStats(u.id, null, new Set())
    expect(stats.totals.races).toBe(0)
    expect(stats.displayName).toBeNull()
    expect(stats.bestRace).toBeNull()
    expect(stats.races).toEqual([])
  })
})
