// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir, makeUser, makeCourse, makeTrial, makeGpxBuffer, makeTestTrack, plantFailedUpload } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { GET as exportData } from '@/app/api/account/export/route'
import { DELETE as deleteAccount } from '@/app/api/account/route'
import { POST as upload } from '@/app/att/api/trials/[trialId]/upload/route'
import { GET as listCourses } from '@/app/att/api/courses/route'
import { GET as getLeaderboard } from '@/app/att/api/trials/[trialId]/leaderboard/route'
import { listKeys, getJson } from '@/lib/storage'
import { claimHandle } from '@/lib/profile'
import { cookies } from 'next/headers'

let dataDir: string

beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir) })

function mockAuth(idToken: string | null, refreshToken?: string) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => {
      if (name === 'tt_id' && idToken) return { name, value: idToken }
      if (name === 'tt_refresh' && refreshToken) return { name, value: refreshToken }
      return undefined
    },
  } as ReturnType<typeof cookies> extends Promise<infer T> ? T : never)
}

function uploadReq(trialId: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  form.append('boatClass', 'K1')
  form.append('crew', JSON.stringify([{ name: 'Solo', seat: 1 }]))
  form.append('raceDate', '2024-06-01')
  return new NextRequest(`http://x/att/api/trials/${trialId}/upload`, { method: 'POST', body: form })
}

describe('GET /api/account/export', () => {
  it('returns 401 when not signed in', async () => {
    mockAuth(null)
    const res = await exportData()
    expect(res.status).toBe(401)
  })

  it('returns the signed-in user\'s data as a downloadable JSON', async () => {
    const user = await makeUser('Owner')
    mockAuth(user.idToken)

    const course = await makeCourse(user.id)
    const trial = await makeTrial(course.id, user.id, 'open')
    const gpx = makeGpxBuffer(makeTestTrack())
    await upload(uploadReq(trial.id, new File([gpx], 'r.gpx')), { params: Promise.resolve({ trialId: trial.id }) })

    const res = await exportData()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain('attachment')
    expect(res.headers.get('content-disposition')).toContain(user.id)

    const body = JSON.parse(await res.text())
    expect(body.user.id).toBe(user.id)
    expect(body.user.email).toBe(user.email)
    expect(body.ownedCourses).toHaveLength(1)
    expect(body.ownedCourses[0].id).toBe(course.id)
    expect(body.ownedTrials).toHaveLength(1)
    expect(body.submittedEntries).toHaveLength(1)
  })

  it('does not include other users\' data', async () => {
    const me = await makeUser('Me')
    const stranger = await makeUser('Stranger')
    const strangerCourse = await makeCourse(stranger.id)

    mockAuth(me.idToken)
    const res = await exportData()
    const body = JSON.parse(await res.text())
    expect(body.ownedCourses).toHaveLength(0)
    // sanity: the stranger's course exists in storage
    const all = await getJson(`courses/${strangerCourse.id}/metadata.json`)
    expect(all).not.toBeNull()
  })

  it('includes the user\'s failed uploads (GDPR Art. 15 — #70)', async () => {
    const me = await makeUser('Me')
    const organiser = await makeUser('Organiser')
    const course = await makeCourse(organiser.id)
    const trial = await makeTrial(course.id, organiser.id, 'open')
    // Me left a failed upload on someone else's trial; a stranger left one too.
    await plantFailedUpload(trial.id, me.id)
    const stranger = await makeUser('Stranger')
    await plantFailedUpload(trial.id, stranger.id)

    mockAuth(me.idToken)
    const body = JSON.parse(await (await exportData()).text())
    expect(body.failedUploads).toHaveLength(1)
    expect(body.failedUploads[0].userId).toBe(me.id)
  })
})

