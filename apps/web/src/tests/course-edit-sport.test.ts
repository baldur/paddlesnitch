// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir, makeUser, makeCourse, makeTrial, plantEntry } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { PATCH as patchCourse } from '@/app/att/api/courses/[courseId]/route'
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

// #58 — the admin edit-course form lets the owner change name + sport.
// Sport was previously dropped silently by PATCH because it wasn't
// whitelisted; this regression covers that.
describe('#58 — patching a course sport', () => {
  it('the owner can change the sport in place when there are no entries', async () => {
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id)
    expect(course.sport).toBe('both')

    mockAuth(owner.idToken)
    const res = await patchCourse(jsonReq('PATCH', { sport: 'kayak' }),
      { params: Promise.resolve({ courseId: course.id }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sport).toBe('kayak')
    expect(body.id).toBe(course.id)
  })

  it('rejects an invalid sport value (silently drops the field)', async () => {
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id)

    mockAuth(owner.idToken)
    const res = await patchCourse(jsonReq('PATCH', { sport: 'football' }),
      { params: Promise.resolve({ courseId: course.id }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    // Untouched — bad value is ignored rather than 400'd, matching how
    // visibility and name are handled on the same endpoint.
    expect(body.sport).toBe(course.sport)
  })

  it('the owner can change the sport in place even on a course with entries (sport is not geometry)', async () => {
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id)
    await plantEntry(trial.id, owner.id)

    mockAuth(owner.idToken)
    const res = await patchCourse(jsonReq('PATCH', { sport: 'rowing' }),
      { params: Promise.resolve({ courseId: course.id }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sport).toBe('rowing')
    expect(body.id).toBe(course.id)
  })

  it('a non-owner cannot patch the sport', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    const course = await makeCourse(owner.id)

    mockAuth(stranger.idToken)
    const res = await patchCourse(jsonReq('PATCH', { sport: 'kayak' }),
      { params: Promise.resolve({ courseId: course.id }) })
    expect(res.status).toBe(403)
  })
})
