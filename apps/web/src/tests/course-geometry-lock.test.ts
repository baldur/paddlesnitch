// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir, makeUser, makeCourse, makeTrial, plantEntry } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { PATCH as patchCourse, GET as getCourse } from '@/app/att/api/courses/[courseId]/route'
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

// Geometry is locked once a course has entries: the edit is rejected (409),
// not cloned. Name + visibility stay editable. Clone-and-recompute is #72.

describe('editing a course with NO entries', () => {
  it('the owner can rename in place', async () => {
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id)

    mockAuth(owner.idToken)
    const res = await patchCourse(jsonReq('PATCH', { name: 'New Name' }),
      { params: Promise.resolve({ courseId: course.id }) })
    expect(res.status).toBe(200)
    expect((await res.json()).name).toBe('New Name')
  })

  it('the owner can change geometry in place (no entries to invalidate)', async () => {
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id)

    mockAuth(owner.idToken)
    const res = await patchCourse(jsonReq('PATCH', {
      startLine: [[52.0, -1.0], [52.0, -0.99]],
      distanceMetres: 999,
    }), { params: Promise.resolve({ courseId: course.id }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.distanceMetres).toBe(999)
    // Same id — no clone happened.
    expect(body.id).toBe(course.id)
  })
})

describe('editing a course WITH entries', () => {
  it('the owner can still rename in place (non-geometry edit)', async () => {
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id)
    await plantEntry(trial.id, owner.id)

    mockAuth(owner.idToken)
    const res = await patchCourse(jsonReq('PATCH', { name: 'Tidy Name' }),
      { params: Promise.resolve({ courseId: course.id }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(course.id)
    expect(body.name).toBe('Tidy Name')
  })

  it('changing visibility in place is also fine (does not invalidate results)', async () => {
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id)
    await plantEntry(trial.id, owner.id)

    mockAuth(owner.idToken)
    const res = await patchCourse(jsonReq('PATCH', { visibility: 'private' }),
      { params: Promise.resolve({ courseId: course.id }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(course.id)
    expect(body.visibility).toBe('private')
  })

  it('changing geometry is rejected (409) and leaves the original untouched', async () => {
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id)
    await plantEntry(trial.id, owner.id)

    mockAuth(owner.idToken)
    const res = await patchCourse(jsonReq('PATCH', {
      distanceMetres: 1234,
      startLine: [[52.0, -1.0], [52.0, -0.99]],
    }), { params: Promise.resolve({ courseId: course.id }) })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('course_has_entries')

    // Original geometry is untouched.
    mockAuth(owner.idToken)
    const orig = await (await getCourse(new NextRequest('http://x'),
      { params: Promise.resolve({ courseId: course.id }) })).json()
    expect(orig.distanceMetres).not.toBe(1234)
  })

  it('a geometry edit that matches the current geometry is a no-op, not a rejection', async () => {
    // geometryChanged only fires on an actual difference, so re-sending the
    // existing distance alongside a name change must still succeed.
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id)
    await plantEntry(trial.id, owner.id)

    mockAuth(owner.idToken)
    const res = await patchCourse(jsonReq('PATCH', {
      name: 'Same Geometry',
      distanceMetres: course.distanceMetres,
    }), { params: Promise.resolve({ courseId: course.id }) })
    expect(res.status).toBe(200)
    expect((await res.json()).name).toBe('Same Geometry')
  })

  it('a non-owner cannot edit geometry (403, before the lock check)', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id)
    await plantEntry(trial.id, owner.id)

    mockAuth(stranger.idToken)
    const res = await patchCourse(jsonReq('PATCH', { distanceMetres: 1234 }),
      { params: Promise.resolve({ courseId: course.id }) })
    expect(res.status).toBe(403)
  })
})
