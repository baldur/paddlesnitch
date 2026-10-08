import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getAuthUser, clearAuthCookies } from '@/lib/auth'
import { getJson, listKeys, deleteObject } from '@/lib/storage'
import { deleteUser, revoke } from '@/lib/cognito'
import { rebuildLeaderboard } from '@/lib/leaderboard'
import { removeUserFromAllGroups } from '@/lib/groups'
import { eraseFeedbackContactsForUser } from '@/lib/feedback-contacts'
import { eraseBetaApplication } from '@/lib/beta-signups'
import { revoke as revokeStrava } from '@paddlesnitch/core/strava'
import { getStravaTokens, getUserIdByAthleteId, deleteAthleteIndex } from '@paddlesnitch/core/strava-storage'
import { eraseUserAnalysis } from '@paddlesnitch/analysis/analysis-store'
import { eraseUserDevices } from '@paddlesnitch/core/devices'
import { eraseDerived } from '@paddlesnitch/core/derived'
import type { CourseMetadata, TrialMetadata } from '@/lib/types'

// GDPR Art. 17 (right to erasure). Permanently removes:
//   - the Cognito user record (no more sign-ins)
//   - every course and trial they created that no group owns and nobody else
//     has results in. Anything with other people's results, or owned by a
//     group, stays (audit decision 2026-09: deleting an account must not
//     delete other people's records); only this user's entries leave it
//   - every entry they ever submitted, in any trial, owned or not
//   - every failed-upload diagnostic (GPS track) they left, in any trial
//   - every paddle, the coach profile, and the share link of any shared paddle
//   - every tracker they own (signed out) and every recording they uploaded
//   - their Strava link (deauthorised, and the athlete -> account index)
//   - their place in groups; a group they own passes to an admin or member
//   - the private contact records behind issue reports they filed
//   - a beta tester application made with their account email
//   - everything under users/{userId}/
// After pulling their entries out of trials they don't own, the affected
// leaderboards get rebuilt so the public view stays consistent.
export async function DELETE() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 1. Courses they created (deleted after step 5 if nothing still uses them).
  const courseKeys = (await listKeys('courses/')).filter(k => k.endsWith('metadata.json'))
  const courses = await Promise.all(courseKeys.map(k => getJson<CourseMetadata>(k)))
  const createdCourses = courses
    .filter((c): c is CourseMetadata => c !== null && c.adminUserId === user.id && !c.groupId)

  // 2. Trials they created that can go whole: no group owns them, and no one
  //    else has an entry in them. Everything else just loses this user's
  //    entries in step 4.
  const trialKeys = (await listKeys('trials/')).filter(
    k => k.endsWith('metadata.json') && !k.includes('/entries/')
  )
  const trials = await Promise.all(trialKeys.map(k => getJson<TrialMetadata>(k)))
  const ownedTrialIds = new Set<string>()
  for (const t of trials) {
    if (!t || t.adminUserId !== user.id || t.groupId) continue
    const entrants = new Set((await listKeys(`trials/${t.id}/entries/`)).map(k => k.split('/')[3]))
    entrants.delete(user.id)
    if (entrants.size === 0) ownedTrialIds.add(t.id)
  }

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

  // 6. Delete the courses they created that no group owns and no remaining
  //    trial runs on (a kept trial keeps its course).
  const keptTrialCourses = new Set(
    trials.filter((t): t is TrialMetadata => t !== null && !ownedTrialIds.has(t.id)).map(t => t.courseId),
  )
  for (const c of createdCourses) {
    if (!keptTrialCourses.has(c.id)) await deleteObject(`courses/${c.id}/metadata.json`)
  }

  // 6a. Paddles, trackers, groups, Strava. These live outside users/{userId}/,
  //     so the prefix wipe below never reached them (GDPR gap until 2026-09).
  //     Strava goes before the users/ wipe because the tokens live there.
  await eraseUserAnalysis(user.id)
  await eraseUserDevices(user.id)
  // Everything worked out from their data (docs/features/performance.md).
  await eraseDerived(user.id)
  // Prepared "Download my data" files (a lifecycle rule also drops them daily).
  for (const k of await listKeys(`exports/${user.id}/`)) await deleteObject(k)
  await removeUserFromAllGroups(user.id)
  await eraseFeedbackContactsForUser(user.id)
  await eraseBetaApplication(user.email)
  const strava = await getStravaTokens(user.id)
  if (strava) await revokeStrava(strava.accessToken)
  // A Strava sign-in account may have no tokens left, but its synthetic email
  // still names the athlete.
  const athleteIds = new Set<number>()
  if (strava?.athleteId) athleteIds.add(strava.athleteId)
  const synthetic = /^strava-(\d+)@noreply\.paddlesnitch\.com$/.exec(user.email)
  if (synthetic) athleteIds.add(Number(synthetic[1]))
  for (const id of athleteIds) {
    if ((await getUserIdByAthleteId(id)) === user.id) await deleteAthleteIndex(id)
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
