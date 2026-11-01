// Account erasure (GDPR Art. 17): everything keyed by the account ID. Run by
// DELETE /api/account, and again ~2.5 min later by the `erase-account-again` job
// (#814) to catch a write the old token made after its area was erased: while
// the erasure marker is 'pending', or up to a minute after 'done' on a server
// that cached the account as live (@paddlesnitch/core/erased CACHE_MS).
//
// Safe to run twice: every step deletes what it finds, and nothing is deleted
// by a key someone else may hold since (a handle or a Strava athlete is
// released only while its index still names this account). The sign-in
// account itself, the erasure marker and the email-keyed records are the
// route's job, not this.
//
// Must stay flat in time: gather keys in parallel and delete with
// deleteObjects/deletePrefix, never one call at a time (erasure-big-account.test.ts).
import { getJson, listKeys, deleteObject, deleteObjects, deletePrefix } from '@/lib/storage'
import { unindexEntries } from '@/lib/entries'
import { rebuildLeaderboard } from '@/lib/leaderboard'
import { removeUserFromAllGroups } from '@/lib/groups'
import { eraseFeedbackContactsForUser } from '@/lib/feedback-contacts'
import { revoke as revokeStrava } from '@paddlesnitch/core/strava'
import { getStravaTokens, getUserIdByAthleteId, deleteAthleteIndex } from '@paddlesnitch/core/strava-storage'
import { eraseUserAnalysis } from '@paddlesnitch/analysis/analysis-store'
import { eraseUserDevices } from '@paddlesnitch/core/devices'
import { eraseDerived } from '@paddlesnitch/core/derived'
import { listTrials, listCourses } from '@/lib/catalogue'
import { eraseBuddies } from '@paddlesnitch/core/buddies'
import { erasePlanDemand, erasePlanShares } from '@paddlesnitch/waterways/plan-store'
import { erasePortages } from '@paddlesnitch/waterways/portage-store'
import { eraseGameTimes } from '@paddlesnitch/core/games'
import { erasureState, CACHE_MS } from '@paddlesnitch/core/erased'

/**
 * Deletes everything stored under or about this account ID. `athleteIds`:
 * Strava athletes known only from outside the data (a Strava sign-in's email),
 * released if their index still names this account.
 */
export async function eraseAccountData(userId: string, { athleteIds = [] }: { athleteIds?: number[] } = {}): Promise<void> {
  // 1. Courses they created (deleted after step 5 if nothing still uses them).
  const createdCourses = (await listCourses()).filter(c => c.adminUserId === userId && !c.groupId)

  // 2. Trials they created that can go whole: no group owns them, and no one
  //    else has an entry in them. Everything else just loses this user's
  //    entries in step 4.
  const trials = await listTrials()
  const ownedTrialIds = new Set<string>()
  await Promise.all(trials.map(async t => {
    if (t.adminUserId !== userId || t.groupId) return
    const entrants = new Set((await listKeys(`trials/${t.id}/entries/`)).map(k => k.split('/')[3]))
    entrants.delete(userId)
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
      listKeys(`trials/${trialId}/entries/${userId}/`),
      listKeys(`trials/${trialId}/failed-uploads/${userId}/`),
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

  // 6a. Paddles, trackers, groups, Strava. These live outside users/{userId}/,
  //     so the prefix wipe below never reached them (GDPR gap until 2026-09).
  //     Strava goes before the users/ wipe because the tokens live there.
  await eraseUserAnalysis(userId)
  await eraseUserDevices(userId)
  // Everything worked out from their data (docs/features/performance.md).
  await eraseDerived(userId)
  // Prepared "Download my data" files (a lifecycle rule also drops them daily).
  await deletePrefix(`exports/${userId}/`)
  // Both sides of every buddy friendship, requests to and from them, their invite link.
  await eraseBuddies(userId)
  // Shared plan links (the plans themselves live under users/{id}/plans/).
  await erasePlanShares(userId)
  // Which locks their plans pass (kept for ranking the gaps; plans/demand/).
  await erasePlanDemand(userId)
  // Portage details they added (public copies and flags; their own copies live under users/{id}/portages/).
  await erasePortages(userId)
  await removeUserFromAllGroups(userId)
  await eraseFeedbackContactsForUser(userId)
  const strava = await getStravaTokens(userId)
  if (strava) await revokeStrava(strava.accessToken)
  const athletes = new Set<number>(athleteIds)
  if (strava?.athleteId) athletes.add(strava.athleteId)
  for (const id of athletes) {
    if ((await getUserIdByAthleteId(id)) === userId) await deleteAthleteIndex(id)
  }

  // 6b. Release a claimed vanity handle (the usernames/{slug} index lives
  //     outside users/, so it needs an explicit delete) while it still names
  //     this account, then wipe the whole users/{userId}/ prefix — profile,
  //     contact, groups index, strava tokens, tos-consent. Previously these
  //     survived erasure (GDPR gap).
  const profile = await getJson<{ handle?: string }>(`users/${userId}/profile.json`)
  if (profile?.handle) {
    const index = await getJson<{ userId?: string }>(`usernames/${profile.handle}.json`)
    if (index?.userId === userId) await deleteObject(`usernames/${profile.handle}.json`)
  }
  await deletePrefix(`users/${userId}/`)
}

/** A server request is cut off after this. */
const REQUEST_LIMIT_MS = 30_000
/**
 * How long after DELETE starts the second pass may run. The last write the old
 * token can make starts on a server that read 'none' just before the delete
 * began and kept it for CACHE_MS, and runs up to the request limit; then a
 * minute's margin.
 */
export const ERASE_AGAIN_AFTER_MS = CACHE_MS + REQUEST_LIMIT_MS + 60_000

/**
 * The `erase-account-again` job's payload: the account ID only. The email-keyed
 * records are not swept again: the beta form is open to anyone, and a Connect
 * Google note runs out in 10 minutes and a lifecycle rule removes it.
 */
export type EraseAgainPayload = { userId: string }

/**
 * The second pass (#814). Runs only once the delete finished ('done'): a
 * 'pending' marker by now is a delete that failed, and no marker is a live
 * account (or one deleted over two days ago), so it does nothing. Safe to run
 * twice.
 */
export async function eraseAccountAgain({ userId }: EraseAgainPayload): Promise<void> {
  if ((await erasureState(userId)) !== 'done') return
  await eraseAccountData(userId)
  await eraseGameTimes(userId)
}
