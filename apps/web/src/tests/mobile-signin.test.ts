// @vitest-environment node
// Signing in from the apps (docs/features/mobile-apps.md, C2): the same
// sign-in routes as the website, through the same code, but an app marks its
// call with the x-paddlesnitch-app header and gets the tokens in the answer
// instead of cookies. The website's answers never carry a token.
import { CURRENT_TOS_VERSION } from '@/lib/types'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { cookies } from 'next/headers'
import { POST as signup } from '@/app/att/api/auth/signup/route'
import { POST as login } from '@/app/att/api/auth/login/route'
import { POST as logout } from '@/app/att/api/auth/logout/route'
import { POST as refreshRoute } from '@/app/att/api/auth/refresh/route'
import { POST as requestReset } from '@/app/att/api/auth/password-reset/request/route'
import { POST as confirmReset } from '@/app/att/api/auth/password-reset/confirm/route'
import { readConfirmationCode } from './cognito-db'
import { verifyIdToken, refresh } from '@/lib/cognito'
import { restRoutes, SignIn, Refreshed, Ok, ApiError, ResetDone } from '@paddlesnitch/api/contract'
import type { z } from 'zod'
import { existsSync } from 'fs'
import path from 'path'

let dataDir: string
beforeEach(async () => {
  dataDir = await makeDataDir()
  vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as unknown as Awaited<ReturnType<typeof cookies>>)
})
afterEach(async () => { await cleanDataDir(dataDir) })

const post = (url: string, body: unknown, app = false) => new NextRequest(`http://x${url}`, {
  method: 'POST', body: JSON.stringify(body),
  headers: { 'content-type': 'application/json', ...(app ? { 'x-paddlesnitch-app': 'android/0.1.0' } : {}) },
})
const email = () => `app-${crypto.randomUUID().slice(0, 8)}@example.com`

describe('signing in from an app', () => {
  it('password sign-in answers with the tokens and sets no cookies', async () => {
    const u = await makeUser('Pat')
    const res = await login(post('/att/api/auth/login', { email: u.email, password: 'Password123' }, true))
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toBeNull()
    const body = await res.json()
    expect(body).toMatchObject({ id: u.id, email: u.email, needsTerms: expect.any(Boolean) })
    expect((await verifyIdToken(body.idToken))?.id).toBe(u.id)
    expect('idToken' in (await refresh(body.refreshToken))).toBe(true)
  })

  it('sign-up does the same, after the same checks (terms, invitations)', async () => {
    const res = await signup(post('/att/api/auth/signup', { email: email(), displayName: 'Sam', password: 'Password123', acceptedTosVersion: CURRENT_TOS_VERSION }, true))
    expect(res.status).toBe(201)
    expect(res.headers.get('set-cookie')).toBeNull()
    const body = await res.json()
    expect((await verifyIdToken(body.idToken))?.id).toBe(body.id)
    expect(body.refreshToken).toEqual(expect.any(String))
    // An out-of-date app gets the same refusal as an out-of-date page.
    const old = await signup(post('/att/api/auth/signup', { email: email(), displayName: 'Old', password: 'Password123', acceptedTosVersion: 'v0' }, true))
    expect(old.status).toBe(422)
  })

  it('a wrong password is refused the same way, with no tokens', async () => {
    const u = await makeUser('Pat')
    const res = await login(post('/att/api/auth/login', { email: u.email, password: 'Wrong12345' }, true))
    expect(res.status).toBe(401)
    expect(await res.json()).not.toHaveProperty('idToken')
  })

  it('the website still gets cookies, and never a token in the answer', async () => {
    const u = await makeUser('Pat')
    const res = await login(post('/att/api/auth/login', { email: u.email, password: 'Password123' }))
    expect(res.headers.get('set-cookie')).toContain('tt_id=')
    const body = await res.json()
    expect(body).not.toHaveProperty('idToken')
    expect(body).not.toHaveProperty('refreshToken')
  })
})

