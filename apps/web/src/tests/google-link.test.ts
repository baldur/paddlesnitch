// @vitest-environment node
// Connect Google (lib/google-link.ts): from Account, a signed-in person with a
// recent sign-in leaves a note and goes to Google; the PreSignUp trigger links
// the login (tested in google-pre-sign-up.test.ts); the callback brings them
// back to Account and never signs them in as anyone else.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@/lib/auth', async (orig) => ({ ...(await orig<typeof import('@/lib/auth')>()), getAuthUser: vi.fn(), getRequestUser: vi.fn(), getRequestUserEvenIfErased: vi.fn() }))
vi.mock('@/lib/app-signin', async (orig) => ({ ...(await orig<typeof import('@/lib/app-signin')>()), hasRecentSignIn: vi.fn() }))
vi.mock('@/lib/cognito', async (orig) => ({
  ...(await orig<typeof import('@/lib/cognito')>()),
  findUserBySub: vi.fn(), verifyIdToken: vi.fn(), revoke: vi.fn(async () => {}), isNewGoogleAccount: vi.fn(), deleteUserBySub: vi.fn(async () => {}),
  disconnectGoogle: vi.fn(async () => {}), accessTokenFrom: vi.fn(async () => 'access'), sendEmailProofCode: vi.fn(async () => ({ ok: true })), confirmEmailProof: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/tos', async (orig) => ({ ...(await orig<typeof import('@/lib/tos')>()), hasAcceptedCurrent: vi.fn(async () => false) }))

import { cookies } from 'next/headers'
import { getAuthUser, getRequestUser, getRequestUserEvenIfErased } from '@/lib/auth'
import { hasRecentSignIn } from '@/lib/app-signin'
import * as cognito from '@/lib/cognito'
import { POST as link } from '@/app/att/api/auth/google/link/route'
import { GET as callback } from '@/app/att/api/auth/google/callback/route'
import { GET as status } from '@/app/api/account/google/route'
import { linkNoteKey } from '@/lib/google-link'
import { getJson } from '@/lib/storage'
import { isEmailProven, markEmailProven } from '@/lib/email-proven'
import { hasAcceptedCurrent } from '@/lib/tos'
import { leaveLinkNote } from '@/lib/google-link'
import { POST as unlink } from '@/app/att/api/auth/google/unlink/route'
import { POST as emailProof } from '@/app/api/account/email-proof/route'

const DOMAIN = 'https://paddlesnitch.auth.eu-west-1.amazoncognito.com'
const me = { id: 'sub-me', email: 'me@example.com', displayName: 'Me', emailVerified: true }
let dir: string
beforeEach(async () => {
  dir = await makeDataDir()
  vi.stubEnv('COGNITO_DOMAIN', DOMAIN)
  vi.mocked(getAuthUser).mockResolvedValue(me)
  vi.mocked(hasRecentSignIn).mockResolvedValue(true)
  vi.mocked(cognito.findUserBySub).mockResolvedValue({ sub: 'sub-me', email: 'me@example.com', displayName: 'Me' })
  await markEmailProven('sub-me', 'sign_up_code')
  jar({})
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
    if (String(url) === `${DOMAIN}/oauth2/token`) return Response.json({ id_token: 'id.tok.en', refresh_token: 'refresh', access_token: 'a' })
    throw new Error(`unexpected fetch ${url}`)
  }))
})
afterEach(async () => { await cleanDataDir(dir); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks() })

function jar(c: Record<string, string>) {
  vi.mocked(cookies).mockResolvedValue({ get: (n: string) => (c[n] ? { name: n, value: c[n] } : undefined) } as never)
}
const post = (headers: Record<string, string> = {}) => link(new NextRequest('http://localhost/att/api/auth/google/link', { method: 'POST', headers }))
const to = (res: Response) => new URL(res.headers.get('location')!)
const setCookie = (res: Response, name: string) =>
  res.headers.getSetCookie().find(c => c.startsWith(`${name}=`))?.split(';')[0].slice(name.length + 1)

