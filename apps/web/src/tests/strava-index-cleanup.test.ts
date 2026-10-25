// @vitest-environment node
// Strava athlete links left by deleted accounts (scripts/strava-index-cleanup.ts):
// only links whose account Cognito says is gone are removed, and an error
// stops the run instead of counting as "gone".
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'
import { putAthleteIndex, getUserIdByAthleteId } from '@paddlesnitch/core/strava-storage'
import { userExistsBySub } from '@paddlesnitch/core/cognito'
import { run } from '../../scripts/strava-index-cleanup'

let dir: string
beforeEach(async () => { dir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dir); vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('strava-index-cleanup', () => {
  it('a dry run lists the stale link and deletes nothing; --apply removes only it', async () => {
    const live = await makeUser('Live')
    await putAthleteIndex(1, live.id)
    await putAthleteIndex(2, 'sub-of-a-deleted-account')
    await putAthleteIndex(6, (await makeUser('Live too')).id)
    expect((await run(false)).stale).toEqual(['strava-athletes/2.json'])
    expect(await getUserIdByAthleteId(2)).toBe('sub-of-a-deleted-account')
    await putAthleteIndex(5, (await makeUser('Also live')).id)
    expect((await run(true)).stale).toEqual(['strava-athletes/2.json'])
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

  it('refuses when most links look stale: the lookup is pointed at the wrong pool', async () => {
    await putAthleteIndex(7, 'sub-x')
    await putAthleteIndex(8, 'sub-y')
    await putAthleteIndex(9, (await makeUser('Live')).id)
    await expect(run(true, async () => false)).rejects.toThrow(/wrong Cognito pool/)
    expect(await getUserIdByAthleteId(7)).toBe('sub-x')
  })

  it('refuses a local Cognito endpoint together with a real data bucket', async () => {
    vi.stubEnv('COGNITO_ENDPOINT', 'http://localhost:9229')
    vi.stubEnv('DATA_BUCKET', 'paddlesnitch-data-prod')
    await expect(run(false)).rejects.toThrow(/refusing/)
  })

  it('userExistsBySub throws on a Cognito error, never answers false', async () => {
    vi.spyOn(CognitoIdentityProviderClient.prototype, 'send').mockRejectedValueOnce(new Error('TooManyRequestsException') as never)
    await expect(userExistsBySub('any-sub')).rejects.toThrow('TooManyRequestsException')
  })

  it('userExistsBySub answers true for a real account and false for none (the real Cognito lookup)', async () => {
    const u = await makeUser('Real')
    expect(await userExistsBySub(u.id)).toBe(true)
    expect(await userExistsBySub('00000000-0000-0000-0000-000000000000')).toBe(false)
  })
})
