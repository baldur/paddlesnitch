// @vitest-environment node
// Strava athlete links left by deleted accounts (scripts/strava-index-cleanup.ts):
// only links whose account Cognito says is gone are removed, and an error
// stops the run instead of counting as "gone".
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'
import { putAthleteIndex, getUserIdByAthleteId } from '@paddlesnitch/core/strava-storage'
import { userExistsBySub } from '@paddlesnitch/core/cognito'
import { run } from '../../scripts/strava-index-cleanup'

let dir: string
beforeEach(async () => { dir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dir) })

describe('strava-index-cleanup', () => {
  it('a dry run lists the stale link and deletes nothing; --apply removes only it', async () => {
    const live = await makeUser('Live')
    await putAthleteIndex(1, live.id)
    await putAthleteIndex(2, 'sub-of-a-deleted-account')
    expect((await run(false)).stale).toEqual(['strava-athletes/2.json'])
    expect(await getUserIdByAthleteId(2)).toBe('sub-of-a-deleted-account')
    await run(true)
    expect(await getUserIdByAthleteId(2)).toBeNull()
    expect(await getUserIdByAthleteId(1)).toBe(live.id)
  })

  it('stops at the first lookup error and deletes nothing after it', async () => {
    await putAthleteIndex(3, 'sub-a')
    await putAthleteIndex(4, 'sub-b')
    await expect(run(true, async () => { throw new Error('throttled') })).rejects.toThrow('throttled')
    expect(await getUserIdByAthleteId(3)).toBe('sub-a')
    expect(await getUserIdByAthleteId(4)).toBe('sub-b')
  })

  it('userExistsBySub answers true for a real account and false for none (the real Cognito lookup)', async () => {
    const u = await makeUser('Real')
    expect(await userExistsBySub(u.id)).toBe(true)
    expect(await userExistsBySub('00000000-0000-0000-0000-000000000000')).toBe(false)
  })
})
