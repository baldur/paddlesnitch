import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { nanoid } from 'nanoid'
import { signUp, signIn } from '@/lib/cognito'
import { putJson } from '@/lib/storage'
import type { CourseMetadata, TrialMetadata, Participation } from '@/lib/types'

export async function makeDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'att-test-'))
  process.env.DATA_DIR = dir
  process.env.USE_LOCAL_STORAGE = 'true'
  return dir
}

export async function cleanDataDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
  delete process.env.DATA_DIR
}

let userCounter = 0

export type TestUser = {
  id: string
  email: string
  displayName: string
  idToken: string
  refreshToken: string
}

// Creates a fresh user in cognito-local and returns the user record + tokens.
// Each call uses a unique email so tests can share the pool without collision.
export async function makeUser(displayName = 'Test User'): Promise<TestUser> {
  // crypto.randomUUID guarantees uniqueness across parallel test files, where
  // ++counter + Date.now() can still collide when fired in the same ms.
  const { randomUUID } = await import('crypto')
  const email = `test-${++userCounter}-${randomUUID().slice(0, 8)}@example.com`
  const password = 'Password123'

  const created = await signUp(email, displayName, password)
  if ('error' in created) throw new Error(`signUp failed: ${created.error}`)

  const tokens = await signIn(email, password)
  if ('error' in tokens) throw new Error(`signIn failed: ${tokens.error}`)

  return {
    id: created.sub,
    email,
    displayName,
    idToken: tokens.idToken,
    refreshToken: tokens.refreshToken,
  }
}

export async function makeCourse(
  adminUserId: string,
  opts: { visibility?: 'public' | 'private'; gate?: boolean } = {},
): Promise<CourseMetadata> {
  const course: CourseMetadata = {
    id: nanoid(),
    name: 'Test Course',
    sport: 'both',
    type: 'point_to_point',
    adminUserId,
    startLine: [[51.525, -0.91], [51.525, -0.89]],
    finishLine: [[51.575, -0.91], [51.575, -0.89]],
    distanceMetres: 556,
    visibility: opts.visibility ?? 'public',
    createdAt: new Date().toISOString(),
  }
  if (opts.gate) {
    // Two-gate course, both required northbound (+1). Same line positions as the
    // start/finish above so existing test tracks still cross them.
    course.type = 'gate'
    course.gateDirection = 1
    course.gates = [
      { line: [[51.525, -0.91], [51.525, -0.89]], direction: 1 },
      { line: [[51.575, -0.91], [51.575, -0.89]], direction: 1 },
    ]
  }
  await putJson(`courses/${course.id}/metadata.json`, course)
  return course
}

export async function makeTrial(
  courseId: string,
  adminUserId: string,
  status: 'open' | 'closed' = 'open',
  opts: {
    visibility?: 'public' | 'private'
    participation?: Participation
    invitedUserIds?: string[]
    date?: string
    groupId?: string
  } = {},
): Promise<TrialMetadata> {
  const trial: TrialMetadata = {
    id: nanoid(),
    courseId,
    name: 'Test Trial',
    date: opts.date ?? '2024-06-01',
    status,
    ...(opts.groupId ? { groupId: opts.groupId } : {}),
    adminUserId,
    visibility: opts.visibility ?? 'public',
    participation: opts.participation ?? 'public',
    invitedUserIds: opts.invitedUserIds ?? [],
    createdAt: new Date().toISOString(),
  }
  await putJson(`trials/${trial.id}/metadata.json`, trial)
  return trial
}

export function makeGpxBuffer(points: Array<[number, number, string]>): ArrayBuffer {
  const trkpts = points
    .map(([lat, lng, time]) => `<trkpt lat="${lat}" lon="${lng}"><time>${time}</time></trkpt>`)
    .join('\n')
  const gpx = `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>${trkpts}</trkseg></trk></gpx>`
  return new TextEncoder().encode(gpx).buffer as ArrayBuffer
}

// Plants a result.json under a trial so courseHasEntries() sees the trial
// as "raced on" without going through the full upload pipeline.
export async function plantEntry(trialId: string, userId: string): Promise<void> {
  const entryId = nanoid()
  await putJson(`trials/${trialId}/entries/${userId}/${entryId}/result.json`, {
    entryId, userId, displayName: 'planted',
    submittedAt: new Date().toISOString(),
    filename: 'planted.gpx',
    raceDate: '2024-06-01',
    boatClass: 'K1',
    crew: [{ seat: 1, name: 'planted' }],
    result: { startTimestamp: '2024-06-01T10:00:00Z', finishTimestamp: '2024-06-01T10:01:00Z', totalElapsedSeconds: 60, splits: [] },
  })
}

// Mirrors what the upload route persists when a trace fails to match (see #69).
// Returns the storage key so callers can assert on it.
export async function plantFailedUpload(trialId: string, userId: string): Promise<string> {
  const failureId = nanoid()
  const key = `trials/${trialId}/failed-uploads/${userId}/${failureId}/diagnostic.json`
  await putJson(key, {
    failedAt: new Date().toISOString(),
    trialId, userId, displayName: 'planted',
    filename: 'planted.gpx',
    trackPointCount: 1,
    track: [{ lat: 1, lng: 1, timestamp: '2024-06-01T10:00:00.000Z' }],
  })
  return key
}

export function makeTestTrack(): Array<[number, number, string]> {
  return Array.from({ length: 11 }, (_, i) => [
    parseFloat((51.50 + i * 0.01).toFixed(4)),
    -0.9,
    new Date(Date.UTC(2024, 5, 1, 10, i, 0)).toISOString(),
  ] as [number, number, string])
}
