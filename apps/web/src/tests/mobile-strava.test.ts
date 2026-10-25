// @vitest-environment node
// Strava for a signed-in account, from the apps (docs/features/mobile-apps.md,
// C5) and the website.
//
// Connecting from an app (lib/strava-app-connect.ts): the app asks with its
// Bearer token and a PKCE challenge, the callback saves nothing and sends a
// one-use code to the app's address, and the app collects it with the verifier.
// A link made by someone else must never connect a stranger's Strava to their
// account (security review, C5), and a Strava account connected to one person
// is never moved to another, on either path.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createHash, randomBytes } from 'crypto'
import type { z } from 'zod'
import { makeDataDir, cleanDataDir, makeUser, type TestUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
// Strava's own servers for the connect flow: never called from a test.
vi.mock('@/lib/strava', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/strava')>()),
  authorizeUrl: vi.fn(async (state: string) => `https://www.strava.com/oauth/authorize?state=${state}`),
  exchangeCode: vi.fn(),
  revoke: vi.fn(async () => {}),
}))

import { cookies } from 'next/headers'
import { createCaller } from '@paddlesnitch/api'
import { GET as connectLink, POST as connect } from '@/app/att/api/strava/connect/route'
import { GET as callback } from '@/app/att/api/strava/callback/route'
import { POST as appConnect } from '@/app/att/api/strava/app-connect/route'
import { POST as appFinish } from '@/app/att/api/strava/app-connect/finish/route'
import { GET as status } from '@/app/att/api/strava/status/route'
import { POST as autoImport } from '@/app/att/api/strava/auto-import/route'
import { POST as disconnect } from '@/app/att/api/strava/disconnect/route'
import { getStravaTokens, putStravaTokens, getUserIdByAthleteId, putAthleteIndex } from '@/lib/strava-storage'
import { authorizeUrl, exchangeCode, revoke } from '@/lib/strava'
import { APP_STRAVA_URL } from '@/lib/app-signin'
import { startAppConnect, takeAppConnectState, parkAppConnect, finishAppConnect } from '@/lib/strava-app-connect'
import { listKeys } from '@/lib/storage'
import { ApiError, Ok, WebPage, StravaStatus, StravaAutoImport, StravaHistory, StravaImport } from '@paddlesnitch/api/contract'

const ATHLETE = 12345678
const tokensFor = (athleteId = ATHLETE) => ({ athleteId, athleteName: 'Pat Paddler', accessToken: 'a', refreshToken: 'r', expiresAt: 4_000_000_000 })

let dataDir: string
let pat: TestUser
beforeEach(async () => {
  dataDir = await makeDataDir()
  jar({})
  vi.mocked(exchangeCode).mockReset().mockResolvedValue(tokensFor())
  pat = await makeUser('Pat')
})
afterEach(async () => { await cleanDataDir(dataDir); vi.mocked(revoke).mockClear(); vi.unstubAllGlobals() })

