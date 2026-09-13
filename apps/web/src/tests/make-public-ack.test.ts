// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir, makeUser, makeCourse, makeTrial } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { PATCH as patchTrial } from '@/app/att/api/trials/[trialId]/route'
import { cookies } from 'next/headers'

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir) })

function mockAuth(idToken: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => name === 'tt_id' && idToken ? { name, value: idToken } : undefined,
  } as ReturnType<typeof cookies> extends Promise<infer T> ? T : never)
}

function jsonReq(method: string, body?: unknown) {
  return new NextRequest('http://x', {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Phase 5: flipping a trial from private to public requires `acknowledged:
// true`. The ToS warns participants that performance times may become
// public, so we don't chase per-entry consent — but we do require the
// owner to explicitly tick the box.

describe('make-public acknowledgement', () => {
  it('private → public WITHOUT acknowledged returns 422 with a clear code', async () => {
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open', { visibility: 'private' })

    mockAuth(owner.idToken)
    const res = await patchTrial(jsonReq('PATCH', { visibility: 'public' }),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('make_public_ack_required')
  })

  it('private → public WITH acknowledged: true succeeds', async () => {
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open', { visibility: 'private' })

    mockAuth(owner.idToken)
    const res = await patchTrial(jsonReq('PATCH', { visibility: 'public', acknowledged: true }),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(200)
    expect((await res.json()).visibility).toBe('public')
  })

  it('public → private does NOT require acknowledgement (privacy-friendly flip)', async () => {
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open', { visibility: 'public' })

    mockAuth(owner.idToken)
    const res = await patchTrial(jsonReq('PATCH', { visibility: 'private' }),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(200)
    expect((await res.json()).visibility).toBe('private')
  })

  it('public → public no-op does NOT require acknowledgement (idempotent)', async () => {
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open', { visibility: 'public' })

    mockAuth(owner.idToken)
    const res = await patchTrial(jsonReq('PATCH', { visibility: 'public' }),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(200)
  })

  it('non-owner attempting to flip is still blocked at 403 BEFORE the ack check runs', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open', { visibility: 'private' })

    mockAuth(stranger.idToken)
    const res = await patchTrial(jsonReq('PATCH', { visibility: 'public', acknowledged: true }),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(403)
  })
})
