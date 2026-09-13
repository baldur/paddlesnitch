// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir, makeUser, makeCourse, makeTrial } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { GET as getEntry, PATCH as patchEntry } from '@/app/att/api/entries/[entryId]/route'
import { putJson } from '@/lib/storage'
import { cookies } from 'next/headers'

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir) })

function mockAuth(idToken: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => name === 'tt_id' && idToken ? { name, value: idToken } : undefined,
  } as ReturnType<typeof cookies> extends Promise<infer T> ? T : never)
}

async function plant(trialId: string, userId: string, entryId: string, extra: Record<string, unknown> = {}) {
  await putJson(`trials/${trialId}/entries/${userId}/${entryId}/result.json`, {
    entryId, userId, displayName: 'Paddler', submittedAt: '2025-01-01T00:00:00Z',
    filename: 'run.gpx', raceDate: '2025-01-01', boatClass: 'K1', crew: [{ seat: 1, name: 'Paddler' }],
    result: { startTimestamp: '2025-01-01T10:00:00Z', finishTimestamp: '2025-01-01T10:01:00Z', totalElapsedSeconds: 60, splits: [] },
    ...extra,
  })
}
const params = (entryId: string) => ({ params: Promise.resolve({ entryId }) })
const patchReq = (note: string) =>
  new NextRequest('http://x', { method: 'PATCH', body: JSON.stringify({ note }), headers: { 'Content-Type': 'application/json' } })

describe('entry detail + private notes (#105)', () => {
  it('anyone who can view the trial gets the entry, but NOT the owner\'s private note', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open') // public
    await plant(trial.id, owner.id, 'e1', { note: 'my secret note' })

    mockAuth(stranger.idToken)
    const res = await getEntry(new NextRequest('http://x'), params('e1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.entry.entryId).toBe('e1')
    expect(body.isOwner).toBe(false)
    expect(body.entry.note).toBeUndefined() // note is owner-only
    expect(body.trial.id).toBe(trial.id)
  })

  it('the owner sees their own private note', async () => {
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open')
    await plant(trial.id, owner.id, 'e1', { note: 'my secret note' })

    mockAuth(owner.idToken)
    const body = await (await getEntry(new NextRequest('http://x'), params('e1'))).json()
    expect(body.isOwner).toBe(true)
    expect(body.entry.note).toBe('my secret note')
  })

  it('an entry on a private trial 404s to a non-viewer (no existence leak)', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open', { visibility: 'private' })
    await plant(trial.id, owner.id, 'e1')

    mockAuth(stranger.idToken)
    const res = await getEntry(new NextRequest('http://x'), params('e1'))
    expect(res.status).toBe(404)
  })

  it('a missing entry is 404', async () => {
    mockAuth(null)
    expect((await getEntry(new NextRequest('http://x'), params('nope'))).status).toBe(404)
  })

  it('the owner can save a note; it round-trips', async () => {
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open')
    await plant(trial.id, owner.id, 'e1')

    mockAuth(owner.idToken)
    const res = await patchEntry(patchReq('felt strong on the second 500'), params('e1'))
    expect(res.status).toBe(200)
    expect((await res.json()).note).toBe('felt strong on the second 500')

    const body = await (await getEntry(new NextRequest('http://x'), params('e1'))).json()
    expect(body.entry.note).toBe('felt strong on the second 500')
  })

  it('a non-owner cannot set a note (404, not 403 — no ownership probe)', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open')
    await plant(trial.id, owner.id, 'e1')

    mockAuth(stranger.idToken)
    expect((await patchEntry(patchReq('hijack'), params('e1'))).status).toBe(404)
  })
})
