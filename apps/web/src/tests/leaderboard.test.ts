// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeDataDir, cleanDataDir } from './helpers'
import { putJson, getJson } from '@/lib/storage'
import { rebuildLeaderboard } from '@/lib/leaderboard'
import type { LeaderboardEntry, ProcessedResult } from '@/lib/types'

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir) })

function storedEntry(entryId: string, elapsed: number, runCount?: number, avgStrokeRate?: number) {
  const result: ProcessedResult = {
    startTimestamp: '2026-06-01T10:00:00.000Z',
    finishTimestamp: '2026-06-01T10:00:00.000Z',
    totalElapsedSeconds: elapsed,
    splits: [],
    ...(runCount !== undefined ? { runCount } : {}),
    ...(avgStrokeRate !== undefined ? { avgStrokeRate } : {}),
  }
  return {
    entryId,
    userId: `user-${entryId}`,
    displayName: `Athlete ${entryId}`,
    submittedAt: '2026-06-01T10:05:00.000Z',
    filename: 'trace.gpx',
    raceDate: '2026-06-01',
    boatClass: 'K1' as const,
    crew: [{ name: 'Solo', seat: 1 as const }],
    result,
  }
}

describe('rebuildLeaderboard — runCount (#77)', () => {
  it('carries runCount onto the leaderboard entry when the trace had multiple runs', async () => {
    const trialId = 'trial-multi'
    await putJson(`trials/${trialId}/entries/user-a/a/result.json`, storedEntry('a', 90, 3))
    await putJson(`trials/${trialId}/entries/user-b/b/result.json`, storedEntry('b', 80)) // single run, no count

    await rebuildLeaderboard(trialId)
    const board = await getJson<LeaderboardEntry[]>(`trials/${trialId}/leaderboard.json`)
    expect(board).not.toBeNull()

    const a = board!.find(e => e.entryId === 'a')!
    const b = board!.find(e => e.entryId === 'b')!
    expect(a.runCount).toBe(3)
    // A single-run entry must not carry a runCount (so the UI never says
    // "best of 1 run").
    expect(b.runCount).toBeUndefined()
  })

  it('omits runCount when the trace had exactly one run', async () => {
    const trialId = 'trial-single'
    await putJson(`trials/${trialId}/entries/user-c/c/result.json`, storedEntry('c', 70, 1))

    await rebuildLeaderboard(trialId)
    const board = await getJson<LeaderboardEntry[]>(`trials/${trialId}/leaderboard.json`)
    expect(board!.find(e => e.entryId === 'c')!.runCount).toBeUndefined()
  })
})

describe('rebuildLeaderboard — avgStrokeRate (#148)', () => {
  it('carries avgStrokeRate onto the leaderboard entry when the trace had stroke rate', async () => {
    const trialId = 'trial-spm'
    await putJson(`trials/${trialId}/entries/user-a/a/result.json`, storedEntry('a', 90, undefined, 34))
    await putJson(`trials/${trialId}/entries/user-b/b/result.json`, storedEntry('b', 80)) // no stroke rate

    await rebuildLeaderboard(trialId)
    const board = await getJson<LeaderboardEntry[]>(`trials/${trialId}/leaderboard.json`)
    expect(board!.find(e => e.entryId === 'a')!.avgStrokeRate).toBe(34)
    // A trace without stroke rate must not carry the field, so the UI never
    // shows a blank/0 spm.
    expect(board!.find(e => e.entryId === 'b')!.avgStrokeRate).toBeUndefined()
  })
})
