// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeDataDir, cleanDataDir } from '../tests/helpers'
import { putJson, getJson } from './storage'
import { rebuildLeaderboard, stravaActivityIdFromFilename } from './leaderboard'
import type { LeaderboardEntry } from './types'

describe('stravaActivityIdFromFilename (#107)', () => {
  it('recovers the activity id from a Strava import filename', () => {
    expect(stravaActivityIdFromFilename('strava-987654321.json')).toBe(987654321)
  })
  it('returns undefined for file / URL uploads', () => {
    expect(stravaActivityIdFromFilename('activity.gpx')).toBeUndefined()
    expect(stravaActivityIdFromFilename('ride.fit')).toBeUndefined()
    expect(stravaActivityIdFromFilename('strava-.json')).toBeUndefined()
    expect(stravaActivityIdFromFilename('strava-123.gpx')).toBeUndefined()
  })
})

describe('rebuildLeaderboard carries the Strava activity id (#107)', () => {
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

  it('a Strava-imported entry gets stravaActivityId; a file upload does not', async () => {
    await plant('e-strava', 'strava-555.json')
    await plant('e-file', 'my-run.gpx')

    await rebuildLeaderboard('t1')

    const board = await getJson<LeaderboardEntry[]>('trials/t1/leaderboard.json')
    const strava = board!.find(e => e.entryId === 'e-strava')
    const file = board!.find(e => e.entryId === 'e-file')
    expect(strava!.stravaActivityId).toBe(555)
    expect(file!.stravaActivityId).toBeUndefined()
  })

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
