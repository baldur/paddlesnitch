// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { GET as listCourses, POST as createCourse } from '@/app/att/api/courses/route'
import { GET as getCourse, PATCH as patchCourse } from '@/app/att/api/courses/[courseId]/route'
import { POST as createTrial } from '@/app/att/api/trials/route'
import { POST as createGroup } from '@/app/att/api/groups/route'
import { cookies } from 'next/headers'

let dataDir: string

beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir) })

function mockAuth(idToken: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => name === 'tt_id' && idToken ? { name, value: idToken } : undefined,
  } as ReturnType<typeof cookies> extends Promise<infer T> ? T : never)
}

function jsonReq(url: string, method: string, body: unknown) {
  return new NextRequest(url, {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

// Creates a group owned by the caller, then a course in it. Owning the group
// makes the caller a group admin → they can create + manage the course.
async function buildCourse(ownerIdToken: string, name = 'Test Course') {
  mockAuth(ownerIdToken)
  const group = await (await createGroup(jsonReq('http://x/att/api/groups', 'POST', { name: 'G' }))).json()
  const res = await createCourse(jsonReq('http://x/att/api/courses', 'POST', {
    name,
    sport: 'kayak',
    type: 'point_to_point',
    startLine: [[51.5, -0.9], [51.5, -0.89]],
    finishLine: [[51.55, -0.9], [51.55, -0.89]],
    distanceMetres: 5000,
    groupId: group.id,
  }))
  return await res.json()
}

describe('Courses are a public catalogue', () => {
  it('GET /courses lists all courses without auth', async () => {
    const owner = await makeUser('Owner')
    await buildCourse(owner.idToken, 'A')
    await buildCourse(owner.idToken, 'B')

    mockAuth(null)
    const res = await listCourses(new NextRequest('http://x/att/api/courses'))
    expect(res.status).toBe(200)
    const list = await res.json()
    expect(list).toHaveLength(2)
    expect(list.map((c: { name: string }) => c.name).sort()).toEqual(['A', 'B'])
  })

  it('GET /courses/[id] is readable without auth', async () => {
    const owner = await makeUser('Owner')
    const course = await buildCourse(owner.idToken)

    mockAuth(null)
    const res = await getCourse(new NextRequest('http://x'), { params: Promise.resolve({ courseId: course.id }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('Test Course')
  })

  it('a non-group-admin cannot open a trial on someone else\'s public course (403)', async () => {
    // Phase 2: trial creation is gated to the course\'s group admins. A stranger
    // who can SEE a public course can no longer open a trial on it.
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    const course = await buildCourse(owner.idToken)

    mockAuth(stranger.idToken)
    const res = await createTrial(jsonReq('http://x/att/api/trials', 'POST', {
      courseId: course.id,
      name: 'Stranger\'s Trial',
      date: '2026-05-01',
    }))
    expect(res.status).toBe(403)
  })

  it('the course\'s group admin can open a trial, which inherits the course\'s group', async () => {
    const owner = await makeUser('Owner')
    const course = await buildCourse(owner.idToken)

    mockAuth(owner.idToken)
    const res = await createTrial(jsonReq('http://x/att/api/trials', 'POST', {
      courseId: course.id,
      name: 'Owner\'s Trial',
      date: '2026-05-01',
    }))
    expect(res.status).toBe(201)
    const trial = await res.json()
    expect(trial.adminUserId).toBe(owner.id)
    expect(trial.groupId).toBe(course.groupId)
  })
})

describe('Course edits are owner-only', () => {
  it('owner can PATCH their course', async () => {
    const owner = await makeUser('Owner')
    const course = await buildCourse(owner.idToken)

    mockAuth(owner.idToken)
    const res = await patchCourse(jsonReq(`http://x/att/api/courses/${course.id}`, 'PATCH', { name: 'Renamed' }),
      { params: Promise.resolve({ courseId: course.id }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('Renamed')
  })

  it('non-owner cannot PATCH a course', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    const course = await buildCourse(owner.idToken)

    mockAuth(stranger.idToken)
    const res = await patchCourse(jsonReq(`http://x/att/api/courses/${course.id}`, 'PATCH', { name: 'Hijacked' }),
      { params: Promise.resolve({ courseId: course.id }) })
    expect(res.status).toBe(403)
  })

  it('unauthenticated PATCH is rejected', async () => {
    const owner = await makeUser('Owner')
    const course = await buildCourse(owner.idToken)

    mockAuth(null)
    const res = await patchCourse(jsonReq(`http://x/att/api/courses/${course.id}`, 'PATCH', { name: 'Anon' }),
      { params: Promise.resolve({ courseId: course.id }) })
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Phase 1 visibility — story-style permission tests. Story titles mirror
// rows of the permission matrix in docs/features/visibility-groups-tos.md.
// ---------------------------------------------------------------------------

async function buildPrivateCourse(ownerIdToken: string, name = 'Private Course') {
  mockAuth(ownerIdToken)
  const group = await (await createGroup(jsonReq('http://x/att/api/groups', 'POST', { name: 'G' }))).json()
  const res = await createCourse(jsonReq('http://x/att/api/courses', 'POST', {
    name,
    sport: 'kayak',
    type: 'point_to_point',
    startLine: [[51.5, -0.9], [51.5, -0.89]],
    finishLine: [[51.55, -0.9], [51.55, -0.89]],
    distanceMetres: 5000,
    groupId: group.id,
    visibility: 'private',
  }))
  return await res.json()
}

describe('a public course', () => {
  it('is visible to an unauthenticated visitor', async () => {
    const owner = await makeUser('Owner')
    const course = await buildCourse(owner.idToken, 'Public C')
    mockAuth(null)
    const res = await getCourse(new NextRequest('http://x'),
      { params: Promise.resolve({ courseId: course.id }) })
    expect(res.status).toBe(200)
  })

  it('is visible to any signed-in non-owner', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    const course = await buildCourse(owner.idToken)
    mockAuth(stranger.idToken)
    const res = await getCourse(new NextRequest('http://x'),
      { params: Promise.resolve({ courseId: course.id }) })
    expect(res.status).toBe(200)
  })

  it('appears in the catalogue for an unauthenticated visitor', async () => {
    const owner = await makeUser('Owner')
    await buildCourse(owner.idToken, 'Listed')
    mockAuth(null)
    const list = await (await listCourses(new NextRequest('http://x/att/api/courses'))).json()
    expect(list.map((c: { name: string }) => c.name)).toContain('Listed')
  })
})

describe('a private course', () => {
  it('returns 404 to an unauthenticated visitor (no existence leak)', async () => {
    const owner = await makeUser('Owner')
    const course = await buildPrivateCourse(owner.idToken)
    mockAuth(null)
    const res = await getCourse(new NextRequest('http://x'),
      { params: Promise.resolve({ courseId: course.id }) })
    expect(res.status).toBe(404)
  })

  it('returns 404 to a signed-in non-owner', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    const course = await buildPrivateCourse(owner.idToken)
    mockAuth(stranger.idToken)
    const res = await getCourse(new NextRequest('http://x'),
      { params: Promise.resolve({ courseId: course.id }) })
    expect(res.status).toBe(404)
  })

  it('is visible to its owner', async () => {
    const owner = await makeUser('Owner')
    const course = await buildPrivateCourse(owner.idToken)
    mockAuth(owner.idToken)
    const res = await getCourse(new NextRequest('http://x'),
      { params: Promise.resolve({ courseId: course.id }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('Private Course')
  })

  it('does NOT appear in the catalogue for an unauthenticated visitor', async () => {
    const owner = await makeUser('Owner')
    await buildPrivateCourse(owner.idToken, 'Hidden')
    mockAuth(null)
    const list = await (await listCourses(new NextRequest('http://x/att/api/courses'))).json()
    expect(list.map((c: { name: string }) => c.name)).not.toContain('Hidden')
  })

  it('does NOT appear in the catalogue for a signed-in non-owner', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    await buildPrivateCourse(owner.idToken, 'Hidden')
    mockAuth(stranger.idToken)
    const list = await (await listCourses(new NextRequest('http://x/att/api/courses'))).json()
    expect(list.map((c: { name: string }) => c.name)).not.toContain('Hidden')
  })

  it('DOES appear in the catalogue for its own owner', async () => {
    const owner = await makeUser('Owner')
    await buildPrivateCourse(owner.idToken, 'Mine')
    mockAuth(owner.idToken)
    const list = await (await listCourses(new NextRequest('http://x/att/api/courses'))).json()
    expect(list.map((c: { name: string }) => c.name)).toContain('Mine')
  })
})

describe('toggling visibility', () => {
  it('the owner can flip a course from public to private', async () => {
    const owner = await makeUser('Owner')
    const course = await buildCourse(owner.idToken)
    mockAuth(owner.idToken)
    const res = await patchCourse(jsonReq(`http://x/att/api/courses/${course.id}`, 'PATCH', { visibility: 'private' }),
      { params: Promise.resolve({ courseId: course.id }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.visibility).toBe('private')
  })

  it('a non-owner cannot flip visibility', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    const course = await buildCourse(owner.idToken)
    mockAuth(stranger.idToken)
    const res = await patchCourse(jsonReq(`http://x/att/api/courses/${course.id}`, 'PATCH', { visibility: 'private' }),
      { params: Promise.resolve({ courseId: course.id }) })
    expect(res.status).toBe(403)
  })

  it('PATCH cannot reassign ownership by sneaking adminUserId through', async () => {
    const owner = await makeUser('Owner')
    const attacker = await makeUser('Attacker')
    const course = await buildCourse(owner.idToken)
    mockAuth(owner.idToken)
    const res = await patchCourse(
      jsonReq(`http://x/att/api/courses/${course.id}`, 'PATCH', { name: 'OK', adminUserId: attacker.id }),
      { params: Promise.resolve({ courseId: course.id }) }
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.adminUserId).toBe(owner.id)
  })
})

describe('creating a trial on a private course', () => {
  it('a non-owner gets 404 (private course is hidden from trial-creation)', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    const course = await buildPrivateCourse(owner.idToken)
    mockAuth(stranger.idToken)
    const res = await createTrial(jsonReq('http://x/att/api/trials', 'POST', {
      courseId: course.id,
      name: 'Sneaky',
      date: '2026-05-01',
    }))
    expect(res.status).toBe(404)
  })

  it('the owner can create a trial, which is forced to private', async () => {
    const owner = await makeUser('Owner')
    const course = await buildPrivateCourse(owner.idToken)
    mockAuth(owner.idToken)
    const res = await createTrial(jsonReq('http://x/att/api/trials', 'POST', {
      courseId: course.id,
      name: 'Mine',
      date: '2026-05-01',
      visibility: 'public',     // owner asks for public…
    }))
    expect(res.status).toBe(201)
    const trial = await res.json()
    expect(trial.visibility).toBe('private')   // …server clamps to private.
  })
})
