// @vitest-environment node
import { CURRENT_TOS_VERSION } from '@/lib/types'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
// cognito-local has no ResendConfirmationCode.
vi.mock('@/lib/cognito', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cognito')>()),
  resendSignUpCode: vi.fn(async () => ({ ok: true })),
}))

import { POST as signup } from '@/app/att/api/auth/signup/route'
import { POST as confirm } from '@/app/att/api/auth/signup/confirm/route'
import { resendSignUpCode } from '@/lib/cognito'
import { getJson } from '@/lib/storage'
import { readConfirmationCode } from './cognito-db'
import { signUpConfirmed } from './signup-flow'
import { POST as login } from '@/app/att/api/auth/login/route'
import { POST as logout } from '@/app/att/api/auth/logout/route'
import { GET as me } from '@/app/att/api/auth/me/route'
import { cookies } from 'next/headers'

let dataDir: string
let unique = 0

beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir) })

function jsonReq(url: string, body: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function extractCookie(setCookie: string, name: string): string | null {
  const match = setCookie.match(new RegExp(`${name}=([^;]+)`))
  return match ? match[1] : null
}

function mockCookies(idToken: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => name === 'tt_id' && idToken ? { name, value: idToken } : undefined,
  } as ReturnType<typeof cookies> extends Promise<infer T> ? T : never)
}

function freshEmail(): string {
  return `user-${++unique}-${Date.now()}@example.com`
}

