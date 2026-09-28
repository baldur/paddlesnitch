// @vitest-environment node
// stravaAccessRevoked asks Strava whether a user's grant is really gone before
// the webhook disconnects them (security audit 2026-09).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir } from './helpers'
import { putStravaTokens, stravaAccessRevoked } from '@paddlesnitch/core/strava-storage'

let dataDir: string
beforeEach(async () => {
  dataDir = await makeDataDir()
  await putStravaTokens('u1', { accessToken: 'a', refreshToken: 'r', expiresAt: Math.floor(Date.now() / 1000) + 3600, athleteId: 99, scope: 'read' } as never)
})
afterEach(async () => { await cleanDataDir(dataDir); vi.unstubAllGlobals() })

const athleteAnswers = (status: number) => vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })))

describe('stravaAccessRevoked', () => {
  it('true when Strava refuses the token', async () => {
    athleteAnswers(401)
    expect(await stravaAccessRevoked('u1')).toBe(true)
  })
  it('false when the token still works (the event was forged)', async () => {
    athleteAnswers(200)
    expect(await stravaAccessRevoked('u1')).toBe(false)
  })
  it('unknown when Strava is having trouble, so nothing is deleted', async () => {
    athleteAnswers(503)
    expect(await stravaAccessRevoked('u1')).toBe('unknown')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    expect(await stravaAccessRevoked('u1')).toBe('unknown')
  })
  it('true when there is nothing stored', async () => {
    expect(await stravaAccessRevoked('nobody')).toBe(true)
  })
})
