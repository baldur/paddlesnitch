import { getJson, putJson, listKeys } from './storage'
import type { LeaderboardEntry, ProcessedResult, BoatClass, CrewMember, EntryConditions } from './types'

// Stored shape of an entry's result.json — see upload route.
type StoredEntry = {
  entryId: string
  userId: string
  displayName: string
  submittedAt: string
  filename: string
  raceDate: string
  boatClass: BoatClass
  crew: CrewMember[]
  result: ProcessedResult
  conditions?: EntryConditions
}

// Reads every entry under the trial and writes a fresh leaderboard.json.
// Used by the upload flow (after a new entry) and the account-delete flow
// (after pulling someone's entries out).
export async function rebuildLeaderboard(trialId: string): Promise<void> {
  const keys = await listKeys(`trials/${trialId}/entries/`)
  const resultKeys = keys.filter(k => k.endsWith('result.json'))
  const entries = (
    await Promise.all(resultKeys.map(k => getJson<StoredEntry>(k)))
  ).filter((e): e is StoredEntry => e !== null && e.result !== null)

  const leaderboard: LeaderboardEntry[] = entries
    .map(e => ({
      entryId: e.entryId,
      userId: e.userId,
      displayName: e.displayName,
      submittedAt: e.submittedAt,
      raceDate: e.raceDate,
      boatClass: e.boatClass,
      crew: e.crew,
      totalElapsedSeconds: e.result.totalElapsedSeconds,
      splits: e.result.splits,
      ...(e.result.runCount && e.result.runCount > 1 ? { runCount: e.result.runCount } : {}),
      ...(e.result.avgStrokeRate != null ? { avgStrokeRate: e.result.avgStrokeRate } : {}),
      ...(e.conditions ? { conditions: e.conditions } : {}),
    }))
    .sort((a, b) => a.totalElapsedSeconds - b.totalElapsedSeconds)

  await putJson(`trials/${trialId}/leaderboard.json`, leaderboard)
}
