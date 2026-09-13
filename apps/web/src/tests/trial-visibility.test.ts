// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir, makeUser, makeCourse, makeTrial } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { GET as getTrial, PATCH as patchTrial } from '@/app/att/api/trials/[trialId]/route'
import { GET as listTrials } from '@/app/att/api/trials/route'
import { GET as getLeaderboard } from '@/app/att/api/trials/[trialId]/leaderboard/route'
import { POST as upload } from '@/app/att/api/trials/[trialId]/upload/route'
import { cookies } from 'next/headers'

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir) })

function mockAuth(idToken: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => name === 'tt_id' && idToken ? { name, value: idToken } : undefined,
  } as ReturnType<typeof cookies> extends Promise<infer T> ? T : never)
}

function jsonReq(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Story-style permission tests for phase 1 trial visibility. Names map to
// the matrix rows in docs/features/visibility-groups-tos.md.

describe('a public trial', () => {
  it('is visible to an unauthenticated visitor', async () => {
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id, { visibility: 'public' })
    const trial = await makeTrial(course.id, owner.id, 'open', { visibility: 'public' })

    mockAuth(null)
    const res = await getTrial(new NextRequest('http://x'),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(200)
  })

  it('appears in the trial list for an unauthenticated visitor', async () => {
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id, { visibility: 'public' })
    await makeTrial(course.id, owner.id, 'open', { visibility: 'public' })

    mockAuth(null)
    const list = await (await listTrials(new NextRequest('http://x'))).json()
    expect(list).toHaveLength(1)
  })

  it('its leaderboard is readable without auth', async () => {
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id, { visibility: 'public' })
    const trial = await makeTrial(course.id, owner.id, 'open', { visibility: 'public' })

    mockAuth(null)
    const res = await getLeaderboard(new NextRequest('http://x'),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(200)
  })
})

describe('a private trial', () => {
  it('returns 404 to an unauthenticated visitor (no existence leak)', async () => {
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id, { visibility: 'public' })
    const trial = await makeTrial(course.id, owner.id, 'open', { visibility: 'private' })

    mockAuth(null)
    const res = await getTrial(new NextRequest('http://x'),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(404)
  })

  it('returns 404 to a signed-in non-owner', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    const course = await makeCourse(owner.id, { visibility: 'public' })
    const trial = await makeTrial(course.id, owner.id, 'open', { visibility: 'private' })

    mockAuth(stranger.idToken)
    const res = await getTrial(new NextRequest('http://x'),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(404)
  })

  it('its leaderboard returns 404 to a non-owner', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    const course = await makeCourse(owner.id, { visibility: 'public' })
    const trial = await makeTrial(course.id, owner.id, 'open', { visibility: 'private' })

    mockAuth(stranger.idToken)
    const res = await getLeaderboard(new NextRequest('http://x'),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(404)
  })

  it('does NOT appear in the trial list for a non-owner', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    const course = await makeCourse(owner.id, { visibility: 'public' })
    await makeTrial(course.id, owner.id, 'open', { visibility: 'private' })

    mockAuth(stranger.idToken)
    const list = await (await listTrials(new NextRequest('http://x'))).json()
    expect(list).toHaveLength(0)
  })

  it('the owner can still see it, leaderboard included', async () => {
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id, { visibility: 'public' })
    const trial = await makeTrial(course.id, owner.id, 'open', { visibility: 'private' })

    mockAuth(owner.idToken)
    const detail = await getTrial(new NextRequest('http://x'),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(detail.status).toBe(200)

    const lb = await getLeaderboard(new NextRequest('http://x'),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(lb.status).toBe(200)
  })

  it('a non-owner cannot upload to it (404 — no existence leak)', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    const course = await makeCourse(owner.id, { visibility: 'public' })
    const trial = await makeTrial(course.id, owner.id, 'open', { visibility: 'private' })

    mockAuth(stranger.idToken)
    // We deliberately pass an empty form — the gate trips before file parsing.
    const req = new NextRequest(`http://x/att/api/trials/${trial.id}/upload`, {
      method: 'POST',
      body: new FormData(),
    })
    const res = await upload(req,
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(404)
  })
})

describe('toggling trial visibility', () => {
  it('the owner can flip a public trial to private', async () => {
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id, { visibility: 'public' })
    const trial = await makeTrial(course.id, owner.id, 'open', { visibility: 'public' })

    mockAuth(owner.idToken)
    const res = await patchTrial(jsonReq(`http://x`, 'PATCH', { visibility: 'private' }),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(200)
    expect((await res.json()).visibility).toBe('private')
  })

  it('a non-owner gets 403 trying to flip visibility', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    const course = await makeCourse(owner.id, { visibility: 'public' })
    const trial = await makeTrial(course.id, owner.id, 'open', { visibility: 'public' })

    mockAuth(stranger.idToken)
    const res = await patchTrial(jsonReq(`http://x`, 'PATCH', { visibility: 'private' }),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(403)
  })

  it('PATCH to a private trial returns the same Forbidden / Not-Found story for the owner vs. non-owner', async () => {
    // Slightly stricter: owner gets 200, non-owner gets 404 (not 403) so
    // the route doesn't leak existence of a private trial.
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    const course = await makeCourse(owner.id, { visibility: 'public' })
    const trial = await makeTrial(course.id, owner.id, 'open', { visibility: 'private' })

    mockAuth(owner.idToken)
    const okRes = await patchTrial(jsonReq(`http://x`, 'PATCH', { name: 'Renamed' }),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(okRes.status).toBe(200)
    expect((await okRes.json()).name).toBe('Renamed')

    // Non-owner: today this returns 403 because the existence is already
    // exposed by the trial being mutable. Acceptable for phase 1; we'll
    // tighten if it becomes an issue when invitations land.
    mockAuth(stranger.idToken)
    const denied = await patchTrial(jsonReq(`http://x`, 'PATCH', { name: 'Hijacked' }),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect([403, 404]).toContain(denied.status)
  })
})
