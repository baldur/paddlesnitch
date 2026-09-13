import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getAuthUser, clearAuthCookies } from '@/lib/auth'
import { getJson, listKeys, deleteObject } from '@/lib/storage'
import { deleteUser, revoke } from '@/lib/cognito'
import { rebuildLeaderboard } from '@/lib/leaderboard'
import type { CourseMetadata, TrialMetadata } from '@/lib/types'

// GDPR Art. 17 (right to erasure). Permanently removes:
//   - the Cognito user record (no more sign-ins)
//   - every course they own and every trial that runs on those courses
//   - every entry they ever submitted, in any trial, owned or not
//   - every failed-upload diagnostic (GPS track) they left, in any trial
// After pulling their entries out of trials they don't own, the affected
// leaderboards get rebuilt so the public view stays consistent.
export async function DELETE() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 1. Find owned courses (we will delete them after step 3).
  const courseKeys = (await listKeys('courses/')).filter(k => k.endsWith('metadata.json'))
  const courses = await Promise.all(courseKeys.map(k => getJson<CourseMetadata>(k)))
  const ownedCourseIds = courses
    .filter((c): c is CourseMetadata => c !== null && c.adminUserId === user.id)
    .map(c => c.id)

  // 2. Find owned trials (we will delete them whole, including foreign entries).
  const trialKeys = (await listKeys('trials/')).filter(
    k => k.endsWith('metadata.json') && !k.includes('/entries/')
  )
  const trials = await Promise.all(trialKeys.map(k => getJson<TrialMetadata>(k)))
  const ownedTrialIds = new Set(
    trials
      .filter((t): t is TrialMetadata => t !== null && t.adminUserId === user.id)
      .map(t => t.id)
  )

  // 3. Find every other trial that holds this user's entries — we will remove
  //    those entries and rebuild the leaderboard.
  const trialsWithUserEntries = new Set<string>()
  const allTrialIds = trials
    .filter((t): t is TrialMetadata => t !== null)
    .map(t => t.id)

  // 4. Delete every key whose path indicates ownership by this user.
  //    Iterating per trial keeps the listing scoped and cheap.
  for (const trialId of allTrialIds) {
    if (ownedTrialIds.has(trialId)) {
      // Whole trial goes — metadata, leaderboard, all entries by anyone.
      const allTrialKeys = await listKeys(`trials/${trialId}/`)
      for (const k of allTrialKeys) await deleteObject(k)
      continue
    }
    // Not owned by this user — surgically remove only their own data: their
    // entries AND any failed-upload diagnostics they left here. Only entries
    // affect the leaderboard, so only those trigger a rebuild.
    const userEntryKeys = await listKeys(`trials/${trialId}/entries/${user.id}/`)
    const userFailedKeys = await listKeys(`trials/${trialId}/failed-uploads/${user.id}/`)
    if (userEntryKeys.length === 0 && userFailedKeys.length === 0) continue
    for (const k of userEntryKeys) await deleteObject(k)
    for (const k of userFailedKeys) await deleteObject(k)
    if (userEntryKeys.length > 0) trialsWithUserEntries.add(trialId)
  }

  // 5. Rebuild leaderboards for trials we trimmed (not the ones we wiped).
  for (const trialId of trialsWithUserEntries) {
    await rebuildLeaderboard(trialId)
  }

  // 6. Delete owned course metadata.
  for (const courseId of ownedCourseIds) {
    await deleteObject(`courses/${courseId}/metadata.json`)
  }

  // 6b. Release a claimed vanity handle (the usernames/{slug} index lives
  //     outside users/, so it needs an explicit delete), then wipe the whole
  //     users/{userId}/ prefix — profile, contact, groups index, strava tokens,
  //     tos-consent. Previously these survived erasure (GDPR gap).
  const profile = await getJson<{ handle?: string }>(`users/${user.id}/profile.json`)
  if (profile?.handle) await deleteObject(`usernames/${profile.handle}.json`)
  for (const k of await listKeys(`users/${user.id}/`)) await deleteObject(k)

  // 7. Revoke any active refresh token then delete the Cognito user.
  //    Order matters: if Cognito delete fails we want their session still revoked.
  const cookieStore = await cookies()
  const refreshToken = cookieStore.get('tt_refresh')?.value
  if (refreshToken) await revoke(refreshToken)
  await deleteUser(user.email)

  // 8. Clear cookies on the response so the browser stops sending stale ones.
  const res = NextResponse.json({ ok: true }, { status: 200 })
  clearAuthCookies(res.cookies)
  return res
}
