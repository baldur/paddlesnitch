// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir, makeUser, makeCourse, makeTrial } from './helpers'
import { putJson } from '@/lib/storage'
import type { AuthUser, BoatClass } from '@/lib/types'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { getRecentSubmissions } from '@/lib/recent'

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir) })

async function plant(trialId: string, userId: string, opts: { submittedAt: string; seconds?: number; boatClass?: BoatClass }) {
  const entryId = Math.random().toString(36).slice(2)
  await putJson(`trials/${trialId}/entries/${userId}/${entryId}/result.json`, {
    entryId, userId, displayName: 'Pat',
    submittedAt: opts.submittedAt,
    filename: 'r.gpx', raceDate: '2026-06-01',
    boatClass: opts.boatClass ?? 'K1', crew: [{ seat: 1, name: 'Pat' }],
    result: { startTimestamp: '', finishTimestamp: '', totalElapsedSeconds: opts.seconds ?? 60, splits: [] },
  })
}

const asViewer = (u: { id: string; email: string; displayName: string }): AuthUser =>
  ({ id: u.id, email: u.email, displayName: u.displayName })

describe('getRecentSubmissions', () => {
  it('returns submissions newest-first, capped at the limit', async () => {
    const u = await makeUser()
    const course = await makeCourse(u.id)
    const trial = await makeTrial(course.id, u.id, 'open')
    await plant(trial.id, u.id, { submittedAt: '2026-06-01T10:00:00Z' })
    await plant(trial.id, u.id, { submittedAt: '2026-06-03T10:00:00Z' })
    await plant(trial.id, u.id, { submittedAt: '2026-06-02T10:00:00Z' })

    const recent = await getRecentSubmissions(asViewer(u), new Set(), 2)
    expect(recent).toHaveLength(2)
    expect(recent[0].submittedAt).toBe('2026-06-03T10:00:00Z')
    expect(recent[1].submittedAt).toBe('2026-06-02T10:00:00Z')
    expect(recent[0].courseName).toBe(course.name)
  })

  it('omits submissions on a private trial the viewer cannot see', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    const course = await makeCourse(owner.id)
    const pub = await makeTrial(course.id, owner.id, 'open', { visibility: 'public' })
    const priv = await makeTrial(course.id, owner.id, 'open', { visibility: 'private' })
    await plant(pub.id, owner.id, { submittedAt: '2026-06-01T10:00:00Z' })
    await plant(priv.id, owner.id, { submittedAt: '2026-06-02T10:00:00Z' })

    // Stranger sees only the public one.
    const asStranger = await getRecentSubmissions(asViewer(stranger), new Set())
    expect(asStranger).toHaveLength(1)
    expect(asStranger[0].trialId).toBe(pub.id)

    // Owner sees both.
    const asOwner = await getRecentSubmissions(asViewer(owner), new Set())
    expect(asOwner).toHaveLength(2)
  })

  it('returns empty when there are no submissions', async () => {
    expect(await getRecentSubmissions(null, new Set())).toEqual([])
  })
})
