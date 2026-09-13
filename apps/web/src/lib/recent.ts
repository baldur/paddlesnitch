// Recent submissions feed for the home page. Same privacy rule as everywhere
// else: a submission is only included if the viewer can see its trial
// (canViewTrial), so private/group results never surface to people who couldn't
// already see them on the trial's leaderboard.
//
// This scans every entry's result.json on each call. Fine at current scale
// (cost model: < 1000 entries/month); swap for an index if it ever gets hot.

import { getJson, listKeys } from './storage'
import { canViewTrial } from './permissions'
import type { AuthUser, TrialMetadata, CourseMetadata, BoatClass } from './types'

export type RecentSubmission = {
  entryId: string
  userId: string
  displayName: string
  trialId: string
  trialName: string
  courseName: string
  totalElapsedSeconds: number
  raceDate: string
  submittedAt: string
  boatClass: BoatClass
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

export async function getRecentSubmissions(
  viewer: AuthUser | null,
  viewerGroupIds: Set<string>,
  limit = 8,
): Promise<RecentSubmission[]> {
  const keys = (await listKeys('trials/'))
    .filter(k => k.endsWith('result.json') && k.includes('/entries/'))

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

  const out: RecentSubmission[] = []
  for (const key of keys) {
    const entry = await getJson<StoredEntry>(key)
    if (!entry) continue
    const trialId = key.split('/')[1] // trials/{trialId}/entries/...
    const trial = await getTrial(trialId)
    if (!trial) continue
    if (!canViewTrial(trial, viewer, viewerGroupIds)) continue
    const course = await getCourse(trial.courseId)
    if (!course) continue

    out.push({
      entryId: entry.entryId,
      userId: entry.userId,
      displayName: entry.displayName,
      trialId,
      trialName: trial.name,
      courseName: course.name,
      totalElapsedSeconds: entry.result.totalElapsedSeconds,
      raceDate: entry.raceDate,
      submittedAt: entry.submittedAt,
      boatClass: entry.boatClass,
    })
  }

  out.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
  return out.slice(0, limit)
}
