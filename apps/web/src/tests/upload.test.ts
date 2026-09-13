// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  makeDataDir, cleanDataDir, makeUser, makeCourse, makeTrial,
  makeGpxBuffer, makeTestTrack,
} from './helpers'
import { listKeys, getJson } from '@/lib/storage'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { POST as upload } from '@/app/att/api/trials/[trialId]/upload/route'
import { GET as leaderboard } from '@/app/att/api/trials/[trialId]/leaderboard/route'
import { cookies } from 'next/headers'

let dataDir: string

beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir) })

function mockAuth(idToken: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => name === 'tt_id' && idToken ? { name, value: idToken } : undefined,
  } as ReturnType<typeof cookies> extends Promise<infer T> ? T : never)
}

function uploadReq(trialId: string, file: File, opts: {
  boatClass?: string
  crew?: Array<{ name: string; seat: number | 'C' }>
} = {}) {
  const boatClass = opts.boatClass ?? 'K1'
  const form = new FormData()
  form.append('file', file)
  form.append('boatClass', boatClass)
  // Default crew = one seat for the singles the most tests use.
  const defaultCrew = opts.crew ?? (boatClass === 'K1' || boatClass === '1X'
    ? [{ name: 'Soloist', seat: 1 as const }]
    : undefined)
  if (defaultCrew) form.append('crew', JSON.stringify(defaultCrew))
  // No raceDate: it's inferred server-side from the trace (#123).
  return new NextRequest(`http://x/att/api/trials/${trialId}/upload`, {
    method: 'POST',
    body: form,
  })
}