describe('POST /att/api/auth/google/link', () => {
  it('leaves a 10-minute note naming this account and goes to Google as a connect trip', async () => {
    const res = await post()
    expect(res.status).toBe(303)
    expect(to(res).origin + to(res).pathname).toBe(`${DOMAIN}/oauth2/authorize`)
    expect(setCookie(res, 'google_signin_link')).toBe('1')
    expect(setCookie(res, 'google_signin_app')).toBe('')
    const note = await getJson<{ userId: string; expiresAt: number }>(linkNoteKey('me@example.com'))
    expect(note?.userId).toBe('sub-me')
    expect(note!.expiresAt - Date.now()).toBeGreaterThan(9 * 60_000)
  })

  it('needs a recent real sign-in, like connecting Strava', async () => {
    vi.mocked(hasRecentSignIn).mockResolvedValue(false)
    expect(to(await post()).search).toBe('?google=reauth')
    expect(await getJson(linkNoteKey('me@example.com'))).toBeNull()
  })

  it('refuses another site\'s form, a signed-out browser, and a browser an app link signed in', async () => {
    expect(to(await post({ origin: 'https://evil.example' })).search).toBe('?google=google_failed')
    jar({ tt_from_link: 'sub-me' })
    expect(to(await post()).search).toBe('?google=use_website')
    jar({})
    vi.mocked(getAuthUser).mockResolvedValue(null)
    expect(to(await post()).pathname).toBe('/signin')
    expect(await getJson(linkNoteKey('me@example.com'))).toBeNull()
  })

  it('an account that never proved its email (made before sign-up codes) can\'t connect: it could hold someone else\'s address', async () => {
    const { deleteObject } = await import('@/lib/storage')
    await deleteObject('users/sub-me/email-proven.json')
    expect(to(await post()).search).toBe('?google=email_unproved')
    expect(await getJson(linkNoteKey('me@example.com'))).toBeNull()
  })

  it('an email the account never proved, or an account that already has Google, leaves no note', async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ ...me, emailVerified: false })
    expect(to(await post()).search).toBe('?google=email_unproved')
    vi.mocked(getAuthUser).mockResolvedValue(me)
    vi.mocked(cognito.findUserBySub).mockResolvedValue({ sub: 'sub-me', email: 'me@example.com', displayName: 'Me', googleLinked: true })
    expect(to(await post()).search).toBe('?google=connected')
    expect(await getJson(linkNoteKey('me@example.com'))).toBeNull()
  })
})

