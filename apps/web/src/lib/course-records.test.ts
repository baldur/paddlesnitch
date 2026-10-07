import { describe, it, expect } from 'vitest'
import { courseRecords, resultMarks } from './course-records'
import type { LeaderboardEntry } from './types'

const e = (entryId: string, boatClass: string, seconds: number, raceDate = '2026-05-01', name = entryId) =>
  ({ entryId, userId: 'u', displayName: name, submittedAt: '', raceDate, boatClass, crew: [], totalElapsedSeconds: seconds, splits: [] }) as unknown as LeaderboardEntry

describe('course records', () => {
  it('keeps the fastest result per boat class across trials', () => {
    const r = courseRecords([
      { trialId: 't1', entries: [e('a', 'K1', 290), e('b', 'K2', 270), e('c', 'K1', 300)] },
      { trialId: 't2', entries: [e('d', 'K1', 284.9), e('f', '1X', 310)] },
    ])
    expect(r.map(x => [x.boatClass, x.entryId, x.trialId])).toEqual([['K2', 'b', 't1'], ['K1', 'd', 't2'], ['1X', 'f', 't2']])
  })
  it('gives a tie to whoever set it first', () => {
    const r = courseRecords([{ trialId: 't', entries: [e('late', 'K1', 280, '2026-06-01'), e('early', 'K1', 280, '2026-04-01')] }])
    expect(r[0].entryId).toBe('early')
  })
  it('ignores a result with no time', () => {
    expect(courseRecords([{ trialId: 't', entries: [e('x', 'K1', 0)] }])).toEqual([])
  })
})

describe('leaderboard marks', () => {
  const u = (entryId: string, userId: string, seconds: number, boatClass = 'K1') =>
    ({ entryId, userId, displayName: userId, submittedAt: '', raceDate: '2026-05-01', boatClass, crew: [], totalElapsedSeconds: seconds, splits: [] }) as unknown as LeaderboardEntry

  it('marks the course record, and a PB only once there is a result to beat', () => {
    const marks = resultMarks([
      { trialId: 't1', entries: [u('a1', 'anna', 280), u('b1', 'ben', 300)] },
      { trialId: 't2', entries: [u('a2', 'anna', 290), u('b2', 'ben', 295), u('c1', 'cara', 310)] },
    ])
    expect(marks).toEqual({ a1: 'COURSE RECORD', b2: 'PB' })   // cara has one result: nothing to beat
  })
})
