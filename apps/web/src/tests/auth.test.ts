// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { POST as signup } from '@/app/att/api/auth/signup/route'
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
  it('creates a Cognito user and sets ID + refresh cookies', async () => {
    const email = freshEmail()
    const res = await signup(jsonReq('http://x/att/api/auth/signup', {
      email,
      displayName: 'Alice',
      password: 'Password123',
      acceptedTosVersion: '001',
    }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.email).toBe(email)
    expect(body.displayName).toBe('Alice')
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('tt_id=')
    expect(setCookie).toContain('tt_refresh=')
  })

  it('rejects missing fields', async () => {
    const res = await signup(jsonReq('http://x/att/api/auth/signup', { email: 'a@b.com' }))
    expect(res.status).toBe(400)
  })

  it('rejects password shorter than 8 characters', async () => {
    const res = await signup(jsonReq('http://x/att/api/auth/signup', {
      email: freshEmail(), displayName: 'A', password: 'short',
      acceptedTosVersion: '001',
    }))
    expect(res.status).toBe(400)
  })

  // Note: cognito-local doesn't enforce the password complexity policy that real
  // Cognito does. We rely on the prod pool to enforce uppercase/lowercase/digit
  // requirements; the >=8 character length is checked client-side in the signup route.

  it('rejects duplicate email with 409', async () => {
    const email = freshEmail()
    const body = { email, displayName: 'D', password: 'Password123', acceptedTosVersion: '001' }
    await signup(jsonReq('http://x/att/api/auth/signup', body))
    const res = await signup(jsonReq('http://x/att/api/auth/signup', body))
    expect(res.status).toBe(409)
  })
})

describe('POST /att/api/auth/login', () => {
  let bobEmail: string
  beforeEach(async () => {
    bobEmail = freshEmail()
    await signup(jsonReq('http://x/att/api/auth/signup', {
      email: bobEmail, displayName: 'Bob', password: 'Password123',
      acceptedTosVersion: '001',
    }))
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
    const signupRes = await signup(jsonReq('http://x/att/api/auth/signup', {
      email, displayName: 'Carol', password: 'Password123',
      acceptedTosVersion: '001',
    }))
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
    const signupRes = await signup(jsonReq('http://x/att/api/auth/signup', {
      email, displayName: 'Dan', password: 'Password123', acceptedTosVersion: '001',
    }))
    const setCookie = signupRes.headers.get('set-cookie') ?? ''
    const refreshToken = extractCookie(setCookie, 'tt_refresh') ?? ''
    expect(refreshToken).not.toBe('')

    vi.mocked(cookies).mockResolvedValue({
      get: (name: string) => name === 'tt_refresh' ? { name, value: refreshToken } : undefined,
    } as ReturnType<typeof cookies> extends Promise<infer T> ? T : never)

    const res = await logout()
    expect(res.status).toBe(200)
    const cleared = res.headers.get('set-cookie') ?? ''
    expect(cleared).toMatch(/tt_id=;|tt_id=.*Max-Age=0/i)
    expect(cleared).toMatch(/tt_refresh=;|tt_refresh=.*Max-Age=0/i)
  })
})
