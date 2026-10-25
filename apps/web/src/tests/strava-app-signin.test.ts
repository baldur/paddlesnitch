// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createHash, randomBytes } from 'crypto'
import { makeDataDir, cleanDataDir } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@/lib/strava', () => ({ exchangeCode: vi.fn(), getAthleteProfile: vi.fn(), authorizeUrl: vi.fn(async () => 'https://www.strava.com/oauth/authorize?x=1') }))
vi.mock('@/lib/strava-storage', () => ({ putStravaTokens: vi.fn(), getUserIdByAthleteId: vi.fn(), putAthleteIndex: vi.fn() }))
vi.mock('@/lib/cognito', () => ({
  findUserByEmail: vi.fn(),
  findUserBySub: vi.fn(),
  adminCreateUserForStrava: vi.fn(),
  customAuthSignIn: vi.fn(),
  verifyIdToken: vi.fn(),
  sessionOfFreshToken: vi.fn(() => 'link-session-1'),
}))
vi.mock('@/lib/auth', async (orig) => ({ ...(await orig<typeof import('@/lib/auth')>()), getAuthUser: vi.fn(), getRequestUser: vi.fn(), bearerUser: vi.fn(), setAuthCookies: vi.fn() }))

import { GET as init } from '@/app/att/api/auth/strava/init/route'
import { GET as callback } from '@/app/att/api/auth/strava/callback/route'
import { POST as appToken } from '@/app/att/api/auth/strava/app-token/route'
import { GET as webCode, POST as mintWebCode } from '@/app/att/api/auth/web-code/route'
import { createAppCode, createWebCode, redeemAppCode, redeemWebCode } from '@/lib/app-signin'
import { listKeys } from '@/lib/storage'
import { cookies } from 'next/headers'
import * as strava from '@/lib/strava'
import * as stravaStorage from '@/lib/strava-storage'
import * as cognito from '@/lib/cognito'
import * as auth from '@/lib/auth'

const verifier = randomBytes(32).toString('base64url')
const challenge = createHash('sha256').update(verifier).digest('base64url')

function mockCookies(jar: Record<string, string>) {
  vi.mocked(cookies).mockResolvedValue({ get: (name: string) => name in jar ? { name, value: jar[name] } : undefined } as unknown as Awaited<ReturnType<typeof cookies>>)
}

let dataDir: string
beforeEach(async () => {
  vi.clearAllMocks()
  dataDir = await makeDataDir()
  vi.mocked(strava.exchangeCode).mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresAt: 0, athleteId: 555 } as never)
  vi.mocked(strava.getAthleteProfile).mockResolvedValue({ id: 555, firstname: 'Bal', lastname: 'G' } as never)
  vi.mocked(stravaStorage.getUserIdByAthleteId).mockResolvedValue('sub-1')
  vi.mocked(cognito.findUserBySub).mockResolvedValue({ sub: 'sub-1', email: 'baldur@example.com', displayName: 'Baldur' } as never)
  vi.mocked(cognito.customAuthSignIn).mockResolvedValue({ idToken: 'id-token', refreshToken: 'refresh-token' } as never)
  vi.mocked(cognito.verifyIdToken).mockResolvedValue({ id: 'sub-1', email: 'baldur@example.com', displayName: 'Baldur' } as never)
})
afterEach(async () => { await cleanDataDir(dataDir) })

describe('one-time app codes', () => {
  it('give the account once, to the holder of the verifier', async () => {
    const code = await createAppCode('baldur@example.com', 'sub-1', challenge)
    expect(await redeemAppCode(code, verifier)).toEqual({ email: 'baldur@example.com', userId: 'sub-1' })
    expect(await redeemAppCode(code, verifier)).toBeNull()
  })

  it('are spent by a wrong verifier, so a stolen code can’t be retried', async () => {
    const code = await createAppCode('baldur@example.com', 'sub-1', challenge)
    expect(await redeemAppCode(code, randomBytes(32).toString('base64url'))).toBeNull()
    expect(await redeemAppCode(code, verifier)).toBeNull()
  })

  it('expire after five minutes', async () => {
    const code = await createAppCode('baldur@example.com', 'sub-1', challenge, 0)
    expect(await redeemAppCode(code, verifier, 5 * 60_000 + 1)).toBeNull()
  })
})

describe('GET /att/api/auth/strava/init from an app', () => {
  it('keeps the challenge for the callback and goes to Strava even with a website session in the browser', async () => {
    vi.mocked(auth.getAuthUser).mockResolvedValue({ id: 'web-user', email: 'w@example.com', displayName: 'W' })
    const res = await init(new NextRequest(`http://x/att/api/auth/strava/init?challenge=${challenge}`))
    expect(res.headers.get('location')).toContain('strava.com')
    expect(res.cookies.get('strava_signin_app')?.value).toBe(challenge)
  })

  it('refuses a malformed challenge', async () => {
    const res = await init(new NextRequest('http://x/att/api/auth/strava/init?challenge=short'))
    expect(res.status).toBe(400)
  })

  it('clears a stale app challenge when the website signs in', async () => {
    vi.mocked(auth.getAuthUser).mockResolvedValue(null)
    const res = await init(new NextRequest('http://x/att/api/auth/strava/init'))
    expect(res.cookies.get('strava_signin_app')?.value).toBe('')
  })
})