describe('back from a connect trip', () => {
  const started = { google_signin_state: 'st', google_signin_verifier: 'ver', google_signin_next: '/account#google', google_signin_link: '1' }
  const back = (q: string) => callback(new NextRequest(`http://localhost/att/api/auth/google/callback?${q}`))

  it('LINKED from the trigger is "connected", back on Account, signed in as before', async () => {
    jar(started)
    await leaveLinkNote('me@example.com', 'sub-me')
    const res = await back('error=invalid_request&error_description=PreSignUp+failed+with+error+LINKED.&state=st')
    expect(to(res).pathname + to(res).search).toBe('/account?google=connected')
    expect(setCookie(res, 'tt_id')).toBeUndefined()
    expect(setCookie(res, 'google_signin_link')).toBe('')
    // The note was for this trip only.
    expect(await getJson(linkNoteKey('me@example.com'))).toBeNull()
  })

  it('a trip that didn\'t link (another Google account) spends the note too', async () => {
    jar(started)
    await leaveLinkNote('me@example.com', 'sub-me')
    vi.mocked(cognito.verifyIdToken).mockResolvedValue({ id: 'sub-new-google', email: 'other@gmail.com', displayName: 'O', emailVerified: true })
    vi.mocked(cognito.isNewGoogleAccount).mockResolvedValue(false)
    await back('code=c&state=st')
    expect(await getJson(linkNoteKey('me@example.com'))).toBeNull()
  })

  it('a Google account that got past the Terms is never deleted, however new', async () => {
    jar(started)
    vi.mocked(cognito.verifyIdToken).mockResolvedValue({ id: 'sub-new-google', email: 'other@gmail.com', displayName: 'O', emailVerified: true })
    vi.mocked(cognito.isNewGoogleAccount).mockResolvedValue(true)
    vi.mocked(hasAcceptedCurrent).mockResolvedValueOnce(true)
    await back('code=c&state=st')
    expect(cognito.deleteUserBySub).not.toHaveBeenCalled()
  })

  it('the trigger refusing (the note ran out) is link_failed; a cancel is google_denied', async () => {
    jar(started)
    expect(to(await back('error=invalid_request&error_description=PreSignUp+failed+with+error+ACCOUNT_EXISTS.&state=st')).search).toBe('?google=link_failed')
    jar(started)
    expect(to(await back('error=access_denied&state=st')).search).toBe('?google=google_denied')
  })

  it('a Google login with this email that has its own account is linked_elsewhere, never deleted', async () => {
    jar(started)
    vi.mocked(getAuthUser).mockResolvedValue(me)
    vi.mocked(cognito.verifyIdToken).mockResolvedValue({ id: 'sub-old-google', email: 'Me@Example.com', displayName: 'O', emailVerified: true })
    vi.mocked(cognito.isNewGoogleAccount).mockResolvedValue(false)
    const res = await back('code=c&state=st')
    expect(to(res).search).toBe('?google=linked_elsewhere')
    expect(setCookie(res, 'tt_id')).toBeUndefined()
  })

  it('a failing clean-up still goes back to Account, signed in as before', async () => {
    jar(started)
    vi.mocked(cognito.verifyIdToken).mockResolvedValue({ id: 'sub-new-google', email: 'other@gmail.com', displayName: 'O', emailVerified: true })
    vi.mocked(cognito.isNewGoogleAccount).mockRejectedValue(new Error('throttled'))
    vi.mocked(cognito.revoke).mockRejectedValueOnce(new Error('down'))
    const res = await back('code=c&state=st')
    expect(to(res).search).toBe('?google=different_email')
    expect(setCookie(res, 'tt_id')).toBeUndefined()
  })

  it('a link made on a plain Google sign-in (a connect left half-way) asks them to sign in with Google again', async () => {
    jar({ google_signin_state: 'st', google_signin_verifier: 'ver', google_signin_next: '/paddles' })
    const res = await back('error=invalid_request&error_description=PreSignUp+failed+with+error+LINKED.&state=st')
    expect(to(res).pathname).toBe('/signin')
    expect(to(res).searchParams.get('error')).toBe('google_linked')
  })

  it('a Google account with another email doesn\'t switch accounts, and the one Cognito just made goes', async () => {
    jar(started)
    vi.mocked(cognito.verifyIdToken).mockResolvedValue({ id: 'sub-new-google', email: 'other@gmail.com', displayName: 'O', emailVerified: true })
    vi.mocked(cognito.isNewGoogleAccount).mockResolvedValue(true)
    const res = await back('code=c&state=st')
    expect(to(res).search).toBe('?google=different_email')
    expect(setCookie(res, 'tt_id')).toBeUndefined()
    expect(cognito.revoke).toHaveBeenCalledWith('refresh')
    expect(cognito.deleteUserBySub).toHaveBeenCalledWith('sub-new-google')
  })

  it('an older Google account (its own paddlesnitch account) is never deleted', async () => {
    jar(started)
    vi.mocked(cognito.verifyIdToken).mockResolvedValue({ id: 'sub-old-google', email: 'other@gmail.com', displayName: 'O', emailVerified: true })
    vi.mocked(cognito.isNewGoogleAccount).mockResolvedValue(false)
    expect(to(await back('code=c&state=st')).search).toBe('?google=different_email')
    expect(cognito.deleteUserBySub).not.toHaveBeenCalled()
  })

  it('Google already signing in to this account is "connected"', async () => {
    jar(started)
    vi.mocked(cognito.verifyIdToken).mockResolvedValue(me)
    const res = await back('code=c&state=st')
    expect(to(res).search).toBe('?google=connected')
    expect(cognito.deleteUserBySub).not.toHaveBeenCalled()
  })
})