/** The browser's cookies for this request. */
function jar(c: Record<string, string>) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (c[name] ? { name, value: c[name] } : undefined),
    set: () => {}, delete: () => {},
  } as unknown as Awaited<ReturnType<typeof cookies>>)
}
const get = (url: string, token?: string) => new NextRequest(`http://localhost${url}`, {
  headers: token ? { authorization: `Bearer ${token}` } : {},
})
const post = (url: string, token?: string, body?: unknown) => new NextRequest(`http://localhost${url}`, {
  method: 'POST',
  body: body === undefined ? undefined : JSON.stringify(body),
  headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
})
async function fits(schema: z.ZodType, res: Response, statusCode = 200) {
  expect(res.status).toBe(statusCode)
  const body = await res.json()
  expect(schema.safeParse(body).error?.issues).toBeUndefined()
  return body
}
const location = (res: Response) => res.headers.get('location') ?? ''
const pkce = () => {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

/** The app asks for Strava's page; answers the state in it. */
async function start(u: TestUser, challenge: string): Promise<string> {
  const { url } = await fits(WebPage, await appConnect(post('/att/api/strava/app-connect', u.idToken, { challenge })))
  return new URL(url).searchParams.get('state')!
}
/** Strava sends the browser back to the callback (an in-app browser has no paddlesnitch cookies). */
const strava = (query: string) => { jar({}); return callback(get(`/att/api/strava/callback?${query}`)) }
const codeFrom = (res: Response) => {
  const url = location(res)
  expect(url.startsWith(`${APP_STRAVA_URL}?code=`), url).toBe(true)
  return new URL(url).searchParams.get('code')!
}

describe('connecting Strava from an app', () => {
  it('start, Strava, collect: saved only when the app collects, for the person who started it', async () => {
    const { verifier, challenge } = pkce()
    const state = await start(pat, challenge)
    const code = codeFrom(await strava(`code=c&state=${state}`))
    // Nothing on the account until the app collects.
    expect(await getStravaTokens(pat.id)).toBeNull()
    const done = await fits(StravaStatus, await appFinish(post('/att/api/strava/app-connect/finish', pat.idToken, { code, verifier })))
    expect(done).toEqual({ connected: true, athlete: { id: ATHLETE, name: 'Pat Paddler' }, autoImport: true })
    expect((await getStravaTokens(pat.id))?.athleteId).toBe(ATHLETE)
    expect(await getUserIdByAthleteId(ATHLETE)).toBe(pat.id)
    // The code works once.
    await fits(ApiError, await appFinish(post('/att/api/strava/app-connect/finish', pat.idToken, { code, verifier })), 400)
  })

  it('a link someone else made connects nothing: the stranger\'s app can\'t collect it', async () => {
    const mallory = await makeUser('Mallory')
    const { challenge } = pkce()
    // Mallory starts a connect and gets a stranger (Pat) to open the Strava page.
    const state = await start(mallory, challenge)
    const code = codeFrom(await strava(`code=c&state=${state}`))
    // The code lands on Pat's phone; Pat's app can't spend it (wrong person, wrong verifier).
    await fits(ApiError, await appFinish(post('/att/api/strava/app-connect/finish', pat.idToken, { code, verifier: pkce().verifier })), 400)
    expect(await getStravaTokens(mallory.id)).toBeNull()
    expect(await getStravaTokens(pat.id)).toBeNull()
    expect(await getUserIdByAthleteId(ATHLETE)).toBeNull()
  })

  it('even the right code and verifier connect nothing when another person sends them', async () => {
    const { verifier, challenge } = pkce()
    const code = codeFrom(await strava(`code=c&state=${await start(pat, challenge)}`))
    const sam = await makeUser('Sam')
    await fits(ApiError, await appFinish(post('/att/api/strava/app-connect/finish', sam.idToken, { code, verifier })), 400)
    expect(await getStravaTokens(sam.id)).toBeNull()
  })

  it('the right person with the wrong verifier, or a made-up code, gets nothing', async () => {
    const { challenge } = pkce()
    const code = codeFrom(await strava(`code=c&state=${await start(pat, challenge)}`))
    await fits(ApiError, await appFinish(post('/att/api/strava/app-connect/finish', pat.idToken, { code, verifier: pkce().verifier })), 400)
    await fits(ApiError, await appFinish(post('/att/api/strava/app-connect/finish', pat.idToken, { code: 'x'.repeat(43), verifier: 'y' })), 400)
    expect(await getStravaTokens(pat.id)).toBeNull()
  })

  it('every other ending goes back to the app with a key the apps have words for', async () => {
    const someone = await makeUser('Someone')
    await putAthleteIndex(99, someone.id)
    const cases: [string, () => void, string][] = [
      ['error=access_denied', () => {}, 'denied'],
      ['code=c', () => vi.mocked(exchangeCode).mockRejectedValueOnce(new Error('strava down')), 'exchange_failed'],
      ['code=c', () => vi.mocked(exchangeCode).mockResolvedValueOnce(tokensFor(99)), 'linked_elsewhere'],
    ]
    for (const [query, arrange, key] of cases) {
      arrange()
      const res = await strava(`${query}&state=${await start(pat, pkce().challenge)}`)
      expect(location(res), key).toBe(`${APP_STRAVA_URL}?strava=${key}`)
    }
    expect(await getStravaTokens(pat.id)).toBeNull()
    expect(await getUserIdByAthleteId(99)).toBe(someone.id)
    // Nothing was parked for a refused ending.
    expect(await listKeys('auth/app-codes/strava-connect/')).toEqual([])
  })

  it('a Strava account connected to someone else meanwhile is refused at collection too', async () => {
    const { verifier, challenge } = pkce()
    const code = codeFrom(await strava(`code=c&state=${await start(pat, challenge)}`))
    await putAthleteIndex(ATHLETE, (await makeUser('Other')).id)
    await fits(ApiError, await appFinish(post('/att/api/strava/app-connect/finish', pat.idToken, { code, verifier })), 409)
    expect(await getStravaTokens(pat.id)).toBeNull()
  })

  it('a state used once, or left on Strava\'s page past 10 minutes, goes back to the app (not the website\'s sign-in)', async () => {
    const state = await start(pat, pkce().challenge)
    codeFrom(await strava(`code=c&state=${state}`))
    expect(location(await strava(`code=c&state=${state}`))).toBe(`${APP_STRAVA_URL}?strava=state_mismatch`)
    const late = await startAppConnect(pat.id, pkce().challenge, Date.now() - 11 * 60_000)
    expect(location(await strava(`code=c&state=${late}`))).toBe(`${APP_STRAVA_URL}?strava=state_mismatch`)
    expect(await listKeys('auth/app-codes/strava-connect/')).toHaveLength(1)
  })

  it('the state and the code each expire, and a code is spent by a failed try', async () => {
    const { verifier, challenge } = pkce()
    expect(await takeAppConnectState(await startAppConnect(pat.id, challenge), Date.now() + 11 * 60_000)).toBeNull()
    const started = { userId: pat.id, challenge }
    const old = await parkAppConnect(started, tokensFor(), Date.now() - 6 * 60_000)
    expect(await finishAppConnect(old, verifier, pat.id)).toBeNull()
    // A wrong verifier spends the code, so verifiers can't be guessed.
    const code = await parkAppConnect(started, tokensFor())
    expect(await finishAppConnect(code, pkce().verifier, pat.id)).toBeNull()
    expect(await finishAppConnect(code, verifier, pat.id)).toBeNull()
    // And the right one works when it is the first try.
    expect(await finishAppConnect(await parkAppConnect(started, tokensFor()), verifier, pat.id)).toMatchObject({ athleteId: ATHLETE })
  })

  it('always asks Strava to show its consent screen', async () => {
    await start(pat, pkce().challenge)
    expect(vi.mocked(authorizeUrl).mock.lastCall?.[2]).toBe('force')
  })

  it('start and collect need a recent sign-in (a stolen app session must not link a Strava)', async () => {
    const { verifier, challenge } = pkce()
    const code = codeFrom(await strava(`code=c&state=${await start(pat, challenge)}`))
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + 11 * 60_000)
      const late = await appConnect(post('/att/api/strava/app-connect', pat.idToken, { challenge }))
      expect(late.status).toBe(403)
      expect(await late.json()).toMatchObject({ reauth: true })
      expect((await appFinish(post('/att/api/strava/app-connect/finish', pat.idToken, { code, verifier }))).status).toBe(403)
    } finally {
      vi.useRealTimers()
    }
    expect(await getStravaTokens(pat.id)).toBeNull()
  })

  it('start refuses no sign-in, a bad challenge, and says when Strava isn\'t set up', async () => {
    await fits(ApiError, await appConnect(post('/att/api/strava/app-connect', undefined, { challenge: pkce().challenge })), 401)
    await fits(ApiError, await appConnect(post('/att/api/strava/app-connect', pat.idToken, { challenge: 'short' })), 400)
    vi.mocked(authorizeUrl).mockResolvedValueOnce(null)
    await fits(ApiError, await appConnect(post('/att/api/strava/app-connect', pat.idToken, { challenge: pkce().challenge })), 503)
    await fits(ApiError, await appFinish(post('/att/api/strava/app-connect/finish', undefined, { code: 'c', verifier: 'v' })), 401)
  })

  it('keeps its records under auth/app-codes/, which a lifecycle rule empties daily', async () => {
    await start(pat, pkce().challenge)
    const keys = await listKeys('auth/')
    expect(keys.length).toBeGreaterThan(0)
    for (const k of keys) expect(k.startsWith('auth/app-codes/'), k).toBe(true)
  })
})