describe('Strava callback for an app', () => {
  const req = () => new NextRequest('http://x/att/api/auth/strava/callback?code=c&state=s1')

  it('sends a one-time code to the app’s scheme, with no tokens or cookies', async () => {
    mockCookies({ strava_signin_state: 's1', strava_signin_app: challenge })
    const res = await callback(req())
    const loc = new URL(res.headers.get('location')!)
    expect(`${loc.protocol}${loc.pathname}`).toBe('com.paddlesnitch.app:/signin/strava')
    expect(loc.searchParams.get('code')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(res.headers.get('location')).not.toContain('token')
    expect(cognito.customAuthSignIn).not.toHaveBeenCalled()
    expect(auth.setAuthCookies).not.toHaveBeenCalled()
    expect(stravaStorage.putStravaTokens).toHaveBeenCalledWith('sub-1', expect.anything())
    expect(await redeemAppCode(loc.searchParams.get('code')!, verifier)).toEqual({ email: 'baldur@example.com', userId: 'sub-1' })
  })

  it('sends a failure to the app too', async () => {
    mockCookies({ strava_signin_state: 's1', strava_signin_app: challenge })
    const res = await callback(new NextRequest('http://x/att/api/auth/strava/callback?error=access_denied'))
    expect(res.headers.get('location')).toBe('com.paddlesnitch.app:/signin/strava?error=strava_denied')
  })

  it('still signs the website in with cookies', async () => {
    mockCookies({ strava_signin_state: 's1' })
    const res = await callback(req())
    expect(new URL(res.headers.get('location')!).protocol).toBe('http:')
    expect(auth.setAuthCookies).toHaveBeenCalled()
  })
})

describe('POST /att/api/auth/strava/app-token', () => {
  const post = (body: unknown) => new NextRequest('http://x/att/api/auth/strava/app-token', {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'x-paddlesnitch-app': 'android/0.1.0' },
  })

  it('swaps code + verifier for tokens', async () => {
    const code = await createAppCode('baldur@example.com', 'sub-1', challenge)
    const res = await appToken(post({ code, verifier }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: 'sub-1', idToken: 'id-token', refreshToken: 'refresh-token', needsTerms: true })
    expect(cognito.customAuthSignIn).toHaveBeenCalledWith('baldur@example.com', expect.any(String))
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('answers 401 to a spent or wrong code', async () => {
    const code = await createAppCode('baldur@example.com', 'sub-1', challenge)
    await appToken(post({ code, verifier }))
    expect((await appToken(post({ code, verifier }))).status).toBe(401)
  })

  it('answers 400 without a code', async () => {
    expect((await appToken(post({}))).status).toBe(400)
  })
})

describe('website pages from a signed-in app (web codes)', () => {
  const open = (code: string, next = '/account') => webCode(new NextRequest(`http://x/att/api/auth/web-code?code=${code}&next=${encodeURIComponent(next)}`))

  it('gives the Bearer token’s person a link to the page with a code for them', async () => {
    vi.mocked(auth.bearerUser).mockResolvedValue({ id: 'sub-1', email: 'baldur@example.com', displayName: 'Baldur' })
    const res = await mintWebCode(new NextRequest('http://x/att/api/auth/web-code', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ next: '/account#delete' }) }))
    const url = new URL((await res.json()).url)
    expect(url.pathname).toBe('/att/api/auth/web-code')
    expect(url.searchParams.get('next')).toBe('/account#delete')
    expect(await redeemWebCode(url.searchParams.get('code')!)).toEqual({ email: 'baldur@example.com', userId: 'sub-1' })
  })

  it('refuses to mint one without a signed-in person', async () => {
    vi.mocked(auth.bearerUser).mockResolvedValue(null)
    expect((await mintWebCode(new NextRequest('http://x/att/api/auth/web-code', { method: 'POST' }))).status).toBe(401)
  })

  it('signs the website in and goes on to the page, once', async () => {
    const code = await createWebCode('baldur@example.com', 'sub-1')
    const res = await open(code)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/account')
    expect(auth.setAuthCookies).toHaveBeenCalledWith(expect.anything(), 'id-token', 'refresh-token')
    // The session it made is recorded: it never counts as a recent sign-in.
    expect(await listKeys('users/sub-1/link-sessions/')).toHaveLength(1)
    const again = new URL((await open(code)).headers.get('location')!)
    expect(again.pathname).toBe('/signin')
    expect(again.searchParams.get('error')).toBe('app_link_expired')
    expect(again.searchParams.get('next')).toBe('/account')
  })

  it('lasts a minute', async () => {
    const code = await createWebCode('baldur@example.com', 'sub-1', Date.now() - 61_000)
    expect(new URL((await open(code)).headers.get('location')!).pathname).toBe('/signin')
  })

  it('never sends anyone off the site', async () => {
    const code = await createWebCode('baldur@example.com', 'sub-1')
    expect(new URL((await open(code, '//evil.example/x')).headers.get('location')!).host).toBe('x')
  })
})
