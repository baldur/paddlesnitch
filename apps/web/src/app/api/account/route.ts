import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getRequestUser, clearAuthCookies } from '@/lib/auth'
import { hasRecentSignIn } from '@/lib/app-signin'
import { getJson, listKeys, deleteObject, deleteObjects, deletePrefix } from '@/lib/storage'
import { unindexEntries } from '@/lib/entries'
import { deleteUserBySub, disconnectGoogle, findUserBySub, revoke } from '@/lib/cognito'
import { rebuildLeaderboard } from '@/lib/leaderboard'
import { removeUserFromAllGroups } from '@/lib/groups'
import { eraseFeedbackContactsForUser } from '@/lib/feedback-contacts'
import { eraseBetaApplication } from '@/lib/beta-signups'
import { linkNoteKey } from '@/lib/google-link'
import { eraseUserAnalysis } from '@paddlesnitch/analysis/analysis-store'
import { eraseUserDevices } from '@paddlesnitch/core/devices'
import { markAccountErasing, markAccountErased } from '@paddlesnitch/core/erased'
import { eraseDerived } from '@paddlesnitch/core/derived'
import { listTrials, listCourses } from '@/lib/catalogue'
import { eraseBuddies } from '@paddlesnitch/core/buddies'
import { erasePlanDemand, erasePlanShares } from '@paddlesnitch/waterways/plan-store'
import { erasePortages } from '@paddlesnitch/waterways/portage-store'
import { eraseGameTimes } from '@paddlesnitch/core/games'

const REAUTH_TEXT = 'For your safety, deleting your account needs a recent sign-in. Please sign in again.'

// GET /api/account — whether deleting can go ahead now ({ recentSignIn }), so
// the account page and the apps ask for a fresh sign-in BEFORE someone types
// DELETE rather than after.
export async function GET(req: Request) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ recentSignIn: await hasRecentSignIn(req, user.id) })
}

