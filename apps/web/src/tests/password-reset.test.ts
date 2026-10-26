// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'
import { readConfirmationCode } from './cognito-db'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
// AdminUserGlobalSignOut isn't in cognito-local.
vi.mock('@/lib/cognito', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cognito')>()),
  signOutEverywhere: vi.fn(),
  // The real one, watched: the reset must end sessions before it signs in.
  signIn: vi.fn((await importOriginal<typeof import('@/lib/cognito')>()).signIn),
}))
// The Strava deauthorize call must never leave the test process.
vi.mock('@paddlesnitch/core/strava', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@paddlesnitch/core/strava')>()),
  revoke: vi.fn(),
}))

import { POST as requestReset } from '@/app/att/api/auth/password-reset/request/route'
import { POST as confirmReset } from '@/app/att/api/auth/password-reset/confirm/route'
import { POST as login } from '@/app/att/api/auth/login/route'
import * as cognito from '@/lib/cognito'
import { revoke } from '@paddlesnitch/core/strava'
import { getJson } from '@/lib/storage'
import { markEmailProven } from '@/lib/email-proven'
import { putStravaTokens, putAthleteIndex, getStravaTokens, getUserIdByAthleteId } from '@/lib/strava-storage'

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir); vi.restoreAllMocks() })

// Real clients post anti-bot fields (an empty honeypot + the elapsed time
// since the form loaded). Default to a human-like submission so the existing
// cases sail through the gate; the bot test overrides them.
function jsonReq(url: string, body: Record<string, unknown>) {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify({ website: '', elapsedMs: 5_000, ...body }),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /att/api/auth/password-reset/request', () => {
  it('returns 200 and sets a ConfirmationCode on the user', async () => {
    const user = await makeUser()
    const res = await requestReset(jsonReq('http://x', { email: user.email }))
    expect(res.status).toBe(200)
    const code = await readConfirmationCode(user.email)
    expect(code).toMatch(/^\d{6}$/)
  })

  it('returns 200 for an unknown email (no account-existence leak)', async () => {
    const res = await requestReset(jsonReq('http://x', { email: 'nobody-' + Date.now() + '@example.com' }))
    expect(res.status).toBe(200)
  })

  it('returns 400 when email is missing', async () => {
    const res = await requestReset(jsonReq('http://x', {}))
    expect(res.status).toBe(400)
  })

  it('stops emailing reset codes to one address after 5 in an hour, without saying so', async () => {
    const spy = vi.spyOn(cognito, 'forgotPassword').mockResolvedValue({ ok: true })
    for (let i = 0; i < 7; i++) {
      const res = await requestReset(jsonReq('http://x', { email: 'someone@example.com' }))
      expect(res.status).toBe(200)   // same answer as ever: no signal about the account or the limit
    }
    expect(spy).toHaveBeenCalledTimes(5)
  })

  it('drops a bot submission (populated honeypot) without emailing a code', async () => {
    const user = await makeUser()
    // Deterministic: assert forgotPassword was never invoked, rather than
    // diffing the cognito-local db file (whose signup ConfirmationCode is
    // written asynchronously and races with the read — the old flake).
    const spy = vi.spyOn(cognito, 'forgotPassword').mockResolvedValue({ ok: true })
    const res = await requestReset(jsonReq('http://x', { email: user.email, website: 'http://spam.example' }))
    // Same { ok: true } a real request gets — no signal to the bot...
    expect(res.status).toBe(200)
    // ...and the gate dropped it before any Cognito email work.
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('POST /att/api/auth/password-reset/confirm', () => {
  it('accepts a valid code and lets the user sign in with the new password', async () => {
    const user = await makeUser()
    await requestReset(jsonReq('http://x', { email: user.email }))
    const code = await readConfirmationCode(user.email)
    expect(code).not.toBeNull()

    const newPassword = 'BrandNew99'
    const res = await confirmReset(jsonReq('http://x', { email: user.email, code, password: newPassword }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)

    // Old password no longer works.
    const oldLogin = await login(jsonReq('http://x', { email: user.email, password: 'Password123' }))
    expect(oldLogin.status).toBe(401)

    // New password works.
    const newLogin = await login(jsonReq('http://x', { email: user.email, password: newPassword }))
    expect(newLogin.status).toBe(200)
  })

  it('rejects a wrong code', async () => {
    const user = await makeUser()
    await requestReset(jsonReq('http://x', { email: user.email }))
    const res = await confirmReset(jsonReq('http://x', {
      email: user.email,
      code: '000000',
      password: 'BrandNew99',
    }))
    expect(res.status).toBe(400)
  })

  it('rejects a too-short password', async () => {
    const user = await makeUser()
    await requestReset(jsonReq('http://x', { email: user.email }))
    const code = await readConfirmationCode(user.email)
    const res = await confirmReset(jsonReq('http://x', {
      email: user.email,
      code,
      password: 'short',
    }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when any field is missing', async () => {
    const user = await makeUser()
    const res = await confirmReset(jsonReq('http://x', { email: user.email }))
    expect(res.status).toBe(400)
  })
})

// #702: until sign-up codes, anyone could make an account on an address they
// didn't own. A reset is the owner taking it back.
describe('a password reset ends what the account\'s old holder had', () => {
  async function reset(email: string) {
    await requestReset(jsonReq('http://x', { email }))
    const code = await readConfirmationCode(email)
    return confirmReset(jsonReq('http://x', { email, code, password: 'BrandNew99' }))
  }
  async function connectStrava(userId: string, athleteId: number) {
    await putStravaTokens(userId, { accessToken: 'a', refreshToken: 'r', expiresAt: 0, athleteId } as never)
    await putAthleteIndex(athleteId, userId)
  }

  it('ends every session, before signing the new password in', async () => {
    const user = await makeUser()
    vi.mocked(cognito.signOutEverywhere).mockClear()
    vi.mocked(cognito.signIn).mockClear()
    const res = await reset(user.email)
    expect(res.status).toBe(200)
    expect(cognito.signOutEverywhere).toHaveBeenCalledWith(user.email)
    expect((await res.json()).signedIn).toBe(true)
    // Ending every session after signing in would end the new one too.
    expect(vi.mocked(cognito.signOutEverywhere).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(cognito.signIn).mock.invocationCallOrder[0])
  })

  it('an account that never proved its email loses its Strava connection, and is proven from then on', async () => {
    const user = await makeUser()
    await connectStrava(user.id, 9001)
    vi.mocked(revoke).mockClear()
    expect((await reset(user.email)).status).toBe(200)
    expect(await getStravaTokens(user.id)).toBeNull()
    expect(await getUserIdByAthleteId(9001)).toBeNull()
    expect(revoke).toHaveBeenCalledWith('a')
    expect(await getJson(`users/${user.id}/email-proven.json`)).toMatchObject({ how: 'password_reset' })
  })

  it('an account that had proved its email keeps Strava', async () => {
    const user = await makeUser()
    await markEmailProven(user.id, 'sign_up_code')
    await connectStrava(user.id, 9002)
    expect((await reset(user.email)).status).toBe(200)
    expect(await getStravaTokens(user.id)).not.toBeNull()
    expect(await getUserIdByAthleteId(9002)).toBe(user.id)
  })

  it('a wrong code changes nothing', async () => {
    const user = await makeUser()
    await connectStrava(user.id, 9003)
    vi.mocked(cognito.signOutEverywhere).mockClear()
    await requestReset(jsonReq('http://x', { email: user.email }))
    const res = await confirmReset(jsonReq('http://x', { email: user.email, code: '000000', password: 'BrandNew99' }))
    expect(res.status).toBe(400)
    expect(cognito.signOutEverywhere).not.toHaveBeenCalled()
    expect(await getStravaTokens(user.id)).not.toBeNull()
  })

  it('when the other sessions can\'t be ended, the reset still works, Strava still goes, and the account isn\'t marked proven', async () => {
    const user = await makeUser()
    await connectStrava(user.id, 9004)
    vi.mocked(cognito.signOutEverywhere).mockRejectedValueOnce(new Error('Cognito down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await reset(user.email)
    expect(res.status).toBe(200)
    expect((await res.json()).signedIn).toBe(true)
    expect(err).toHaveBeenCalled()
    expect(await getStravaTokens(user.id)).toBeNull()
    // Not proven: the next reset tries everything again.
    expect(await getJson(`users/${user.id}/email-proven.json`)).toBeNull()
  })
})
