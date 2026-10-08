// Recent submissions feed for the home page. Same privacy rule as everywhere
// else: a submission is only included if the viewer can see its trial
// (canViewTrial), so private/group results never surface to people who couldn't
// already see them on the trial's leaderboard.
//
// Reads each visible trial's leaderboard.json (every entry, rebuilt on each
// upload), all at once. It used to read every entry's result.json one after
// another, track and all: about 2 s for the Trials home page, and growing with
// every entry.

import { getJson } from './storage'
import { canViewTrial } from './permissions'
import type { AuthUser, CourseMetadata, BoatClass, LeaderboardEntry } from './types'
import { listTrials } from '@/lib/catalogue'

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

export async function getRecentSubmissions(
  viewer: AuthUser | null,
  viewerGroupIds: Set<string>,
  limit = 8,
): Promise<RecentSubmission[]> {
  const trials = (await listTrials()).filter(t => canViewTrial(t, viewer, viewerGroupIds))

  const courses = new Map<string, Promise<CourseMetadata | null>>()
  const course = (id: string) => {
    if (!courses.has(id)) courses.set(id, getJson<CourseMetadata>(`courses/${id}/metadata.json`))
    return courses.get(id)!
  }

  const perTrial = await Promise.all(trials.map(async trial => {
    const [board, c] = await Promise.all([
      getJson<LeaderboardEntry[]>(`trials/${trial.id}/leaderboard.json`),
      course(trial.courseId),
    ])
    if (!c) return []
    return (board ?? []).map((e): RecentSubmission => ({
      entryId: e.entryId,
      userId: e.userId,
      displayName: e.displayName,
      trialId: trial.id,
      trialName: trial.name,
      courseName: c.name,
      totalElapsedSeconds: e.totalElapsedSeconds,
      raceDate: e.raceDate,
      submittedAt: e.submittedAt,
      boatClass: e.boatClass,
    }))
  }))

  return perTrial.flat()
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .slice(0, limit)
}