describe('GET /api/account/google', () => {
  it('says whether Google signs in to this account', async () => {
    const ask = async () => (await status(new Request('http://x'))).json()
    vi.mocked(getRequestUser).mockResolvedValue(me)
    expect(await ask()).toEqual({ signsInWithGoogle: false, connected: false, email: 'me@example.com', canConnect: true, emailProven: true, canDisconnect: false })
    vi.mocked(getRequestUser).mockResolvedValue({ ...me, emailVerified: false })
    expect((await ask()).canConnect).toBe(false)
    vi.mocked(getRequestUser).mockResolvedValue({ ...me, email: 'strava-123@noreply.paddlesnitch.com' })
    expect((await ask()).canConnect).toBe(false)
    vi.mocked(getRequestUser).mockResolvedValue(me)
    vi.mocked(cognito.findUserBySub).mockResolvedValue({ sub: 'sub-me', email: 'me@example.com', displayName: 'Me', googleLinked: true })
    expect(await ask()).toMatchObject({ signsInWithGoogle: false, connected: true, canConnect: false, canDisconnect: true })
    vi.mocked(cognito.findUserBySub).mockResolvedValue({ sub: 'sub-me', email: 'me@example.com', displayName: 'Me', google: true })
    expect(await ask()).toMatchObject({ signsInWithGoogle: true, connected: true, canConnect: false, canDisconnect: false })
    vi.mocked(getRequestUser).mockResolvedValue(null)
    expect((await status(new Request('http://x'))).status).toBe(401)
  })
})

describe('what Account knows', () => {
  it('reads a connected Google login from Cognito\'s identities attribute', async () => {
    const real = await vi.importActual<typeof import('@/lib/cognito')>('@/lib/cognito')
    const { CognitoIdentityProviderClient } = await import('@aws-sdk/client-cognito-identity-provider')
    const users = (u: object) => vi.spyOn(CognitoIdentityProviderClient.prototype, 'send').mockImplementation((async () => ({ Users: [u] })) as never)
    const attrs = (extra: object[] = []) => [{ Name: 'sub', Value: 's' }, { Name: 'email', Value: 'me@example.com' }, ...extra]
    users({ Username: 'u-1', Attributes: attrs([{ Name: 'identities', Value: '[{"userId":"1098","providerName":"Google","providerType":"Google"}]' }]) })
    expect(await real.findUserBySub('s')).toMatchObject({ googleLinked: true, googleId: '1098' })
    vi.restoreAllMocks()
    users({ Username: 'u-1', Attributes: attrs() })
    expect((await real.findUserBySub('s'))?.googleLinked).toBeUndefined()
    vi.restoreAllMocks()
    users({ Username: 'Google_1098', Attributes: attrs([{ Name: 'identities', Value: '[{"providerName":"Google"}]' }]) })
    expect(await real.findUserBySub('s')).toMatchObject({ google: true })
    expect((await real.findUserBySub('s'))?.googleLinked).toBeUndefined()
    vi.restoreAllMocks()
  })

  it('every result the routes send has words on Account', async () => {
    const { readFileSync } = await import('fs')
    const path = await import('path')
    const src = (f: string) => readFileSync(path.join(__dirname, '..', f), 'utf8')
    const ui = src('components/GoogleConnect.tsx')
    const sent = new Set<string>()
    for (const f of ['app/att/api/auth/google/link/route.ts', 'app/att/api/auth/google/callback/route.ts', 'lib/google-signin.ts']) {
      for (const m of src(f).matchAll(/google=([a-z_]+)|go\('([a-z_]+)'\)|toAccount\('([a-z_]+)'\)|'(google_[a-z_]+)'/g)) sent.add(m[1] ?? m[2] ?? m[3] ?? m[4])
    }
    for (const k of [...sent]) if (k.startsWith('google_signin')) sent.delete(k) // cookie names
    sent.delete('google_linked') // turned into "connected"
    sent.delete('google_account_exists') // turned into "link_failed"
    for (const k of sent) expect(ui, k).toMatch(k === 'reauth' ? /key === 'reauth'/ : new RegExp(`\\b${k}: \\(`))
  })
})

