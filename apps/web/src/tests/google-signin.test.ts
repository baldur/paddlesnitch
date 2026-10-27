// @vitest-environment node
// Sign in with Google (#697). cognito-local has no hosted sign-in or Google,
// so Cognito's token endpoint is mocked here and answers with tokens that
// cognito-local itself issued; everything after the swap is real.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createHash } from 'crypto'
import { makeDataDir, cleanDataDir, makeUser, type TestUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@/lib/pending-invitations', () => ({ applyPendingInvitations: vi.fn(async () => {}) }))

import { cookies } from 'next/headers'
import { GET as init, POST as initPost } from '@/app/att/api/auth/google/init/route'
import { GET as callback } from '@/app/att/api/auth/google/callback/route'
import { POST as appToken } from '@/app/att/api/auth/google/app-token/route'
import { recordAcceptance } from '@/lib/tos'
import { CURRENT_TOS_VERSION } from '@/lib/types'
import { errorKey, emailVerified } from '@/lib/google-signin'
import { applyPendingInvitations } from '@/lib/pending-invitations'
import { readFileSync } from 'fs'
import path from 'path'
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider'
import { deleteUserBySub, findUserByEmail, signUp, customAuthSignIn } from '@/lib/cognito'

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
      if (body.get('code') === 'junk') return Response.json({ id_token: 'not.a.token', refresh_token: 'r', access_token: 'a' })
      return Response.json({ error: 'invalid_grant' }, { status: 400 })
    }
    return realFetch(url, initArg)
  }))
})
afterEach(async () => { await cleanDataDir(dir); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.mocked(applyPendingInvitations).mockClear() })

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
    for (const name of ['google_signin_state', 'google_signin_verifier', 'google_signin_next']) {
      const c = res.headers.getSetCookie().find(x => x.startsWith(`${name}=`))!
      // Lax, not Strict: the return trip from Cognito is a cross-site navigation.
      expect(c, name).toMatch(/HttpOnly/i)
      expect(c, name).toMatch(/SameSite=Lax/i)
      expect(c, name).toMatch(/Max-Age=600/)
      expect(c, name).toMatch(/Path=\//)
    }
  })

  it('never keeps a next that leaves the site', async () => {
    expect(setCookie(await init(get('/att/api/auth/google/init?next=%2F%2Fevil.example%2Fx')), 'google_signin_next')).toBe('%2F')
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
    // The same redirect_uri as init sent, and our client.
    expect(tokenCalls[0].get('redirect_uri')).toBe('http://localhost/att/api/auth/google/callback')
    expect(tokenCalls[0].get('client_id')).toBe(process.env.COGNITO_CLIENT_ID)
    for (const name of ['google_signin_state', 'google_signin_verifier', 'google_signin_next']) expect(setCookie(res, name), name).toBe('')
    // A verified email collects the invitations waiting for it.
    expect(applyPendingInvitations).toHaveBeenCalledWith(pat.email, pat.id)
  })

  it('a next that leaves the site goes home instead', async () => {
    await recordAcceptance(pat.id, CURRENT_TOS_VERSION)
    jar({ ...started, google_signin_next: 'https://evil.example/x' })
    const res = await back('code=good&state=st')
    expect(to(res).origin + to(res).pathname).toBe('http://localhost/')
  })

  it('a new account accepts the Terms first, signed in, then goes on', async () => {
    jar(started)
    const res = await back('code=good&state=st')
    expect(to(res).pathname).toBe('/terms/accept')
    expect(to(res).searchParams.get('next')).toBe('/paddles')
    expect(setCookie(res, 'tt_id')).toBe(pat.idToken)
  })

  it('refuses a forged state, a missing verifier and a code Cognito won\'t swap, signing nobody in', async () => {
    for (const [c, query] of [
      [started, 'code=good&state=forged'], [{ google_signin_state: 'st' }, 'code=good&state=st'], [started, 'code=spent&state=st'],
      [started, 'state=st'], [started, 'code=good'], [{ google_signin_verifier: 'ver' }, 'code=good&state=st'],
      [started, 'code=junk&state=st'],
    ] as const) {
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

  it('a cancel on Google\'s page comes back as google_denied', async () => {
    jar(started)
    expect(to(await back('error=access_denied&state=st')).searchParams.get('error')).toBe('google_denied')
  })

  it('maps every Cognito error to a key the sign-in page has words for', () => {
    const keys = [
      errorKey('access_denied', null), errorKey('invalid_request', 'PreSignUp failed with error NO_EMAIL.'),
      errorKey('invalid_request', 'PreSignUp failed with error EMAIL_UNVERIFIED.'), errorKey('invalid_request', 'PreSignUp failed with error ACCOUNT_EXISTS.'),
      errorKey('server_error', 'something'), 'google_not_configured',
    ]
    expect(keys.slice(0, 5)).toEqual(['google_denied', 'google_no_email', 'google_no_email', 'google_account_exists', 'google_failed'])
    const page = readFileSync(path.join(__dirname, '../app/signin/page.tsx'), 'utf8')
    for (const k of keys) expect(page, k).toContain(`e === '${k}'`)
  })

  it('reads email_verified from a verified token, and treats anything else as not verified', () => {
    const token = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`
    expect(emailVerified(token({ email_verified: true }))).toBe(true)
    expect(emailVerified(token({ email_verified: 'true' }))).toBe(true)
    expect(emailVerified(token({ email_verified: false }))).toBe(false)
    expect(emailVerified(token({}))).toBe(false)
    expect(emailVerified('junk')).toBe(false)
  })
})

describe('Sign in with Google from a phone app', () => {
  const appVerifier = 'v'.repeat(43)
  const appChallenge = createHash('sha256').update(appVerifier).digest('base64url')
  const back = (query: string) => callback(get(`/att/api/auth/google/callback?${query}`))
  const appStarted = { google_signin_state: 'st', google_signin_app: '1', google_signin_next: '/' }
  const post = (body: unknown) => appToken(new NextRequest('http://localhost/att/api/auth/google/app-token', { method: 'POST', body: JSON.stringify(body), headers: { 'x-paddlesnitch-app': 'ios/1.0' } }))

  // The tap (security review 2026-10-26): a link alone must not reach Google.
  const tap = (fields: Record<string, string>, nonceCookie?: string) => {
    const body = new URLSearchParams(fields)
    return initPost(new NextRequest('http://localhost/att/api/auth/google/init', {
      method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded', ...(nonceCookie ? { cookie: `google_signin_app_nonce=${nonceCookie}` } : {}) },
    }))
  }

  it('init shows the Continue page first, with a nonce in a Lax cookie, and doesn\'t go to Google', async () => {
    const res = await init(get(`/att/api/auth/google/init?challenge=${appChallenge}`))
    const page = to(res)
    expect(page.pathname).toBe('/signin/google-app')
    expect(page.searchParams.get('challenge')).toBe(appChallenge)
    const n = page.searchParams.get('n')!
    expect(n.length).toBeGreaterThan(20)
    const c = res.headers.getSetCookie().find(x => x.startsWith('google_signin_app_nonce='))!
    expect(c).toContain(`google_signin_app_nonce=${n}`)
    expect(c).toMatch(/HttpOnly/i)
    expect(c).toMatch(/SameSite=Lax/i)
    expect(setCookie(res, 'google_signin_state')).toBeUndefined()
  })

  it('the tap sends Cognito the app\'s own challenge and keeps no verifier', async () => {
    const res = await tap({ challenge: appChallenge, n: 'nonce-123' }, 'nonce-123')
    expect(res.status).toBe(303)
    expect(to(res).searchParams.get('code_challenge')).toBe(appChallenge)
    expect(setCookie(res, 'google_signin_verifier')).toBe('')
    expect(setCookie(res, 'google_signin_app')).toBe('1')
    expect(setCookie(res, 'google_signin_app_nonce')).toBe('')
  })

  it('a POST from another site (no cookie), a wrong nonce or a bad challenge goes back to the app with an error, never to Google', async () => {
    for (const [fields, cookie] of [
      [{ challenge: appChallenge, n: 'nonce-123' }, undefined],
      [{ challenge: appChallenge, n: 'nonce-123' }, 'other-nonce'],
      [{ challenge: appChallenge }, 'nonce-123'],
      [{ challenge: 'short', n: 'nonce-123' }, 'nonce-123'],
    ] as const) {
      const res = await tap(fields as Record<string, string>, cookie)
      expect(res.headers.get('location')).toBe('com.paddlesnitch.app:/signin/google?error=google_failed')
      expect(setCookie(res, 'google_signin_state')).toBeUndefined()
    }
  })

  it('init refuses a challenge that isn\'t one, and says "not available" to the app when there is no hosted sign-in', async () => {
    expect((await init(get('/att/api/auth/google/init?challenge=short'))).status).toBe(400)
    vi.stubEnv('COGNITO_DOMAIN', '')
    expect((await init(get(`/att/api/auth/google/init?challenge=${appChallenge}`))).headers.get('location'))
      .toBe('com.paddlesnitch.app:/signin/google?error=google_not_configured')
  })

  it('a website sign-in clears an app sign-in left over in the same browser', async () => {
    expect(setCookie(await init(get('/att/api/auth/google/init')), 'google_signin_app')).toBe('')
  })

  it('the callback hands Cognito\'s code to the app unswapped, signing nobody in here', async () => {
    jar(appStarted)
    const res = await back('code=good&state=st')
    expect(res.headers.get('location')).toBe('com.paddlesnitch.app:/signin/google?code=good')
    expect(tokenCalls).toHaveLength(0)
    expect(setCookie(res, 'tt_id')).toBeUndefined()
    expect(setCookie(res, 'google_signin_app')).toBe('')
  })

  it('the callback sends errors and a forged state to the app as keys', async () => {
    jar(appStarted)
    expect((await back('error=access_denied&state=st')).headers.get('location')).toBe('com.paddlesnitch.app:/signin/google?error=google_denied')
    jar(appStarted)
    expect((await back('code=good&state=forged')).headers.get('location')).toBe('com.paddlesnitch.app:/signin/google?error=google_failed')
    jar(appStarted)
    expect((await back('error=invalid_request&error_description=PreSignUp+failed+with+error+ACCOUNT_EXISTS.&state=st')).headers.get('location'))
      .toBe('com.paddlesnitch.app:/signin/google?error=google_account_exists')
  })

  it('app-token swaps the code with the app\'s verifier and answers as login, with the Terms check', async () => {
    const res = await post({ code: 'good', verifier: appVerifier })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ id: pat.id, email: pat.email, idToken: pat.idToken, refreshToken: pat.refreshToken, needsTerms: true })
    expect(tokenCalls[0].get('code_verifier')).toBe(appVerifier)
    expect(tokenCalls[0].get('redirect_uri')).toBe('http://localhost/att/api/auth/google/callback')
    expect(applyPendingInvitations).toHaveBeenCalledWith(pat.email, pat.id)
    await recordAcceptance(pat.id, CURRENT_TOS_VERSION)
    expect((await (await post({ code: 'good', verifier: appVerifier })).json()).needsTerms).toBe(false)
  })

  it('app-token: 401 for a code Cognito won\'t swap, 400 for a body without both', async () => {
    expect((await post({ code: 'spent', verifier: appVerifier })).status).toBe(401)
    expect((await post({ code: 'junk', verifier: appVerifier })).status).toBe(401)
    expect((await post({ code: 'good' })).status).toBe(400)
    expect((await post({ verifier: appVerifier })).status).toBe(400)
  })
})

describe('erasure finds the account by sub', () => {
  it('a Google account is deleted by its own username (Google_<id>), not its email', async () => {
    const sent: { name: string; input: Record<string, unknown> }[] = []
    vi.spyOn(CognitoIdentityProviderClient.prototype, 'send').mockImplementation((async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push({ name: cmd.constructor.name, input: cmd.input })
      return cmd.constructor.name === 'ListUsersCommand' ? { Users: [{ Username: 'Google_1234567890' }] } : {}
    }) as never)
    await deleteUserBySub('the-sub')
    expect(sent[0]).toMatchObject({ name: 'ListUsersCommand', input: { Filter: 'sub = "the-sub"' } })
    expect(sent[1]).toMatchObject({ name: 'AdminDeleteUserCommand', input: { Username: 'Google_1234567890' } })
  })

  it('already gone is done; any other error is thrown', async () => {
    const spy = vi.spyOn(CognitoIdentityProviderClient.prototype, 'send')
    spy.mockImplementation((async (cmd: { constructor: { name: string } }) => {
      if (cmd.constructor.name === 'ListUsersCommand') return { Users: [{ Username: 'Google_1' }] }
      throw Object.assign(new Error('gone'), { name: 'UserNotFoundException' })
    }) as never)
    await expect(deleteUserBySub('s')).resolves.toBeUndefined()
    spy.mockImplementation((async (cmd: { constructor: { name: string } }) => {
      if (cmd.constructor.name === 'ListUsersCommand') return { Users: [{ Username: 'Google_1' }] }
      throw Object.assign(new Error('nope'), { name: 'TooManyRequestsException' })
    }) as never)
    await expect(deleteUserBySub('s')).rejects.toThrow('nope')
  })

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

describe('the one-account-per-email refusal reaches the sign-up form as "email exists"', () => {
  it('PreSignUp\'s ACCOUNT_EXISTS is classified like an existing username', async () => {
    vi.spyOn(CognitoIdentityProviderClient.prototype, 'send').mockRejectedValueOnce(
      Object.assign(new Error('PreSignUp failed with error ACCOUNT_EXISTS.'), { name: 'UserLambdaValidationException' }) as never)
    expect(await signUp('someone@example.com', 'Someone', 'Password123')).toEqual({ error: 'email_exists' })
  })
})

describe('the server\'s own sign-in checks it got the account it meant', () => {
  it('tokens for another account are revoked and refused', async () => {
    const sam = await makeUser('Sam')
    const sent: string[] = []
    vi.spyOn(CognitoIdentityProviderClient.prototype, 'send').mockImplementation((async (cmd: { constructor: { name: string } }) => {
      sent.push(cmd.constructor.name)
      if (cmd.constructor.name === 'InitiateAuthCommand') return { Session: 's' }
      // Cognito answered with Sam's tokens although Pat was meant.
      if (cmd.constructor.name === 'RespondToAuthChallengeCommand') return { AuthenticationResult: { IdToken: sam.idToken, RefreshToken: sam.refreshToken } }
      return {}
    }) as never)
    expect(await customAuthSignIn(pat.email, 'preset', pat.id)).toEqual({ error: 'unknown' })
    expect(sent).toContain('RevokeTokenCommand')
  })
})

describe('an email two accounts share resolves to nobody', () => {
  it('findUserByEmail refuses to pick one, and ignores half-made accounts and unverified emails', async () => {
    const attrs = (sub: string, verified = 'true') => [{ Name: 'sub', Value: sub }, { Name: 'email', Value: 'v@example.com' }, { Name: 'email_verified', Value: verified }]
    const spy = vi.spyOn(CognitoIdentityProviderClient.prototype, 'send')
    spy.mockResolvedValueOnce({ Users: [{ Username: 'a', UserStatus: 'CONFIRMED', Attributes: attrs('a') }, { Username: 'Google_1', UserStatus: 'EXTERNAL_PROVIDER', Attributes: attrs('b') }] } as never)
    expect(await findUserByEmail('v@example.com')).toBeNull()
    spy.mockResolvedValueOnce({ Users: [{ Username: 'a', UserStatus: 'CONFIRMED', Attributes: attrs('a') }, { Username: 'x', UserStatus: 'UNCONFIRMED', Attributes: attrs('x') }] } as never)
    expect(await findUserByEmail('v@example.com')).toMatchObject({ sub: 'a' })
    // An address nobody proved doesn't count (#702).
    spy.mockResolvedValueOnce({ Users: [{ Username: 'a', UserStatus: 'CONFIRMED', Attributes: attrs('a', 'false') }] } as never)
    expect(await findUserByEmail('v@example.com')).toBeNull()
  })
})