describe('POST /att/api/auth/refresh', () => {
  it('swaps the refresh token for a new ID token', async () => {
    const u = await makeUser('Pat')
    const res = await refreshRoute(post('/att/api/auth/refresh', { refreshToken: u.refreshToken }, true))
    expect(res.status).toBe(200)
    expect((await verifyIdToken((await res.json()).idToken))?.id).toBe(u.id)
  })

  it('refuses a bad or missing refresh token (401: sign in again)', async () => {
    expect((await refreshRoute(post('/att/api/auth/refresh', { refreshToken: 'nope' }, true))).status).toBe(401)
    expect((await refreshRoute(post('/att/api/auth/refresh', {}, true))).status).toBe(401)
  })
})

describe('signing out from an app', () => {
  it('revokes the refresh token it sends, so it can no longer be swapped', async () => {
    const u = await makeUser('Pat')
    const res = await logout(post('/att/api/auth/logout', { refreshToken: u.refreshToken }, true))
    expect(res.status).toBe(200)
    expect((await refreshRoute(post('/att/api/auth/refresh', { refreshToken: u.refreshToken }, true))).status).toBe(401)
  })
})

// The schemas in mobile/contract/api/ (rest.json) are hand-written for these
// routes, so the routes' real answers are read through them here.
describe('the sign-in routes answer what the contract says', () => {
  const fits = async (schema: z.ZodType, res: Response) => expect(schema.safeParse(await res.json()).error?.issues).toBeUndefined()

  it('every route in rest.json exists', () => {
    for (const route of Object.keys(restRoutes)) {
      const [, p] = route.split(' ')
      expect(existsSync(path.join(__dirname, '../app', p, 'route.ts')), route).toBe(true)
    }
  })

  it('login, sign-up, refresh and sign-out answers and refusals', async () => {
    const u = await makeUser('Pat')
    await fits(SignIn, await login(post('/att/api/auth/login', { email: u.email, password: 'Password123' }, true)))
    await fits(ApiError, await login(post('/att/api/auth/login', { email: u.email, password: 'Wrong12345' }, true)))
    await fits(SignIn, await signup(post('/att/api/auth/signup', { email: email(), displayName: 'Sam', password: 'Password123', acceptedTosVersion: CURRENT_TOS_VERSION }, true)))
    await fits(ApiError, await signup(post('/att/api/auth/signup', { email: email(), displayName: 'Old', password: 'Password123', acceptedTosVersion: 'v0' }, true)))
    await fits(Refreshed, await refreshRoute(post('/att/api/auth/refresh', { refreshToken: u.refreshToken }, true)))
    await fits(ApiError, await refreshRoute(post('/att/api/auth/refresh', { refreshToken: 'nope' }, true)))
    await fits(Ok, await logout(post('/att/api/auth/logout', { refreshToken: u.refreshToken }, true)))
  })
})

describe('forgot password from an app', () => {
  const fits = async (schema: z.ZodType, res: Response) => {
    const body = await res.json()
    expect(schema.safeParse(body).error?.issues).toBeUndefined()
    return body
  }

  it('asks for a code, then sets the new password and answers with the tokens, no cookies', async () => {
    const u = await makeUser('Pat')
    const asked = await requestReset(post('/att/api/auth/password-reset/request', { email: u.email, website: '', elapsedMs: 5000 }, true))
    expect(asked.status).toBe(200)
    await fits(Ok, asked)
    const code = await readConfirmationCode(u.email)
    const res = await confirmReset(post('/att/api/auth/password-reset/confirm', { email: u.email, code, password: 'NewPassword456' }, true))
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toBeNull()
    const body = await fits(ResetDone, res)
    expect(body).toMatchObject({ ok: true, signedIn: true })
    expect((await verifyIdToken(body.idToken))?.id).toBe(u.id)
    expect('idToken' in (await refresh(body.refreshToken))).toBe(true)
  })

  it('a wrong code and a missing email are ApiErrors (400)', async () => {
    const u = await makeUser('Pat')
    const wrong = await confirmReset(post('/att/api/auth/password-reset/confirm', { email: u.email, code: '000000', password: 'NewPassword456' }, true))
    expect(wrong.status).toBe(400)
    await fits(ApiError, wrong)
    const none = await requestReset(post('/att/api/auth/password-reset/request', { website: '', elapsedMs: 5000 }, true))
    expect(none.status).toBe(400)
    await fits(ApiError, none)
  })
})