describe('POST /att/api/trials/[trialId]/upload', () => {
  it('processes a GPX file and returns a result with elapsed time', async () => {
    const user = await makeUser()
    const course = await makeCourse(user.id)
    const trial = await makeTrial(course.id, user.id, 'open')
    mockAuth(user.idToken)

    const gpx = makeGpxBuffer(makeTestTrack())
    const file = new File([gpx], 'activity.gpx', { type: 'application/gpx+xml' })
    const res = await upload(uploadReq(trial.id, file), { params: Promise.resolve({ trialId: trial.id }) })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.result.totalElapsedSeconds).toBeGreaterThan(0)
    expect(body.entryId).toBeTruthy()
  })

  it('result appears on the leaderboard after upload', async () => {
    const user = await makeUser('Test User')
    const course = await makeCourse(user.id)
    const trial = await makeTrial(course.id, user.id, 'open')
    mockAuth(user.idToken)

    const gpx = makeGpxBuffer(makeTestTrack())
    await upload(
      uploadReq(trial.id, new File([gpx], 'run.gpx'), {
        boatClass: 'K2',
        crew: [
          { name: 'Bow', seat: 1 },
          { name: 'Stroke', seat: 2 },
        ],
      }),
      { params: Promise.resolve({ trialId: trial.id }) },
    )

    const lb = await leaderboard(
      new NextRequest(`http://x/att/api/trials/${trial.id}/leaderboard`),
      { params: Promise.resolve({ trialId: trial.id }) },
    )
    expect(lb.status).toBe(200)
    const entries = await lb.json()
    expect(entries).toHaveLength(1)
    // cognito-local doesn't surface the name attribute in JWT claims,
    // so displayName falls back to the email-local-part in test environments.
    expect(entries[0].displayName).toBe(user.email.split('@')[0])
    expect(entries[0].totalElapsedSeconds).toBeGreaterThan(0)
    expect(entries[0].boatClass).toBe('K2')
    expect(entries[0].crew).toEqual([
      { name: 'Bow', seat: 1 },
      { name: 'Stroke', seat: 2 },
    ])
  })

  it('returns 400 when boatClass is missing', async () => {
    const user = await makeUser()
    const course = await makeCourse(user.id)
    const trial = await makeTrial(course.id, user.id, 'open')
    mockAuth(user.idToken)

    const gpx = makeGpxBuffer(makeTestTrack())
    const form = new FormData()
    form.append('file', new File([gpx], 'run.gpx'))
    // boatClass intentionally omitted
    const req = new NextRequest(`http://x/att/api/trials/${trial.id}/upload`, {
      method: 'POST',
      body: form,
    })
    const res = await upload(req, { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(400)
  })

  it('returns 400 when boatClass is an unknown value', async () => {
    const user = await makeUser()
    const course = await makeCourse(user.id)
    const trial = await makeTrial(course.id, user.id, 'open')
    mockAuth(user.idToken)

    const gpx = makeGpxBuffer(makeTestTrack())
    const res = await upload(
      uploadReq(trial.id, new File([gpx], 'run.gpx'), { boatClass: 'Coracle' }),
      { params: Promise.resolve({ trialId: trial.id }) },
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 when crew size does not match boat class', async () => {
    const user = await makeUser()
    const course = await makeCourse(user.id)
    const trial = await makeTrial(course.id, user.id, 'open')
    mockAuth(user.idToken)

    const gpx = makeGpxBuffer(makeTestTrack())
    // K2 needs 2 crew, we only provide 1
    const res = await upload(
      uploadReq(trial.id, new File([gpx], 'run.gpx'), { boatClass: 'K2', crew: [{ name: 'Solo', seat: 1 }] }),
      { params: Promise.resolve({ trialId: trial.id }) },
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('needs 2')
  })

  it('returns 400 when crew has duplicate seats', async () => {
    const user = await makeUser()
    const course = await makeCourse(user.id)
    const trial = await makeTrial(course.id, user.id, 'open')
    mockAuth(user.idToken)

    const gpx = makeGpxBuffer(makeTestTrack())
    const res = await upload(
      uploadReq(trial.id, new File([gpx], 'run.gpx'), {
        boatClass: 'K2',
        crew: [
          { name: 'A', seat: 1 },
          { name: 'B', seat: 1 },
        ],
      }),
      { params: Promise.resolve({ trialId: trial.id }) },
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('listed more than once')
  })

  it('returns 400 when a multi-person boat is missing the cox', async () => {
    const user = await makeUser()
    const course = await makeCourse(user.id)
    const trial = await makeTrial(course.id, user.id, 'open')
    mockAuth(user.idToken)

    const gpx = makeGpxBuffer(makeTestTrack())
    // 4+ requires 5 seats: 1-4 + C
    const res = await upload(
      uploadReq(trial.id, new File([gpx], 'run.gpx'), {
        boatClass: '4+',
        crew: [
          { name: 'B', seat: 1 },
          { name: 'C', seat: 2 },
          { name: 'D', seat: 3 },
          { name: 'S', seat: 4 },
        ],
      }),
      { params: Promise.resolve({ trialId: trial.id }) },
    )
    expect(res.status).toBe(400)
  })

  it('returns 422 for an unknown file format', async () => {
    const user = await makeUser()
    const course = await makeCourse(user.id)
    const trial = await makeTrial(course.id, user.id, 'open')
    mockAuth(user.idToken)

    const file = new File(['not a gps file'], 'data.txt', { type: 'text/plain' })
    const res = await upload(uploadReq(trial.id, file), { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(422)
  })

  it('returns 422 when track does not cross the course lines', async () => {
    const user = await makeUser()
    const course = await makeCourse(user.id)
    const trial = await makeTrial(course.id, user.id, 'open')
    mockAuth(user.idToken)

    const offCourse = makeGpxBuffer([[1.0, 0.0, '2024-06-01T10:00:00Z'], [1.1, 0.0, '2024-06-01T10:01:00Z']])
    const file = new File([offCourse], 'activity.gpx')
    const res = await upload(uploadReq(trial.id, file), { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(422)
  })

  it('returns the parsed track + course as a diagnostic when the track does not cross', async () => {
    const user = await makeUser()
    const course = await makeCourse(user.id)
    const trial = await makeTrial(course.id, user.id, 'open')
    mockAuth(user.idToken)

    const offCourse = makeGpxBuffer([[1.0, 0.0, '2024-06-01T10:00:00Z'], [1.1, 0.0, '2024-06-01T10:01:00Z']])
    const file = new File([offCourse], 'activity.gpx')
    const res = await upload(uploadReq(trial.id, file), { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(422)

    const body = await res.json()
    // The track comes back as [lat, lng] pairs so the upload page can draw it.
    expect(body.diagnostic.track).toEqual([[1.0, 0.0], [1.1, 0.0]])
    // The course geometry comes back so the map can draw the start/finish lines.
    expect(body.diagnostic.course.startLine).toEqual(course.startLine)
  })

  it('persists the full failing track + course to S3 for offline debugging (#66)', async () => {
    const user = await makeUser()
    const course = await makeCourse(user.id)
    const trial = await makeTrial(course.id, user.id, 'open')
    mockAuth(user.idToken)

    const offCourse = makeGpxBuffer([[1.0, 0.0, '2024-06-01T10:00:00Z'], [1.1, 0.0, '2024-06-01T10:01:00Z']])
    const file = new File([offCourse], 'activity.gpx')
    const res = await upload(uploadReq(trial.id, file), { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(422)

    const keys = await listKeys(`trials/${trial.id}/failed-uploads/${user.id}/`)
    const diagKey = keys.find(k => k.endsWith('diagnostic.json'))
    expect(diagKey).toBeDefined()

    const saved = await getJson<{
      trackPointCount: number
      track: Array<{ lat: number; lng: number; timestamp: string }>
      course: { startLine: unknown }
    }>(diagKey!)
    // Full-fidelity track (not the downsampled response copy) with timestamps,
    // so the exact failure can be replayed against geo.ts.
    expect(saved!.trackPointCount).toBe(2)
    expect(saved!.track).toEqual([
      { lat: 1.0, lng: 0.0, timestamp: '2024-06-01T10:00:00.000Z' },
      { lat: 1.1, lng: 0.0, timestamp: '2024-06-01T10:01:00.000Z' },
    ])
    expect(saved!.course.startLine).toEqual(course.startLine)
  })

  it('gate course: failure returns a gate-specific diagnosis instead of the generic error', async () => {
    const user = await makeUser()
    const course = await makeCourse(user.id, { gate: true })
    const trial = await makeTrial(course.id, user.id, 'open')
    mockAuth(user.idToken)

    // Track nowhere near the gates → the start gate is never crossed.
    const offCourse = makeGpxBuffer([[1.0, 0.0, '2024-06-01T10:00:00Z'], [1.1, 0.0, '2024-06-01T10:01:00Z']])
    const res = await upload(uploadReq(trial.id, new File([offCourse], 'activity.gpx')), { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(422)

    const body = await res.json()
    expect(body.error).toMatch(/Gate 1 was not crossed/)
    expect(body.diagnostic.gateAnalysis.blocking).toEqual({ gateNumber: 1, requiredDirection: 1, reason: 'not_crossed' })
  })

  it('returns 400 when the trial is closed', async () => {
    const user = await makeUser()
    const course = await makeCourse(user.id)
    const trial = await makeTrial(course.id, user.id, 'closed')
    mockAuth(user.idToken)

    const gpx = makeGpxBuffer(makeTestTrack())
    const res = await upload(uploadReq(trial.id, new File([gpx], 'run.gpx')), { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(400)
  })

  it('returns 401 when not authenticated', async () => {
    const user = await makeUser()
    const course = await makeCourse(user.id)
    const trial = await makeTrial(course.id, user.id, 'open')
    mockAuth(null)

    const gpx = makeGpxBuffer(makeTestTrack())
    const res = await upload(uploadReq(trial.id, new File([gpx], 'run.gpx')), { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(401)
  })

  it('infers raceDate from the trace, not a user-supplied field (#123)', async () => {
    const user = await makeUser()
    const course = await makeCourse(user.id)
    // Trial date deliberately differs from the trace date to prove we use the
    // trace, not the trial, when the trace has a timestamp.
    const trial = await makeTrial(course.id, user.id, 'open', { date: '2020-01-01' })
    mockAuth(user.idToken)

    const gpx = makeGpxBuffer(makeTestTrack())  // trace recorded 2024-06-01
    const res = await upload(
      uploadReq(trial.id, new File([gpx], 'run.gpx')),
      { params: Promise.resolve({ trialId: trial.id }) },
    )
    expect(res.status).toBe(201)
    const { entryId } = await res.json()
    const stored = await getJson<{ raceDate: string }>(
      `trials/${trial.id}/entries/${user.id}/${entryId}/result.json`,
    )
    expect(stored?.raceDate).toBe('2024-06-01')
  })
})