describe('DELETE /api/account', () => {
  it('returns 401 when not signed in', async () => {
    mockAuth(null)
    const res = await deleteAccount()
    expect(res.status).toBe(401)
  })

  it('removes the user\'s owned courses and trials', async () => {
    const user = await makeUser('Owner')
    const course = await makeCourse(user.id)
    const trial = await makeTrial(course.id, user.id, 'open')

    mockAuth(user.idToken)
    const res = await deleteAccount()
    expect(res.status).toBe(200)

    expect(await getJson(`courses/${course.id}/metadata.json`)).toBeNull()
    expect(await getJson(`trials/${trial.id}/metadata.json`)).toBeNull()
  })

  it('clears tt_id and tt_refresh on the response', async () => {
    const user = await makeUser('Owner')
    mockAuth(user.idToken)
    const res = await deleteAccount()
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(/tt_id=;|tt_id=.*Max-Age=0/i)
    expect(setCookie).toMatch(/tt_refresh=;|tt_refresh=.*Max-Age=0/i)
  })

  it('removes the user\'s entries from trials they do not own', async () => {
    const me = await makeUser('Me')
    const organiser = await makeUser('Organiser')
    const course = await makeCourse(organiser.id)
    const trial = await makeTrial(course.id, organiser.id, 'open')

    // Me uploads an entry into Organiser's trial.
    mockAuth(me.idToken)
    const gpx = makeGpxBuffer(makeTestTrack())
    await upload(uploadReq(trial.id, new File([gpx], 'r.gpx')), { params: Promise.resolve({ trialId: trial.id }) })

    // Leaderboard has 1 entry.
    let lbRes = await getLeaderboard(new NextRequest(`http://x`), { params: Promise.resolve({ trialId: trial.id }) })
    expect((await lbRes.json())).toHaveLength(1)

    // Me deletes their account.
    mockAuth(me.idToken)
    const del = await deleteAccount()
    expect(del.status).toBe(200)

    // Organiser's trial and course are still there.
    expect(await getJson(`trials/${trial.id}/metadata.json`)).not.toBeNull()
    expect(await getJson(`courses/${course.id}/metadata.json`)).not.toBeNull()

    // Leaderboard rebuilt without Me's entry.
    lbRes = await getLeaderboard(new NextRequest(`http://x`), { params: Promise.resolve({ trialId: trial.id }) })
    expect((await lbRes.json())).toHaveLength(0)

    // Me's entry files are gone.
    const meEntries = await listKeys(`trials/${trial.id}/entries/${me.id}/`)
    expect(meEntries).toHaveLength(0)
  })

  it('removes the user\'s failed uploads from trials they do not own (GDPR Art. 17 — #70)', async () => {
    const me = await makeUser('Me')
    const organiser = await makeUser('Organiser')
    const course = await makeCourse(organiser.id)
    const trial = await makeTrial(course.id, organiser.id, 'open')
    await plantFailedUpload(trial.id, me.id)
    const strangerKey = await plantFailedUpload(trial.id, organiser.id)

    mockAuth(me.idToken)
    expect((await deleteAccount()).status).toBe(200)

    // Me's failed-upload track is gone; the organiser's trial + their own
    // failed upload survive.
    expect(await listKeys(`trials/${trial.id}/failed-uploads/${me.id}/`)).toHaveLength(0)
    expect(await getJson(`trials/${trial.id}/metadata.json`)).not.toBeNull()
    expect(await getJson(strangerKey)).not.toBeNull()
  })

  it('wipes the users/ prefix and releases a claimed handle (#83)', async () => {
    const me = await makeUser('Me')
    mockAuth(me.idToken)
    await claimHandle(me.id, 'gone-soon')
    // sanity: index + profile.json exist before deletion
    expect(await getJson(`usernames/gone-soon.json`)).not.toBeNull()
    expect(await listKeys(`users/${me.id}/`)).not.toHaveLength(0)

    expect((await deleteAccount()).status).toBe(200)

    // Handle index released and the whole users/{id}/ prefix gone.
    expect(await getJson(`usernames/gone-soon.json`)).toBeNull()
    expect(await listKeys(`users/${me.id}/`)).toHaveLength(0)
  })

  it('leaves other users\' data untouched', async () => {
    const me = await makeUser('Me')
    const stranger = await makeUser('Stranger')
    const strangerCourse = await makeCourse(stranger.id)

    mockAuth(me.idToken)
    await deleteAccount()

    // Stranger's course should still be there.
    expect(await getJson(`courses/${strangerCourse.id}/metadata.json`)).not.toBeNull()
  })

  it('after deletion, courses listing no longer shows the user\'s courses', async () => {
    const me = await makeUser('Me')
    const stranger = await makeUser('Stranger')
    await makeCourse(me.id, )
    await makeCourse(stranger.id)

    mockAuth(me.idToken)
    await deleteAccount()

    mockAuth(null)
    const res = await listCourses(new NextRequest('http://x/att/api/courses'))
    const list = await res.json()
    expect(list).toHaveLength(1)
    expect(list[0].adminUserId).toBe(stranger.id)
  })
})
