// Paddler profile pages (#vanity-profiles). A profile aggregates one user's
// race results across every trial into vanity stats. Two hard rules:
//   1. Opt-in: a profile is private (owner-only) until the user makes it public.
//   2. A profile NEVER reveals a result the viewer couldn't already see — every
//      entry is filtered through canViewTrial, so a private/group result stays
//      hidden exactly as it is on the trial's own leaderboard.
//
// Profiles are keyed by userId (/profile/{userId}); a user may also claim a vanity
// handle (/profile/baldur) resolved via a usernames/{slug}.json -> userId index.

import { getJson, putJson, deleteObject, listKeys } from './storage'
import { canViewTrial } from './permissions'
import type { AuthUser, TrialMetadata, CourseMetadata, BoatClass } from './types'

export type ProfileSettings = {
  public: boolean
  handle?: string // claimed vanity handle (phase 2); absent if unclaimed
}

function settingsKey(userId: string): string {
  return `users/${userId}/profile.json`
}

function handleKey(slug: string): string {
  return `usernames/${slug}.json`
}

// Profiles default to private — a user must explicitly opt in.
export async function getProfileSettings(userId: string): Promise<ProfileSettings> {
  const rec = await getJson<ProfileSettings>(settingsKey(userId))
  return { public: rec?.public ?? false, handle: rec?.handle }
}

// Read-modify-write so a visibility flip never clobbers the claimed handle.
export async function setProfilePublic(userId: string, isPublic: boolean): Promise<ProfileSettings> {
  const cur = await getProfileSettings(userId)
  const next: ProfileSettings = { ...cur, public: isPublic }
  await putJson(settingsKey(userId), next)
  return next
}

// --- Vanity handles (phase 2) ---------------------------------------------

// Handles can't shadow sibling routes or look like system paths. Lowercase.
export const RESERVED_HANDLES = new Set([
  'account', 'admin', 'api', 'auth', 'new', 'me', 'u', 'groups', 'group',
  'trials', 'trial', 'courses', 'course', 'login', 'logout', 'signin',
  'signup', 'settings', 'help', 'about', 'privacy', 'terms', 'tos',
  'leaderboard', 'upload', 'paddlesnitch', 'support', 'root', 'null',
  'undefined', 'www',
])

// Normalise + validate a raw handle. Returns the canonical slug, or an error
// reason. Rules: lowercased; 3-30 chars; [a-z0-9-]; no leading/trailing hyphen;
// not reserved.
export function normaliseHandle(raw: unknown): { slug: string } | { error: string } {
  if (typeof raw !== 'string') return { error: 'Handle is required.' }
  const slug = raw.trim().toLowerCase()
  if (slug.length < 3 || slug.length > 30) return { error: 'Handle must be 3–30 characters.' }
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/.test(slug)) {
    return { error: 'Use lowercase letters, numbers and hyphens only (no leading/trailing hyphen).' }
  }
  if (RESERVED_HANDLES.has(slug)) return { error: 'That handle is reserved.' }
  return { slug }
}

// Who owns this handle, if anyone.
export async function getHandleOwner(slug: string): Promise<string | null> {
  const rec = await getJson<{ userId: string }>(handleKey(slug))
  return rec?.userId ?? null
}

// Resolve a route segment to a userId: a known handle wins, otherwise the
// segment is treated as a userId directly (so old /profile/{userId} links work).
export async function resolveToUserId(segment: string): Promise<string> {
  return (await getHandleOwner(segment.toLowerCase())) ?? segment
}

// Claim (or change to) a handle for a user. Validates, enforces uniqueness,
// releases the user's previous handle, and updates both the index and the
// profile settings. Re-claiming your own current handle is a no-op success.
export async function claimHandle(userId: string, raw: unknown): Promise<ProfileSettings | { error: string }> {
  const norm = normaliseHandle(raw)
  if ('error' in norm) return norm
  const { slug } = norm

  const existingOwner = await getHandleOwner(slug)
  if (existingOwner && existingOwner !== userId) {
    return { error: 'That handle is already taken.' }
  }

  const cur = await getProfileSettings(userId)
  if (cur.handle === slug) return cur // no-op

  // Release the old handle index if the user is changing handles.
  if (cur.handle) await deleteObject(handleKey(cur.handle))

  await putJson(handleKey(slug), { userId })
  const next: ProfileSettings = { ...cur, handle: slug }
  await putJson(settingsKey(userId), next)
  return next
}

// Drop the user's handle (frees it for others). Safe if they have none.
export async function releaseHandle(userId: string): Promise<ProfileSettings> {
  const cur = await getProfileSettings(userId)
  if (cur.handle) await deleteObject(handleKey(cur.handle))
  const next: ProfileSettings = { public: cur.public }
  await putJson(settingsKey(userId), next)
  return next
}

// For a set of userIds, return the canonical profile path segment (handle when
// claimed, else userId) ONLY for users whose profile is public. Used to link
// names on a leaderboard without creating dead links to private profiles —
// absence from the map means "render as plain text". Deduped; one read per id.
export async function getPublicProfileLinks(userIds: string[]): Promise<Map<string, string>> {
  const links = new Map<string, string>()
  await Promise.all([...new Set(userIds)].map(async id => {
    const s = await getProfileSettings(id)
    if (s.public) links.set(id, s.handle ?? id)
  }))
  return links
}

