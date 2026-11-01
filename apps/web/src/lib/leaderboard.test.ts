// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeDataDir, cleanDataDir } from '../tests/helpers'
import { putJson, getJson } from './storage'
import { rebuildLeaderboard } from './leaderboard'
import type { LeaderboardEntry } from './types'

describe('rebuildLeaderboard', () => {
  let dataDir: string
  beforeEach(async () => { dataDir = await makeDataDir() })
  afterEach(async () => { await cleanDataDir(dataDir) })

  function plant(entryId: string, filename: string) {
    return putJson(`trials/t1/entries/u1/${entryId}/result.json`, {
      entryId, userId: 'u1', displayName: 'Paddler',
      submittedAt: '2025-01-01T00:00:00Z', filename,
      raceDate: '2025-01-01',
      boatClass: 'K1', crew: [{ seat: 1, name: 'Paddler' }],
      result: { startTimestamp: '2025-01-01T10:00:00Z', finishTimestamp: '2025-01-01T10:01:00Z', totalElapsedSeconds: 60, splits: [] },
    })
  }

  it('carries a stored conditions snapshot onto the leaderboard entry (#106)', async () => {
    const conditions = {
      capturedAt: '2025-01-01T10:05:00Z', at: '2025-01-01T10:01:00Z',
      weather: { temperatureC: 12, windSpeedKmh: 18 },
      flow: { stationId: 'm1', valueM3s: 23.4 },
    }
    await putJson('trials/t1/entries/u1/e-cond/result.json', {
      entryId: 'e-cond', userId: 'u1', displayName: 'P', submittedAt: '2025-01-01T00:00:00Z',
      filename: 'run.gpx', raceDate: '2025-01-01',
      boatClass: 'K1', crew: [{ seat: 1, name: 'P' }],
      result: { startTimestamp: '2025-01-01T10:00:00Z', finishTimestamp: '2025-01-01T10:01:00Z', totalElapsedSeconds: 60, splits: [] },
      conditions,
    })
    await plant('e-plain', 'plain.gpx')

    await rebuildLeaderboard('t1')

    const board = await getJson<LeaderboardEntry[]>('trials/t1/leaderboard.json')
    expect(board!.find(e => e.entryId === 'e-cond')!.conditions).toEqual(conditions)
    expect(board!.find(e => e.entryId === 'e-plain')!.conditions).toBeUndefined()
  })
})
