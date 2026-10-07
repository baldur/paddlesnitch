import type { LeaderboardEntry, BoatClass } from '@/lib/types'

export type CourseRecord = { boatClass: BoatClass; seconds: number; displayName: string; raceDate: string; entryId: string; trialId: string }

/**
 * The course record per boat class: the fastest result across the course's
 * trials (only the trials the caller passes, i.e. ones the viewer may see).
 * Classes in the order the fastest records come; ties go to whoever set it
 * first.
 */
export function courseRecords(boards: { trialId: string; entries: LeaderboardEntry[] }[]): CourseRecord[] {
  const best = new Map<BoatClass, CourseRecord>()
  for (const { trialId, entries } of boards) {
    for (const e of entries) {
      if (!(e.totalElapsedSeconds > 0)) continue
      const cur = best.get(e.boatClass)
      const earlier = cur && e.totalElapsedSeconds === cur.seconds && e.raceDate < cur.raceDate
      if (!cur || e.totalElapsedSeconds < cur.seconds || earlier) {
        best.set(e.boatClass, { boatClass: e.boatClass, seconds: e.totalElapsedSeconds, displayName: e.displayName, raceDate: e.raceDate, entryId: e.entryId, trialId })
      }
    }
  }
  return [...best.values()].sort((a, b) => a.seconds - b.seconds)
}

/**
 * Marks for a trial's leaderboard rows, from every result on the same course
 * the viewer may see (this trial included): 'COURSE RECORD' for the fastest in
 * its boat class, 'PB' for a paddler's fastest on this course in that class,
 * once they have more than one result there to beat.
 */
export function resultMarks(courseBoards: { trialId: string; entries: LeaderboardEntry[] }[]): Record<string, 'COURSE RECORD' | 'PB'> {
  const marks: Record<string, 'COURSE RECORD' | 'PB'> = {}
  for (const r of courseRecords(courseBoards)) marks[r.entryId] = 'COURSE RECORD'
  const mine = new Map<string, LeaderboardEntry[]>()
  for (const { entries } of courseBoards) for (const e of entries) {
    if (!(e.totalElapsedSeconds > 0)) continue
    const k = `${e.userId}|${e.boatClass}`
    mine.set(k, [...(mine.get(k) ?? []), e])
  }
  for (const list of mine.values()) {
    if (list.length < 2) continue
    const best = list.reduce((b, e) => (e.totalElapsedSeconds < b.totalElapsedSeconds ? e : b))
    if (!marks[best.entryId]) marks[best.entryId] = 'PB'
  }
  return marks
}
