// @vitest-environment node
// Connect Google (lib/google-link.ts): from Account, a signed-in person with a
// recent sign-in leaves a note and goes to Google; the PreSignUp trigger links
// the login (tested in google-pre-sign-up.test.ts); the callback brings them
// back to Account and never signs them in as anyone else.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@/lib/auth', async (orig) => ({ ...(await orig<typeof import('@/lib/auth')>()), getAuthUser: vi.fn(), getRequestUser: vi.fn() }))
vi.mock('@/lib/app-signin', async (orig) => ({ ...(await orig<typeof import('@/lib/app-signin')>()), hasRecentSignIn: vi.fn() }))
vi.mock('@/lib/cognito', async (orig) => ({
  ...(await orig<typeof import('@/lib/cognito')>()),
  findUserBySub: vi.fn(), verifyIdToken: vi.fn(), revoke: vi.fn(async () => {}), isNewGoogleAccount: vi.fn(), deleteUserBySub: vi.fn(async () => {}),
}))

import { cookies } from 'next/headers'
import { getAuthUser, getRequestUser } from '@/lib/auth'
import { hasRecentSignIn } from '@/lib/app-signin'
import * as cognito from '@/lib/cognito'
import { POST as link } from '@/app/att/api/auth/google/link/route'
import { GET as callback } from '@/app/att/api/auth/google/callback/route'
import { GET as status } from '@/app/api/account/google/route'
import { linkNoteKey } from '@/lib/google-link'
import { getJson } from '@/lib/storage'

const DOMAIN = 'https://paddlesnitch.auth.eu-west-1.amazoncognito.com'
const me = { id: 'sub-me', email: 'me@example.com', displayName: 'Me', emailVerified: true }
let dir: string
beforeEach(async () => {
  dir = await makeDataDir()
  vi.stubEnv('COGNITO_DOMAIN', DOMAIN)
  vi.mocked(getAuthUser).mockResolvedValue(me)
  vi.mocked(hasRecentSignIn).mockResolvedValue(true)
  vi.mocked(cognito.findUserBySub).mockResolvedValue({ sub: 'sub-me', email: 'me@example.com', displayName: 'Me' })
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

  it('an email the account never proved, or an account that already has Google, leaves no note', async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ ...me, emailVerified: false })
    expect(to(await post()).search).toBe('?google=google_failed')
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
    const res = await back('error=invalid_request&error_description=PreSignUp+failed+with+error+LINKED.&state=st')
    expect(to(res).pathname + to(res).search).toBe('/account?google=connected')
    expect(setCookie(res, 'tt_id')).toBeUndefined()
    expect(setCookie(res, 'google_signin_link')).toBe('')
  })

  it('the trigger refusing (the note ran out) is link_failed; a cancel is google_denied', async () => {
    jar(started)
    expect(to(await back('error=invalid_request&error_description=PreSignUp+failed+with+error+ACCOUNT_EXISTS.&state=st')).search).toBe('?google=link_failed')
    jar(started)
    expect(to(await back('error=access_denied&state=st')).search).toBe('?google=google_denied')
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
    expect(await ask()).toEqual({ signsInWithGoogle: false, connected: false })
    vi.mocked(cognito.findUserBySub).mockResolvedValue({ sub: 'sub-me', email: 'me@example.com', displayName: 'Me', googleLinked: true })
    expect(await ask()).toEqual({ signsInWithGoogle: false, connected: true })
    vi.mocked(cognito.findUserBySub).mockResolvedValue({ sub: 'sub-me', email: 'me@example.com', displayName: 'Me', google: true })
    expect(await ask()).toEqual({ signsInWithGoogle: true, connected: true })
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
    expect(await real.findUserBySub('s')).toMatchObject({ googleLinked: true })
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
    for (const k of sent) expect(ui, k).toMatch(k === 'reauth' ? /key === 'reauth'/ : new RegExp(`\\b${k}: \\{`))
  })
})