export type ProfileRace = {
  entryId: string          // links to the per-entry permalink /att/entries/{id} (#105)
  trialId: string
  trialName: string
  courseId: string
  courseName: string
  distanceMetres: number
  raceDate: string
  totalElapsedSeconds: number
  boatClass: BoatClass
}

export type ProfileStats = {
  // Display name, taken from the user's most recent visible entry (entries
  // denormalise it). Null when the viewer can see no races.
  displayName: string | null
  totals: {
    races: number
    distanceMetres: number
    courses: number
    since: string | null // earliest raceDate of a visible race
  }
  // The single fastest race by speed (distance / time). Pace, km/h and m/s are
  // all monotonic in that ratio, so one race is "best" for all three.
  bestRace: ProfileRace | null
  personalBests: Array<{
    courseId: string
    courseName: string
    distanceMetres: number
    bestSeconds: number
    raceCount: number
  }>
  races: ProfileRace[] // full history, newest first
  boatClasses: Array<{ boatClass: BoatClass; count: number }>
}

type StoredEntry = {
  entryId: string
  userId: string
  displayName: string
  submittedAt: string
  raceDate: string
  boatClass: BoatClass
  result: { totalElapsedSeconds: number }
}

// Aggregate the profile for `userId` as seen by `viewer`. Only entries on trials
// the viewer can see are counted. Caller resolves viewerGroupIds once at the
// request boundary (as elsewhere in the codebase).
export async function buildProfileStats(
  userId: string,
  viewer: AuthUser | null,
  viewerGroupIds: Set<string>,
): Promise<ProfileStats> {
  // The entry path embeds the userId, so we target the listing directly.
  const entryKeys = (await listKeys('trials/'))
    .filter(k => k.endsWith('result.json') && k.includes(`/entries/${userId}/`))

  const trialCache = new Map<string, TrialMetadata | null>()
  const courseCache = new Map<string, CourseMetadata | null>()
  const getTrial = async (id: string) => {
    if (!trialCache.has(id)) trialCache.set(id, await getJson<TrialMetadata>(`trials/${id}/metadata.json`))
    return trialCache.get(id)!
  }
  const getCourse = async (id: string) => {
    if (!courseCache.has(id)) courseCache.set(id, await getJson<CourseMetadata>(`courses/${id}/metadata.json`))
    return courseCache.get(id)!
  }

  const races: ProfileRace[] = []
  let latestEntryAt = ''
  let displayName: string | null = null

  for (const key of entryKeys) {
    const entry = await getJson<StoredEntry>(key)
    if (!entry) continue
    // trialId is the path segment after "trials/".
    const trialId = key.split('/')[1]
    const trial = await getTrial(trialId)
    if (!trial) continue
    // The whole point of the privacy guarantee: skip trials the viewer can't see.
    if (!canViewTrial(trial, viewer, viewerGroupIds)) continue
    const course = await getCourse(trial.courseId)
    if (!course) continue

    // Display name from the most recently submitted visible entry.
    if (entry.submittedAt > latestEntryAt) {
      latestEntryAt = entry.submittedAt
      displayName = entry.displayName
    }

    races.push({
      entryId: entry.entryId,
      trialId,
      trialName: trial.name,
      courseId: course.id,
      courseName: course.name,
      distanceMetres: course.distanceMetres,
      raceDate: entry.raceDate,
      totalElapsedSeconds: entry.result.totalElapsedSeconds,
      boatClass: entry.boatClass,
    })
  }

  races.sort((a, b) => b.raceDate.localeCompare(a.raceDate))

  // Personal best per course (lowest time), with a race count.
  const pbByCourse = new Map<string, { courseName: string; distanceMetres: number; bestSeconds: number; raceCount: number }>()
  for (const r of races) {
    const cur = pbByCourse.get(r.courseId)
    if (!cur) {
      pbByCourse.set(r.courseId, { courseName: r.courseName, distanceMetres: r.distanceMetres, bestSeconds: r.totalElapsedSeconds, raceCount: 1 })
    } else {
      cur.raceCount++
      if (r.totalElapsedSeconds < cur.bestSeconds) cur.bestSeconds = r.totalElapsedSeconds
    }
  }
  const personalBests = [...pbByCourse.entries()]
    .map(([courseId, v]) => ({ courseId, ...v }))
    .sort((a, b) => a.courseName.localeCompare(b.courseName))

  // Best race by speed (distance / time); guards against zero distance/time.
  let bestRace: ProfileRace | null = null
  let bestSpeed = -1
  for (const r of races) {
    if (r.distanceMetres <= 0 || r.totalElapsedSeconds <= 0) continue
    const speed = r.distanceMetres / r.totalElapsedSeconds
    if (speed > bestSpeed) { bestSpeed = speed; bestRace = r }
  }

  const boatCounts = new Map<BoatClass, number>()
  for (const r of races) boatCounts.set(r.boatClass, (boatCounts.get(r.boatClass) ?? 0) + 1)
  const boatClasses = [...boatCounts.entries()]
    .map(([boatClass, count]) => ({ boatClass, count }))
    .sort((a, b) => b.count - a.count)

  const since = races.length ? races.reduce((min, r) => (r.raceDate < min ? r.raceDate : min), races[0].raceDate) : null

  return {
    displayName,
    totals: {
      races: races.length,
      distanceMetres: personalBests.reduce((sum, pb) => sum + pb.distanceMetres * pb.raceCount, 0),
      courses: pbByCourse.size,
      since,
    },
    bestRace,
    personalBests,
    races,
    boatClasses,
  }
}