describe('connecting Strava on the website', () => {
  /** connect then callback in the same browser, signed in as `u`. */
  async function website(u: TestUser, query: (state: string) => string) {
    jar({ tt_id: u.idToken })
    const started = await connect(post('/att/api/strava/connect'))
    const state = new URL(location(started)).searchParams.get('state')!
    jar({ tt_id: u.idToken, strava_state: state })
    return callback(get(`/att/api/strava/callback?${query(state)}`))
  }
  const page = (res: Response) => { const u = new URL(location(res)); return u.pathname + u.search }

  it('connected, and the athlete points at this account', async () => {
    expect(page(await website(pat, s => `code=c&state=${s}`))).toBe('/account?strava=connected')
    expect(await getUserIdByAthleteId(ATHLETE)).toBe(pat.id)
  })

  it('each other ending lands on /account with its key, saving nothing', async () => {
    const someone = await makeUser('Someone')
    await putAthleteIndex(99, someone.id)
    expect(page(await website(pat, s => `error=access_denied&state=${s}`))).toBe('/account?strava=denied')
    expect(page(await website(pat, () => 'code=c&state=forged'))).toBe('/account?strava=state_mismatch')
    vi.mocked(exchangeCode).mockRejectedValueOnce(new Error('strava down'))
    expect(page(await website(pat, s => `code=c&state=${s}`))).toBe('/account?strava=exchange_failed')
    vi.mocked(exchangeCode).mockResolvedValueOnce(tokensFor(99))
    expect(page(await website(pat, s => `code=c&state=${s}`))).toBe('/account?strava=linked_elsewhere')
    expect(await getStravaTokens(pat.id)).toBeNull()
    expect(await getUserIdByAthleteId(99)).toBe(someone.id)
    vi.mocked(authorizeUrl).mockResolvedValueOnce(null)
    jar({ tt_id: pat.idToken })
    expect(page(await connect(post('/att/api/strava/connect')))).toBe('/account?strava=not_configured')
  })

  it('only a POST from our own page starts it: a link, a forwarded next or another site starts nothing', async () => {
    jar({ tt_id: pat.idToken })
    const link = await connectLink(get('/att/api/strava/connect'))
    expect(page(link)).toBe('/account')
    expect(link.headers.getSetCookie().some(c => c.startsWith('strava_state='))).toBe(false)
    const crossSite = await connect(new NextRequest('http://localhost/att/api/strava/connect', { method: 'POST', headers: { origin: 'https://evil.example' } }))
    expect(page(crossSite)).toBe('/account?strava=state_mismatch')
    expect(crossSite.headers.getSetCookie().some(c => c.startsWith('strava_state='))).toBe(false)
    const ours = await connect(new NextRequest('http://localhost/att/api/strava/connect', { method: 'POST', headers: { origin: 'http://localhost' } }))
    expect(ours.status).toBe(303)
    expect(location(ours)).toMatch(/^https:\/\/www\.strava\.com\//)
  })

  it('a browser a web-code link signed in refuses to connect Strava (connect it in the app)', async () => {
    jar({ tt_id: pat.idToken, tt_from_link: pat.id })
    const res = await connect(post('/att/api/strava/connect'))
    expect(page(res)).toBe('/account?strava=use_app')
    expect(res.headers.getSetCookie().some(c => c.startsWith('strava_state='))).toBe(false)
    // Someone who later signs in normally as another account in that browser can.
    const sam = await makeUser('Sam')
    jar({ tt_id: sam.idToken, tt_from_link: pat.id })
    expect(location(await connect(post('/att/api/strava/connect')))).toMatch(/^https:\/\/www\.strava\.com\//)
  })

  it('signed out, both ends send you to sign in and back to the account page', async () => {
    expect(page(await connect(post('/att/api/strava/connect')))).toBe('/signin?next=/account')
    jar({ strava_state: 'abc' })
    expect(page(await callback(get('/att/api/strava/callback?code=c&state=abc')))).toBe('/signin?next=/account')
  })
})

describe('which account an athlete belongs to', () => {
  it('switching to another Strava athlete drops the old athlete\'s link to this account', async () => {
    await putStravaTokens(pat.id, tokensFor(77))
    await putAthleteIndex(77, pat.id)
    const { verifier, challenge } = pkce()
    const code = codeFrom(await strava(`code=c&state=${await start(pat, challenge)}`))
    await fits(StravaStatus, await appFinish(post('/att/api/strava/app-connect/finish', pat.idToken, { code, verifier })))
    expect(await getUserIdByAthleteId(77)).toBeNull()
    expect(await getUserIdByAthleteId(ATHLETE)).toBe(pat.id)
  })

  it('an athlete link to another account always blocks, even one that may be stale (fails closed)', async () => {
    await putAthleteIndex(ATHLETE, 'sub-of-a-deleted-account')
    const { verifier, challenge } = pkce()
    expect(location(await strava(`code=c&state=${await start(pat, challenge)}`))).toBe(`${APP_STRAVA_URL}?strava=linked_elsewhere`)
    expect(await getUserIdByAthleteId(ATHLETE)).toBe('sub-of-a-deleted-account')
    void verifier
  })

  it('disconnect leaves an athlete link that points at another account alone', async () => {
    const other = await makeUser('Other')
    await putStravaTokens(pat.id, tokensFor())
    await putAthleteIndex(ATHLETE, other.id)
    await fits(Ok, await disconnect(post('/att/api/strava/disconnect', pat.idToken)))
    expect(await getUserIdByAthleteId(ATHLETE)).toBe(other.id)
  })
})

describe('Strava status, auto-import and disconnect with the Bearer token', () => {
  it('status: not connected, then connected with the athlete and auto-import', async () => {
    expect(await fits(StravaStatus, await status(get('/att/api/strava/status', pat.idToken)))).toEqual({ connected: false })
    await putStravaTokens(pat.id, tokensFor())
    expect(await fits(StravaStatus, await status(get('/att/api/strava/status', pat.idToken))))
      .toEqual({ connected: true, athlete: { id: ATHLETE, name: 'Pat Paddler' }, autoImport: true })
  })

  it('auto-import: set off, read back; a bad or missing body is an ApiError', async () => {
    await putStravaTokens(pat.id, tokensFor())
    expect(await fits(StravaAutoImport, await autoImport(post('/att/api/strava/auto-import', pat.idToken, { enabled: false })))).toEqual({ autoImport: false })
    expect((await (await status(get('/att/api/strava/status', pat.idToken))).json()).autoImport).toBe(false)
    await fits(ApiError, await autoImport(post('/att/api/strava/auto-import', pat.idToken, { enabled: 'no' })), 400)
    await fits(ApiError, await autoImport(post('/att/api/strava/auto-import', pat.idToken)), 400)
  })

  it('disconnect: revokes on Strava and forgets the tokens', async () => {
    await putStravaTokens(pat.id, tokensFor())
    await fits(Ok, await disconnect(post('/att/api/strava/disconnect', pat.idToken)))
    expect(revoke).toHaveBeenCalledWith('a')
    expect(await getStravaTokens(pat.id)).toBeNull()
  })

  it('an expired or junk Bearer token is a 401 everywhere, even beside a live cookie', async () => {
    await putStravaTokens(pat.id, tokensFor())
    jar({ tt_id: pat.idToken })
    await fits(ApiError, await status(get('/att/api/strava/status', 'not-a-jwt')), 401)
    await fits(ApiError, await disconnect(post('/att/api/strava/disconnect', 'not-a-jwt')), 401)
    await fits(ApiError, await autoImport(post('/att/api/strava/auto-import', 'not-a-jwt', { enabled: false })), 401)
    expect(await getStravaTokens(pat.id)).not.toBeNull()
  })

  it('the account page, signed in by cookie with no Bearer header: status, auto-import, disconnect', async () => {
    jar({ tt_id: pat.idToken })
    await putStravaTokens(pat.id, tokensFor())
    expect((await (await status(get('/att/api/strava/status'))).json())).toMatchObject({ connected: true })
    expect(await (await autoImport(post('/att/api/strava/auto-import', undefined, { enabled: false }))).json()).toEqual({ autoImport: false })
    expect((await disconnect(post('/att/api/strava/disconnect'))).status).toBe(200)
    expect(await getStravaTokens(pat.id)).toBeNull()
  })

  it('the website\'s badge still reads signed out as not connected', async () => {
    expect(await fits(StravaStatus, await status(get('/att/api/strava/status')))).toEqual({ connected: false })
    await fits(ApiError, await disconnect(post('/att/api/strava/disconnect')), 401)
  })
})

describe('older Strava paddles: real answers fit the contract', () => {
  const caller = () => createCaller({ user: { id: pat.id, email: pat.email, displayName: 'Pat' } })

  it('not connected: history says so, an import is skipped (no_tokens), done is ok', async () => {
    expect(await fits(StravaHistory, Response.json(await caller().sources.stravaHistory({ since: 'first' }))))
      .toEqual({ status: 'not_connected', firstImportDone: false })
    expect(await fits(StravaImport, Response.json(await caller().sources.importStravaPaddle({ id: 1, sport: 'Kayaking', startDate: '2026-07-04T06:30:00Z' }))))
      .toEqual({ status: 'skipped', reason: 'no_tokens' })
    await fits(Ok, Response.json(await caller().sources.stravaHistoryDone()))
    expect((await caller().sources.stravaHistory({ since: 'first' })).firstImportDone).toBe(true)
  })

  it('connected: the list (timestamps as Strava sends them) and an import fit too', async () => {
    await putStravaTokens(pat.id, { ...tokensFor(), expiresAt: Math.floor(Date.now() / 1000) + 3600 })
    const start = new Date(Date.now() - 3 * 86_400_000).toISOString().replace('.000', '')
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.includes('/athlete/activities')) {
        return Response.json(new URL(url).searchParams.get('page') === '1'
          ? [{ id: 12000000001, name: 'Morning paddle', sport_type: 'Kayaking', start_date: start, distance: 5000, moving_time: 1800 }]
          : [])
      }
      if (/activities\/\d+\/streams/.test(url)) {
        const pts: [number, number][] = Array.from({ length: 600 }, (_, i) => [51.46 + i * 0.00003, -0.93])
        return Response.json({ latlng: { data: pts }, time: { data: pts.map((_, i) => i * 3) } })
      }
      return new Response('not found', { status: 404 })
    }))
    const history = await fits(StravaHistory, Response.json(await caller().sources.stravaHistory({ since: 'first' })))
    expect(history).toMatchObject({ status: 'ok', alreadyIn: 0, toImport: [{ id: 12000000001, startDate: start }] })
    const imported = await fits(StravaImport, Response.json(await caller().sources.importStravaPaddle({ id: 12000000001, sport: 'Kayaking', startDate: start })))
    expect(imported).toMatchObject({ status: 'imported', sessionId: expect.any(String) })
    expect(await fits(StravaImport, Response.json(await caller().sources.importStravaPaddle({ id: 12000000001, sport: 'Kayaking', startDate: start }))))
      .toMatchObject({ status: 'duplicate', sessionId: imported.sessionId })
  })
})