describe('Disconnect', () => {
  const un = (headers: Record<string, string> = {}) => unlink(new NextRequest('http://localhost/att/api/auth/google/unlink', { method: 'POST', headers }))
  it('disconnects the connected Google login and says so', async () => {
    vi.mocked(cognito.findUserBySub).mockResolvedValue({ sub: 'sub-me', email: 'me@example.com', displayName: 'Me', googleLinked: true, googleId: '1098' })
    expect(to(await un()).search).toBe('?google=disconnected')
    expect(cognito.disconnectGoogle).toHaveBeenCalledWith('1098')
  })
  it('never for another site\'s form, nothing to do without a connected login, and a failure says so', async () => {
    expect(to(await un({ origin: 'https://evil.example' })).search).toBe('?google=google_failed')
    expect(to(await un()).search).toBe('?google=disconnected')
    expect(cognito.disconnectGoogle).not.toHaveBeenCalled()
    vi.mocked(cognito.findUserBySub).mockResolvedValue({ sub: 'sub-me', email: 'me@example.com', displayName: 'Me', googleLinked: true, googleId: '1098' })
    vi.mocked(cognito.disconnectGoogle).mockRejectedValueOnce(new Error('throttled'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(to(await un()).search).toBe('?google=disconnect_failed')
  })
})

describe('proving the email from Account', () => {
  const ask = (body: object) => emailProof(new NextRequest('http://localhost/api/account/email-proof', { method: 'POST', body: JSON.stringify(body) }))
  beforeEach(async () => {
    const { deleteObject } = await import('@/lib/storage')
    await deleteObject('users/sub-me/email-proven.json')
    jar({ tt_refresh: 'refresh-me' })
  })
  it('sends a code, then a right code marks the email proven', async () => {
    expect((await ask({})).status).toBe(200)
    expect(cognito.sendEmailProofCode).toHaveBeenCalledWith('access')
    expect(cognito.accessTokenFrom).toHaveBeenCalledWith('refresh-me')
    expect(await isEmailProven('sub-me')).toBe(false)
    expect((await ask({ code: '123456' })).status).toBe(200)
    expect(cognito.confirmEmailProof).toHaveBeenCalledWith('access', '123456')
    expect(await isEmailProven('sub-me')).toBe(true)
  })
  it('a wrong or expired code, or not six digits, proves nothing', async () => {
    vi.mocked(cognito.confirmEmailProof).mockResolvedValueOnce({ error: 'invalid_code' })
    expect((await ask({ code: '000000' })).status).toBe(400)
    vi.mocked(cognito.confirmEmailProof).mockResolvedValueOnce({ error: 'expired_code' })
    expect((await (await ask({ code: '000000' })).json()).error).toMatch(/expired/)
    expect((await ask({ code: '12ab' })).status).toBe(400)
    expect(await isEmailProven('sub-me')).toBe(false)
  })
  it('needs a signed-in browser with its refresh token', async () => {
    jar({})
    expect((await ask({})).status).toBe(401)
    vi.mocked(getAuthUser).mockResolvedValue(null)
    jar({ tt_refresh: 'refresh-me' })
    expect((await ask({})).status).toBe(401)
  })
})

describe('the export and the other ways out', () => {
  it('the export says Google is connected', async () => {
    const { buildAccountExport } = await import('@/lib/account-export')
    vi.mocked(cognito.findUserBySub).mockResolvedValue({ sub: 'sub-me', email: 'me@example.com', displayName: 'Me', googleLinked: true, googleId: '1098' })
    expect((await buildAccountExport(me)).user).toMatchObject({ googleConnected: true })
  })
  it('a password reset disconnects a connected Google login', async () => {
    const { afterPasswordReset } = await import('@/lib/password-reset')
    vi.spyOn(cognito, 'findUserByEmail').mockResolvedValue({ sub: 'sub-me', email: 'me@example.com', displayName: 'Me', googleLinked: true, googleId: '1098' })
    vi.spyOn(cognito, 'signOutEverywhere').mockResolvedValue(undefined as never)
    await afterPasswordReset('me@example.com')
    expect(cognito.disconnectGoogle).toHaveBeenCalledWith('1098')
  })
})

describe('isNewGoogleAccount: the only accounts the callback may delete', () => {
  it('a Google account made in the window; never an older one, an email account or a missing one', async () => {
    const real = await vi.importActual<typeof import('@/lib/cognito')>('@/lib/cognito')
    const { CognitoIdentityProviderClient } = await import('@aws-sdk/client-cognito-identity-provider')
    const now = Date.parse('2026-10-27T10:00:00Z')
    const filters: string[] = []
    const answer = (users: object[]) => vi.spyOn(CognitoIdentityProviderClient.prototype, 'send').mockImplementation((async (cmd: { input: { Filter: string } }) => { filters.push(cmd.input.Filter); return { Users: users } }) as never)
    const ago = (ms: number) => new Date(now - ms)
    const cases: [object[], boolean][] = [
      [[{ Username: 'Google_1', UserCreateDate: ago(60_000) }], true],
      [[{ Username: 'Google_1', UserCreateDate: ago(3 * 60_000) }], false],
      [[{ Username: 'u-1', UserCreateDate: ago(1000) }], false],
      [[], false],
      [[{ Username: 'Google_1' }], false],
    ]
    for (const [users, want] of cases) {
      answer(users)
      expect(await real.isNewGoogleAccount('s', 2 * 60_000, now), JSON.stringify(users)).toBe(want)
      vi.restoreAllMocks()
    }
    answer([])
    await real.isNewGoogleAccount('a"b', 1000, now)
    expect(filters.at(-1)).toBe('sub = "a\\"b"')
    vi.restoreAllMocks()
  })
})

describe('deleting the account', () => {
  it('disconnects a connected Google login before the account goes, and removes a leftover note', async () => {
    const { DELETE } = await import('@/app/api/account/route')
    vi.mocked(getRequestUserEvenIfErased).mockResolvedValue(me)
    vi.mocked(cognito.findUserBySub).mockResolvedValue({ sub: 'sub-me', email: 'me@example.com', displayName: 'Me', googleLinked: true, googleId: '1098' })
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined, delete: vi.fn(), set: vi.fn() } as never)
    await leaveLinkNote('me@example.com', 'sub-me')
    await leaveLinkNote('other@example.com', 'sub-other')
    const res = await DELETE(new Request('http://x', { method: 'DELETE', body: '{}' }))
    expect(res.status).toBe(200)
    expect(cognito.disconnectGoogle).toHaveBeenCalledWith('1098')
    expect(vi.mocked(cognito.disconnectGoogle).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(cognito.deleteUserBySub).mock.invocationCallOrder[0])
    expect(await getJson(linkNoteKey('me@example.com'))).toBeNull()
    expect(await getJson(linkNoteKey('other@example.com'))).not.toBeNull()
  })
})
