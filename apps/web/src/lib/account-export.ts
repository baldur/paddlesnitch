// Everything the system holds about one user, as the "Download my data" file
// (GDPR Art. 15 + 20). Shared by the direct download and the large-account
// path (app/api/account/export/route.ts).
import { getJson } from '@/lib/storage'
import { getUserGroupIds, getGroup, groupRoleOf } from '@/lib/groups'
import { getStravaTokens } from '@paddlesnitch/core/strava-storage'
import { listSessions, getAthleteProfile } from '@paddlesnitch/analysis/analysis-store'
import { exportUserDevices } from '@paddlesnitch/core/devices'
import { listFeedbackContactsForUser } from '@/lib/feedback-contacts'
import { getBetaApplication } from '@/lib/beta-signups'
import type { AuthUser } from '@paddlesnitch/core/types'
import { listTrials, listCourses, listUserEntryResultKeys, listUserFailedUploadKeys } from '@/lib/catalogue'

export async function buildAccountExport(user: AuthUser) {
  // Courses the user owns.
  const ownedCourses = (await listCourses()).filter(c => c.adminUserId === user.id)

  // Trials the user owns.
  const ownedTrials = (await listTrials()).filter(t => t.adminUserId === user.id)

  // Entries the user submitted (in any trial — owned or not). The entry path
  // includes the user's id, so we can target the listing directly.
  const entryKeys = await listUserEntryResultKeys(user.id)
  const submittedEntries = (await Promise.all(entryKeys.map(k => getJson(k))))
    .filter((e): e is Record<string, unknown> => e !== null)

  // Failed uploads the user submitted — GPS tracks of traces that didn't match
  // a course, retained for debugging. Same id-scoped path as entries.
  const failedKeys = await listUserFailedUploadKeys(user.id)
  const failedUploads = (await Promise.all(failedKeys.map(k => getJson(k))))
    .filter((e): e is Record<string, unknown> => e !== null)

  // Paddles (with diary notes) and the coach's running profile of them.
  const paddles = await listSessions(user.id)
  const coachProfile = await getAthleteProfile(user.id)

  // Account records under users/{id}/. Strava tokens are credentials, so only
  // the fact of the connection and the athlete id are exported.
  const strava = await getStravaTokens(user.id)
  const account = {
    profile: await getJson(`users/${user.id}/profile.json`),
    contact: await getJson(`users/${user.id}/contact.json`),
    termsAccepted: await getJson(`users/${user.id}/tos-consent.json`),
    strava: strava ? { connected: true, athleteId: strava.athleteId } : { connected: false },
    stravaAutoImport: await getJson(`users/${user.id}/strava-prefs.json`),
  }

  const groups = (await Promise.all((await getUserGroupIds(user.id)).map(id => getGroup(id))))
    .filter((g): g is NonNullable<typeof g> => g !== null)
    .map(g => ({ id: g.id, name: g.name, role: groupRoleOf(g, user.id) }))

  // Trackers and the recordings they uploaded (metadata; the raw CSV files are
  // too large for one download and are available on request).
  const { trackers, recordings: trackerRecordings } = await exportUserDevices(user.id)

  return {
    exportedAt: new Date().toISOString(),
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    },
    ownedCourses,
    ownedTrials,
    submittedEntries,
    failedUploads,
    paddles,
    coachProfile,
    account,
    groups,
    trackers,
    trackerRecordings,
    issueReports: await listFeedbackContactsForUser(user.id),
    betaApplication: await getBetaApplication(user.email),
    notes: [
      'This file contains all personal data paddlesnitch.com holds about you.',
      'Heart rate is never stored. Stroke rate is kept when your file has it.',
      'Raw tracker recordings are not included because of their size. Email privacy@paddlesnitch.com for a copy.',
      'Passwords are held by Amazon Cognito and are never exposed via this export.',
    ],
  }

}

export function exportFilename(user: AuthUser, now = new Date()) {
  return `paddlesnitch-data-${user.id}-${now.toISOString().slice(0, 10)}.json`
}