// DELETE: GDPR Art. 17 (right to erasure). Permanently removes:
//   - the Cognito user record (no more sign-ins)
//   - every course and trial they created that no group owns and nobody else
//     has results in. Anything with other people's results, or owned by a
//     group, stays (audit decision 2026-09: deleting an account must not
//     delete other people's records); only this user's entries leave it
//   - every entry they ever submitted, in any trial, owned or not
//   - every failed-upload diagnostic (GPS track) they left, in any trial
//   - every paddle, the coach profile, and the share link of any shared paddle
//   - every river plan and the link of any shared plan
//   - every tracker they own (signed out) and every recording they uploaded
//   - a Strava athlete -> account index left from before Strava was removed
//   - their place in groups; a group they own passes to an admin or member
//   - the private contact records behind issue reports they filed
//   - a beta tester application made with their account email
//   - everything under users/{userId}/
// After pulling their entries out of trials they don't own, the affected
// leaderboards get rebuilt so the public view stays consistent.
//
// Deleting needs a real sign-in from the last 10 minutes (owner, 2026-10-25):
// a stolen or left-open session must not be able to erase everything. Not a
// password prompt, because accounts made with Google (or, before 2026-11,
// Strava) have none.
export async function DELETE(req: Request) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await hasRecentSignIn(req, user.id))) {
    return NextResponse.json({ error: REAUTH_TEXT, reauth: true }, { status: 403 })
  }

  // 0. First, so a phone still holding this account's token waits while the rest
  //    is deleted (C3: phones upload by themselves). Marked done only once the
  //    sign-in account is gone, so a delete that fails leaves the phone's files.
  await markAccountErasing(user.id)

  // 1. Courses they created (deleted after step 5 if nothing still uses them).
  const createdCourses = (await listCourses()).filter(c => c.adminUserId === user.id && !c.groupId)

  // 2. Trials they created that can go whole: no group owns them, and no one
  //    else has an entry in them. Everything else just loses this user's
  //    entries in step 4.
  const trials = await listTrials()
  const ownedTrialIds = new Set<string>()
  await Promise.all(trials.map(async t => {
    if (t.adminUserId !== user.id || t.groupId) return
    const entrants = new Set((await listKeys(`trials/${t.id}/entries/`)).map(k => k.split('/')[3]))
    entrants.delete(user.id)
    if (entrants.size === 0) ownedTrialIds.add(t.id)
  }))

  // 3. Find every other trial that holds this user's entries — we will remove
  //    those entries and rebuild the leaderboard.
  const trialsWithUserEntries = new Set<string>()
  const allTrialIds = trials.map(t => t.id)

  // 4. Delete every key whose path indicates ownership by this user.
  //    Iterating per trial keeps the listing scoped and cheap. All trials are
  //    listed at once and the keys deleted in batches: one call at a time, a
  //    well-used account ran past the server's 30 s limit and stopped halfway
  //    (tests/erasure-big-account.test.ts).
  const trialKeysToDelete: string[] = []
  await Promise.all(allTrialIds.map(async trialId => {
    if (ownedTrialIds.has(trialId)) {
      // Whole trial goes — metadata, leaderboard, all entries by anyone.
      trialKeysToDelete.push(...await listKeys(`trials/${trialId}/`))
      return
    }
    // Not owned by this user — surgically remove only their own data: their
    // entries AND any failed-upload diagnostics they left here. Only entries
    // affect the leaderboard, so only those trigger a rebuild.
    const [userEntryKeys, userFailedKeys] = await Promise.all([
      listKeys(`trials/${trialId}/entries/${user.id}/`),
      listKeys(`trials/${trialId}/failed-uploads/${user.id}/`),
    ])
    trialKeysToDelete.push(...userEntryKeys, ...userFailedKeys)
    if (userEntryKeys.length > 0) trialsWithUserEntries.add(trialId)
  }))
  await deleteObjects(trialKeysToDelete)
  await unindexEntries(trialKeysToDelete)

  // 5. Rebuild leaderboards for trials we trimmed (not the ones we wiped).
  await Promise.all([...trialsWithUserEntries].map(trialId => rebuildLeaderboard(trialId)))

  // 6. Delete the courses they created that no group owns and no remaining
  //    trial runs on (a kept trial keeps its course).
  const keptTrialCourses = new Set(
    trials.filter(t => !ownedTrialIds.has(t.id)).map(t => t.courseId),
  )
  await deleteObjects(createdCourses.filter(c => !keptTrialCourses.has(c.id)).map(c => `courses/${c.id}/metadata.json`))

  // 6a. Paddles, trackers, groups, the old Strava index. These live outside
  //     users/{userId}/, so the prefix wipe below never reached them (GDPR gap
  //     until 2026-09). The Strava index goes before the users/ wipe because
  //     the athlete id is read from there.
  await eraseUserAnalysis(user.id)
  await eraseUserDevices(user.id)
  // Everything worked out from their data (docs/features/performance.md).
  await eraseDerived(user.id)
  // Prepared "Download my data" files (a lifecycle rule also drops them daily).
  await deletePrefix(`exports/${user.id}/`)
  // Both sides of every buddy friendship, requests to and from them, their invite link.
  await eraseBuddies(user.id)
  // Shared plan links (the plans themselves live under users/{id}/plans/).
  await erasePlanShares(user.id)
  // Which locks their plans pass (kept for ranking the gaps; plans/demand/).
  await erasePlanDemand(user.id)
  // Portage details they added (public copies and flags; their own copies live under users/{id}/portages/).
  await erasePortages(user.id)
  await removeUserFromAllGroups(user.id)
  await eraseFeedbackContactsForUser(user.id)
  // Keyed by email: only an address the account has proved is theirs (#713).
  if (user.emailVerified) await eraseBetaApplication(user.email)
  // A Connect Google note left in the last 10 minutes (lib/google-link.ts).
  await deleteObject(linkNoteKey(user.email))
  // Strava was removed (2026-11). Until the one-off clean-up
  // (scripts/strava-shutdown.ts) has run, an account may still have the
  // strava-athletes/{athleteId}.json index pointing at it: the athlete id is in
  // the old users/{id}/strava.json, or in the placeholder email of an account
  // made with Strava. The users/ wipe below takes the old files themselves.
  const legacy = await getJson<{ athleteId?: number }>(`users/${user.id}/strava.json`)
  const athleteIds = new Set<number>()
  if (legacy?.athleteId) athleteIds.add(legacy.athleteId)
  const placeholder = /^strava-(\d+)@noreply\.paddlesnitch\.com$/i.exec(user.email)
  if (placeholder) athleteIds.add(Number(placeholder[1]))
  for (const id of athleteIds) {
    const key = `strava-athletes/${id}.json`
    if ((await getJson<{ userId?: string }>(key))?.userId === user.id) await deleteObject(key)
  }

  // 6b. Release a claimed vanity handle (the usernames/{slug} index lives
  //     outside users/, so it needs an explicit delete), then wipe the whole
  //     users/{userId}/ prefix — profile, contact, groups index, old Strava files,
  //     tos-consent. Previously these survived erasure (GDPR gap).
  const profile = await getJson<{ handle?: string }>(`users/${user.id}/profile.json`)
  if (profile?.handle) await deleteObject(`usernames/${profile.handle}.json`)
  await deletePrefix(`users/${user.id}/`)

  // 7. Revoke any active refresh token then delete the Cognito user.
  //    Order matters: if Cognito delete fails we want their session still revoked.
  //    An app has no cookie: it may send its refresh token as { refreshToken }.
  const cookieStore = await cookies()
  const body = await req.json().catch(() => ({})) as { refreshToken?: unknown }
  const refreshToken = cookieStore.get('tt_refresh')?.value
    ?? (typeof body.refreshToken === 'string' ? body.refreshToken : undefined)
  if (refreshToken) await revoke(refreshToken)
  // A Google login connected on Account stops opening anything first.
  const linked = (await findUserBySub(user.id))?.googleId
  if (linked) await disconnectGoogle(linked)
  // By sub: a Google account's username isn't its email.
  await deleteUserBySub(user.id)
  await markAccountErased(user.id)
  // Their times on the game's public leaderboards (games/kayak/leaderboard/;
  // live races expire within a day). After the sign-in is gone, so a game tab
  // still open can't post a time back in between (#742).
  await eraseGameTimes(user.id)

  // 8. Clear cookies on the response so the browser stops sending stale ones.
  const res = NextResponse.json({ ok: true }, { status: 200 })
  clearAuthCookies(res.cookies)
  return res
}
