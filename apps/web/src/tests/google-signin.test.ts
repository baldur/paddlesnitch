// @vitest-environment node
// Sign in with Google (#697). cognito-local has no hosted sign-in or Google,
// so Cognito's token endpoint is mocked here and answers with tokens that
// cognito-local itself issued; everything after the swap is real.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createHash } from 'crypto'
import { makeDataDir, cleanDataDir, makeUser, type TestUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { cookies } from 'next/headers'
import { GET as init } from '@/app/att/api/auth/google/init/route'
import { GET as callback } from '@/app/att/api/auth/google/callback/route'
import { recordAcceptance } from '@/lib/tos'
import { CURRENT_TOS_VERSION } from '@/lib/types'
import { errorKey } from '@/lib/google-signin'
import { deleteUserBySub, findUserByEmail } from '@/lib/cognito'

const DOMAIN = 'https://paddlesnitch.auth.eu-west-1.amazoncognito.com'
let dir: string
let pat: TestUser
let tokenCalls: URLSearchParams[]
beforeEach(async () => {
  dir = await makeDataDir()
  pat = await makeUser('Pat')
  vi.stubEnv('COGNITO_DOMAIN', DOMAIN)
  tokenCalls = []
  // Only Cognito's hosted token endpoint is faked: the token checker still
  // fetches cognito-local's signing keys for real.
  const realFetch = globalThis.fetch
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, initArg?: RequestInit) => {
    if (String(url) === `${DOMAIN}/oauth2/token`) {
      const body = new URLSearchParams(String(initArg?.body))
      tokenCalls.push(body)
      if (body.get('code') === 'good') return Response.json({ id_token: pat.idToken, refresh_token: pat.refreshToken, access_token: 'a' })
      return Response.json({ error: 'invalid_grant' }, { status: 400 })
    }
    return realFetch(url, initArg)
  }))
})
afterEach(async () => { await cleanDataDir(dir); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

function jar(c: Record<string, string>) {
  vi.mocked(cookies).mockResolvedValue({ get: (n: string) => (c[n] ? { name: n, value: c[n] } : undefined) } as never)
}
const get = (url: string) => new NextRequest(`http://localhost${url}`)
const setCookie = (res: Response, name: string) =>
  res.headers.getSetCookie().find(c => c.startsWith(`${name}=`))?.split(';')[0].slice(name.length + 1)
const to = (res: Response) => new URL(res.headers.get('location')!)

describe('starting Sign in with Google', () => {
  it('goes to Cognito\'s hosted sign-in for Google, with PKCE and a state, and remembers them', async () => {
    const res = await init(get('/att/api/auth/google/init?next=%2Fpaddles'))
    const url = to(res)
    expect(url.origin + url.pathname).toBe(`${DOMAIN}/oauth2/authorize`)
    const q = url.searchParams
    expect(q.get('identity_provider')).toBe('Google')
    expect(q.get('response_type')).toBe('code')
    expect(q.get('scope')).toBe('openid email profile')
    expect(q.get('redirect_uri')).toBe('http://localhost/att/api/auth/google/callback')
    expect(q.get('code_challenge_method')).toBe('S256')
    const verifier = setCookie(res, 'google_signin_verifier')!
    expect(q.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'))
    expect(q.get('state')).toBe(setCookie(res, 'google_signin_state'))
    expect(setCookie(res, 'google_signin_next')).toBe('%2Fpaddles')
    expect(res.headers.getSetCookie().find(c => c.startsWith('google_signin_verifier='))).toMatch(/HttpOnly/i)
  })

  it('says it isn\'t available where there is no hosted sign-in (local dev)', async () => {
    vi.stubEnv('COGNITO_DOMAIN', '')
    expect(to(await init(get('/att/api/auth/google/init'))).search).toBe('?error=google_not_configured')
  })
})

describe('back from Google', () => {
  const back = (query: string) => callback(get(`/att/api/auth/google/callback?${query}`))
  const started = { google_signin_state: 'st', google_signin_verifier: 'ver', google_signin_next: '/paddles' }

  it('swaps the code with the verifier and signs in, on to where they were going', async () => {
    await recordAcceptance(pat.id, CURRENT_TOS_VERSION)
    jar(started)
    const res = await back('code=good&state=st')
    expect(to(res).pathname).toBe('/paddles')
    expect(setCookie(res, 'tt_id')).toBe(pat.idToken)
    expect(setCookie(res, 'tt_refresh')).toBe(pat.refreshToken)
    expect(setCookie(res, 'google_signin_verifier')).toBe('')
    expect(tokenCalls[0].get('code_verifier')).toBe('ver')
    expect(tokenCalls[0].get('grant_type')).toBe('authorization_code')
  })

  it('a new account accepts the Terms first', async () => {
    jar(started)
    expect(to(await back('code=good&state=st')).pathname).toBe('/terms/accept')
  })

  it('refuses a forged state, a missing verifier and a code Cognito won\'t swap, signing nobody in', async () => {
    for (const [c, query] of [[started, 'code=good&state=forged'], [{ google_signin_state: 'st' }, 'code=good&state=st'], [started, 'code=spent&state=st']] as const) {
      jar(c as Record<string, string>)
      const res = await back(query)
      expect(to(res).searchParams.get('error'), query).toBe('google_failed')
      expect(setCookie(res, 'tt_id')).toBeUndefined()
    }
  })

  it('an existing email is refused with its own message (link Google only from Account)', async () => {
    jar(started)
    const res = await back('error=invalid_request&error_description=PreSignUp+failed+with+error+ACCOUNT_EXISTS.&state=st')
    expect(to(res).searchParams.get('error')).toBe('google_account_exists')
    expect(to(res).searchParams.get('next')).toBe('/paddles')
  })

  it('maps every Cognito error to a key the sign-in page has words for', () => {
    expect(errorKey('access_denied', null)).toBe('google_denied')
    expect(errorKey('invalid_request', 'PreSignUp failed with error NO_EMAIL.')).toBe('google_no_email')
    expect(errorKey('server_error', 'something')).toBe('google_failed')
  })
})

describe('erasure finds the account by sub', () => {
  // A Google account's username is "Google_<id>", not its email, so erasure
  // deletes by sub. Here: an email account, gone afterwards; twice is fine.
  it('deletes the user, and a second time is a no-op', async () => {
    vi.unstubAllGlobals()
    expect(await findUserByEmail(pat.email)).not.toBeNull()
    await deleteUserBySub(pat.id)
    expect(await findUserByEmail(pat.email)).toBeNull()
    await expect(deleteUserBySub(pat.id)).resolves.toBeUndefined()
  })
})