describe('POST /att/api/auth/signup', () => {
  const body = (email: string, displayName = 'Alice') =>
    ({ email, displayName, password: 'Password123', acceptedTosVersion: CURRENT_TOS_VERSION })

  it('emails a code and signs nothing in until it is entered (#702)', async () => {
    const email = freshEmail()
    const res = await signup(jsonReq('http://x/att/api/auth/signup', body(email)))
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ needsCode: true, email })
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(await readConfirmationCode(email)).toMatch(/^\d{6}$/)
  })

  it('the emailed code signs in with cookies, records the Terms and marks the email proven', async () => {
    const email = freshEmail()
    const res = await signUpConfirmed(body(email))
    expect(res.status).toBe(201)
    const out = await res.json()
    expect(out.email).toBe(email)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('tt_id=')
    expect(setCookie).toContain('tt_refresh=')
    expect(await getJson(`users/${out.id}/email-proven.json`)).toMatchObject({ how: 'sign_up_code' })
    expect(await getJson(`users/${out.id}/tos-consent.json`)).not.toBeNull()
  })

  it('a wrong code is refused and signs nothing in', async () => {
    const email = freshEmail()
    await signup(jsonReq('http://x/att/api/auth/signup', body(email)))
    const code = await readConfirmationCode(email)
    const wrong = code === '000000' ? '111111' : '000000'
    const res = await confirm(jsonReq('http://x/att/api/auth/signup/confirm', {
      email, code: wrong, password: 'Password123', acceptedTosVersion: CURRENT_TOS_VERSION,
    }))
    expect(res.status).toBe(400)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('the right code with the wrong password confirms the email but signs nothing in', async () => {
    const email = freshEmail()
    await signup(jsonReq('http://x/att/api/auth/signup', body(email)))
    const code = await readConfirmationCode(email)
    const res = await confirm(jsonReq('http://x/att/api/auth/signup/confirm', {
      email, code, password: 'NotTheOne123', acceptedTosVersion: CURRENT_TOS_VERSION,
    }))
    expect(res.status).toBe(500)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('confirming needs the current Terms version too', async () => {
    const res = await confirm(jsonReq('http://x/att/api/auth/signup/confirm', {
      email: freshEmail(), code: '123456', password: 'Password123', acceptedTosVersion: '001',
    }))
    expect(res.status).toBe(422)
  })

  it('confirming from a sign-in leaves the Terms to the Terms page (no version sent, needsTerms answered)', async () => {
    const email = freshEmail()
    await signup(jsonReq('http://x/att/api/auth/signup', body(email)))
    const code = await readConfirmationCode(email)
    const res = await confirm(jsonReq('http://x/att/api/auth/signup/confirm', { email, code, password: 'Password123' }))
    expect(res.status).toBe(201)
    const out = await res.json()
    expect(out.needsTerms).toBe(true)
    expect(await getJson(`users/${out.id}/tos-consent.json`)).toBeNull()
  })

  it('an account whose code was never entered does not hold the email: signing up again replaces it', async () => {
    const email = freshEmail()
    // Someone who doesn't own the address starts an account on it...
    await signup(jsonReq('http://x/att/api/auth/signup', { ...body(email, 'Squatter'), password: 'Squatter123' }))
    // ...and the owner, who gets the emails, signs up anyway.
    const res = await signUpConfirmed(body(email, 'Owner'))
    expect(res.status).toBe(201)
    // The first password is gone with the account it belonged to.
    const squat = await login(jsonReq('http://x/att/api/auth/login', { email, password: 'Squatter123' }))
    expect(squat.status).toBe(401)
  })

  it('an unconfirmed account can\'t sign in: the right password gets a new code and a request for it', async () => {
    const email = freshEmail()
    await signup(jsonReq('http://x/att/api/auth/signup', body(email)))
    vi.mocked(resendSignUpCode).mockClear()
    const res = await login(jsonReq('http://x/att/api/auth/login', { email, password: 'Password123' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ needsCode: true })
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(resendSignUpCode).toHaveBeenCalledWith(email)
    // A wrong password learns nothing and sends nothing.
    vi.mocked(resendSignUpCode).mockClear()
    const wrong = await login(jsonReq('http://x/att/api/auth/login', { email, password: 'WrongPassword1' }))
    expect(wrong.status).toBe(401)
    expect(resendSignUpCode).not.toHaveBeenCalled()
  })

  it('rejects missing fields', async () => {
    const res = await signup(jsonReq('http://x/att/api/auth/signup', { email: 'a@b.com' }))
    expect(res.status).toBe(400)
  })

  it('rejects password shorter than 8 characters', async () => {
    const res = await signup(jsonReq('http://x/att/api/auth/signup', {
      email: freshEmail(), displayName: 'A', password: 'short',
      acceptedTosVersion: CURRENT_TOS_VERSION,
    }))
    expect(res.status).toBe(400)
  })

  // Note: cognito-local doesn't enforce the password complexity policy that real
  // Cognito does. We rely on the prod pool to enforce uppercase/lowercase/digit
  // requirements; the >=8 character length is checked client-side in the signup route.

  it('rejects the email of a confirmed account with 409', async () => {
    const email = freshEmail()
    const body = { email, displayName: 'D', password: 'Password123', acceptedTosVersion: CURRENT_TOS_VERSION }
    expect((await signUpConfirmed(body)).status).toBe(201)
    const res = await signup(jsonReq('http://x/att/api/auth/signup', body))
    expect(res.status).toBe(409)
  })
})

describe('POST /att/api/auth/login', () => {
  let bobEmail: string
  beforeEach(async () => {
    bobEmail = freshEmail()
    await signUpConfirmed({
      email: bobEmail, displayName: 'Bob', password: 'Password123',
      acceptedTosVersion: CURRENT_TOS_VERSION,
    })
  })

  it('returns ID + refresh cookies on valid credentials', async () => {
    const res = await login(jsonReq('http://x/att/api/auth/login', {
      email: bobEmail, password: 'Password123',
    }))
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('tt_id=')
    expect(setCookie).toContain('tt_refresh=')
  })

  it('does not ask someone who accepted the Terms at sign-up to accept them again', async () => {
    const res = await login(jsonReq('http://x/att/api/auth/login', { email: bobEmail, password: 'Password123' }))
    expect((await res.json()).needsTerms).toBe(false)
  })

  it('rejects wrong password with 401', async () => {
    const res = await login(jsonReq('http://x/att/api/auth/login', {
      email: bobEmail, password: 'WrongPassword1',
    }))
    expect(res.status).toBe(401)
  })

  it('rejects unknown email with 401', async () => {
    const res = await login(jsonReq('http://x/att/api/auth/login', {
      email: 'nobody-' + freshEmail(), password: 'Password123',
    }))
    expect(res.status).toBe(401)
  })
})

describe('GET /att/api/auth/me', () => {
  it('returns user when ID token is valid', async () => {
    const email = freshEmail()
    const signupRes = await signUpConfirmed({
      email, displayName: 'Carol', password: 'Password123',
      acceptedTosVersion: CURRENT_TOS_VERSION,
    })
    const setCookie = signupRes.headers.get('set-cookie') ?? ''
    const idToken = extractCookie(setCookie, 'tt_id') ?? ''
    expect(idToken).not.toBe('')

    mockCookies(idToken)
    const res = await me()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.email).toBe(email)
    // cognito-local doesn't put `name` in the JWT; verifyIdToken falls back to
    // email-local-part. Real Cognito would return 'Carol' here.
    expect(body.displayName).toBe(email.split('@')[0])
  })

  // Signed-out is a normal state for this probe, so it answers 200 with a null
  // body rather than 401 (a 401 is logged as a console error on every logged-out
  // page load). Callers treat a null body as "not signed in".
  it('returns 200 with a null body when no cookie', async () => {
    mockCookies(null)
    const res = await me()
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })

  it('returns 200 with a null body for a garbage cookie', async () => {
    mockCookies('not.a.real.jwt')
    const res = await me()
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })
})

describe('POST /att/api/auth/logout', () => {
  it('clears ID and refresh cookies', async () => {
    const email = freshEmail()
    const signupRes = await signUpConfirmed({
      email, displayName: 'Dan', password: 'Password123', acceptedTosVersion: CURRENT_TOS_VERSION,
    })
    const setCookie = signupRes.headers.get('set-cookie') ?? ''
    const refreshToken = extractCookie(setCookie, 'tt_refresh') ?? ''
    expect(refreshToken).not.toBe('')

    vi.mocked(cookies).mockResolvedValue({
      get: (name: string) => name === 'tt_refresh' ? { name, value: refreshToken } : undefined,
    } as ReturnType<typeof cookies> extends Promise<infer T> ? T : never)

    const res = await logout(new Request('http://x/att/api/auth/logout', { method: 'POST' }))
    expect(res.status).toBe(200)
    const cleared = res.headers.get('set-cookie') ?? ''
    expect(cleared).toMatch(/tt_id=;|tt_id=.*Max-Age=0/i)
    expect(cleared).toMatch(/tt_refresh=;|tt_refresh=.*Max-Age=0/i)
    // The mark a web-code link leaves (it blocks connecting Strava) goes too.
    expect(cleared).toMatch(/tt_from_link=;|tt_from_link=.*Max-Age=0/i)
  })
})
