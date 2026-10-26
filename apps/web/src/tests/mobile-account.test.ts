// @vitest-environment node
// The Account screens in the apps (docs/features/mobile-apps.md, phase C5) call
// the website's /api/account routes with `Authorization: Bearer <ID token>` and
// no cookie. Each must let that person in, answer what mobile/contract says,
// and refuse a caller with no sign-in.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { z } from 'zod'
import { makeDataDir, cleanDataDir, makeUser, type TestUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
// Watch which refresh token erasure revokes (deleting the Cognito user alone
// already stops a refresh in cognito-local, so that can't show it).
vi.mock('@/lib/cognito', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/cognito')>()
  return { ...real, revoke: vi.fn(real.revoke) }
})

import { cookies } from 'next/headers'
import { CURRENT_TOS_VERSION } from '@/lib/types'
import { revoke } from '@/lib/cognito'
import { GET as tosStatus, POST as acceptTos } from '@/app/api/account/tos/route'
import { GET as exportFile, POST as exportLink } from '@/app/api/account/export/route'
import { GET as accountStatus, DELETE as deleteAccount } from '@/app/api/account/route'
import { markLinkSession, hasRecentSignIn } from '@/lib/app-signin'
import { POST as mintWebCode } from '@/app/att/api/auth/web-code/route'
import { signInFromClaims, sessionOfFreshToken, idTokenSignIn } from '@paddlesnitch/core/cognito'
import { setProfilePublic as storeProfilePublic, getProfileSettings } from '@/lib/profile'
import { GET as getProfile, PATCH as setProfile } from '@/app/api/account/profile/route'
import { GET as checkHandle, PUT as claimHandle, DELETE as releaseHandle } from '@/app/api/account/handle/route'
import { GET as getContact, POST as setContact, DELETE as clearContact } from '@/app/api/account/contact/route'
import { GET as listTrackers, DELETE as removeTracker } from '@/app/api/account/devices/route'
import { GET as listRecordings } from '@/app/api/account/devices/sessions/route'
import { POST as link } from '@/app/api/account/devices/link/route'
import { POST as claim } from '@/app/api/devices/claim/route'
import { POST as token } from '@/app/api/devices/token/route'
import { POST as upload } from '@/app/api/devices/sessions/route'
import type { deviceList } from '@/lib/device-list'
import type { DeviceSessionMeta } from '@/lib/devices'
import { provedPoll } from './device-proof'
import {
  restRoutes, ApiError, Ok, TosStatus, TosAccepted, DownloadLink, ProfileSettings, HandleAvailability, Contact, AccountStatus,
  TrackerList, RecordingList,
} from '@paddlesnitch/api/contract'

let dataDir: string
let pat: TestUser
beforeEach(async () => {
  dataDir = await makeDataDir()
  // No cookie at all: only the Bearer header can sign anyone in.
  jar({})
  pat = await makeUser('Pat')
})
afterEach(async () => { await cleanDataDir(dataDir); vi.mocked(revoke).mockClear() })

/** The website's cookies for this request. */
function jar(c: { tt_id?: string; tt_refresh?: string }) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (c[name as keyof typeof c] ? { name, value: c[name as keyof typeof c] } : undefined),
    set: () => {}, delete: () => {},
  } as unknown as Awaited<ReturnType<typeof cookies>>)
}

const req = (method: string, url: string, token?: string, body?: unknown) => new NextRequest(`http://x${url}`, {
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
  headers: {
    'x-paddlesnitch-app': 'android/0.1.0',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
  },
})
async function fits(schema: z.ZodType, res: Response, status = 200) {
  expect(res.status).toBe(status)
  const body = await res.json()
  expect(schema.safeParse(body).error?.issues).toBeUndefined()
  return body
}

type Call = [route: keyof typeof restRoutes, call: (token?: string) => Promise<Response>]
const calls = (): Call[] => [
  ['GET /api/account/tos', t => tosStatus(req('GET', '/api/account/tos', t))],
  ['POST /api/account/tos', t => acceptTos(req('POST', '/api/account/tos', t, { version: CURRENT_TOS_VERSION }))],
  ['POST /api/account/export', t => exportLink(req('POST', '/api/account/export', t))],
  ['GET /api/account/profile', t => getProfile(req('GET', '/api/account/profile', t))],
  ['PATCH /api/account/profile', t => setProfile(req('PATCH', '/api/account/profile', t, { public: true }))],
  ['GET /api/account/handle', t => checkHandle(req('GET', '/api/account/handle?check=pat-paddles', t))],
  ['PUT /api/account/handle', t => claimHandle(req('PUT', '/api/account/handle', t, { handle: 'pat-paddles' }))],
  ['DELETE /api/account/handle', t => releaseHandle(req('DELETE', '/api/account/handle', t))],
  ['GET /api/account/contact', t => getContact(req('GET', '/api/account/contact', t))],
  ['POST /api/account/contact', t => setContact(req('POST', '/api/account/contact', t, { email: 'pat@example.com' }))],
  ['DELETE /api/account/contact', t => clearContact(req('DELETE', '/api/account/contact', t))],
]

describe('the account routes the apps call', () => {
  it('every account route in rest.json is tested here', () => {
    const tested = new Set([...calls().map(([r]) => r), ...trackerRoutes, 'DELETE /api/account', 'GET /api/account'])
    for (const route of Object.keys(restRoutes).filter(r => r.includes('/api/account'))) expect(tested.has(route as never), route).toBe(true)
  })

  it('refuse a caller with no sign-in (401, an ApiError)', async () => {
    for (const [route, call] of [...calls(),
      ['DELETE /api/account', () => deleteAccount(req('DELETE', '/api/account'))] as Call,
      ['GET /api/account', () => accountStatus(req('GET', '/api/account'))] as Call]) {
      const res = await call()
      expect(res.status, route).toBe(401)
      expect(ApiError.safeParse(await res.json()).success, route).toBe(true)
    }
  })

  it('refuse a Bearer header that is not an ID token, even beside a live website cookie', async () => {
    jar({ tt_id: pat.idToken })
    for (const [route, call] of calls()) expect((await call('not-a-jwt')).status, route).toBe(401)
    // Above all, a junk or tracker token must never erase an account.
    for (const token of ['not-a-jwt', 'c2VjcmV0LWRldmljZS10b2tlbi0zMi1ieXRlcw']) {
      expect((await deleteAccount(req('DELETE', '/api/account', token))).status).toBe(401)
    }
    expect((await getProfile(req('GET', '/api/account/profile', pat.idToken))).status).toBe(200)
  })

  it('let the person in with only the Bearer token, and answer what the contract says', async () => {
    const schemaOf: Record<string, z.ZodType> = {
      'GET /api/account/tos': TosStatus, 'POST /api/account/tos': TosAccepted,
      'POST /api/account/export': DownloadLink,
      'GET /api/account/profile': ProfileSettings, 'PATCH /api/account/profile': ProfileSettings,
      'GET /api/account/handle': HandleAvailability, 'PUT /api/account/handle': ProfileSettings, 'DELETE /api/account/handle': ProfileSettings,
      'GET /api/account/contact': Contact, 'POST /api/account/contact': Contact, 'DELETE /api/account/contact': Ok,
    }
    // The values too: the schemas drop unknown keys and most fields are
    // optional, so a renamed field would still parse.
    const expected: Record<string, object> = {
      'GET /api/account/tos': { currentVersion: CURRENT_TOS_VERSION, accepted: false },
      'POST /api/account/tos': { acceptances: [{ version: CURRENT_TOS_VERSION }] },
      'POST /api/account/export': { url: expect.any(String) },
      'GET /api/account/profile': { public: false },
      'PATCH /api/account/profile': { public: true },
      'GET /api/account/handle': { available: true, slug: 'pat-paddles' },
      'PUT /api/account/handle': { public: true, handle: 'pat-paddles' },
      'DELETE /api/account/handle': { public: true },
      'GET /api/account/contact': { contact: null, placeholderEmail: false },
      'POST /api/account/contact': { contact: { email: 'pat@example.com', addedAt: expect.any(String) } },
      'DELETE /api/account/contact': { ok: true },
    }
    for (const [route, call] of calls()) {
      const res = await call(pat.idToken)
      expect(res.status, route).toBe(200)
      const body = await res.json()
      expect(schemaOf[route].safeParse(body).error?.issues, route).toBeUndefined()
      expect(body, route).toMatchObject(expected[route])
    }
  })

  it('the export link in local dev is the file itself, which the Bearer token also opens', async () => {
    const res = await exportFile(req('GET', '/api/account/export', pat.idToken))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename=/)
    expect((await exportFile(req('GET', '/api/account/export'))).status).toBe(401)
  })
})

describe('what the Account screens do', () => {
  it('Terms: shows not accepted, accepts the current version, then accepted', async () => {
    const before = await fits(TosStatus, await tosStatus(req('GET', '/api/account/tos', pat.idToken)))
    expect(before.currentVersion).toBe(CURRENT_TOS_VERSION)
    await fits(TosAccepted, await acceptTos(req('POST', '/api/account/tos', pat.idToken, { version: CURRENT_TOS_VERSION })))
    expect((await fits(TosStatus, await tosStatus(req('GET', '/api/account/tos', pat.idToken)))).accepted).toBe(true)
    // An out-of-date app can't accept an old version.
    await fits(ApiError, await acceptTos(req('POST', '/api/account/tos', pat.idToken, { version: 'v0' })), 422)
  })

  it('details: a handle that is taken or not allowed says why, and a bad email is refused', async () => {
    const sam = await makeUser('Sam')
    await claimHandle(req('PUT', '/api/account/handle', sam.idToken, { handle: 'river-sam' }))
    const taken = await fits(HandleAvailability, await checkHandle(req('GET', '/api/account/handle?check=river-sam', pat.idToken)))
    expect(taken).toMatchObject({ available: false, reason: expect.any(String) })
    await fits(ApiError, await claimHandle(req('PUT', '/api/account/handle', pat.idToken, { handle: 'river-sam' })), 400)
    await fits(ApiError, await setContact(req('POST', '/api/account/contact', pat.idToken, { email: 'nope' })), 400)
    await fits(ApiError, await setProfile(req('PATCH', '/api/account/profile', pat.idToken, { public: 'yes' })), 400)
  })

  it('contact: says when the sign-in email is a Strava placeholder, so the apps offer a contact email', async () => {
    const strava = await makeUser('Strava Person', { email: `strava-${Date.now()}${Math.floor(Math.random() * 1e6)}@noreply.paddlesnitch.com` })
    expect(await (await getContact(req('GET', '/api/account/contact', strava.idToken))).json()).toMatchObject({ placeholderEmail: true })
    expect(await (await getContact(req('GET', '/api/account/contact', pat.idToken))).json()).toMatchObject({ placeholderEmail: false })
  })

  it('delete account: erases it and revokes the refresh token the app sends', async () => {
    await fits(Ok, await deleteAccount(req('DELETE', '/api/account', pat.idToken, { refreshToken: pat.refreshToken })))
    expect(revoke).toHaveBeenCalledWith(pat.refreshToken)
  })

  it('delete account needs a real sign-in from the last 10 minutes: older is 403 reauth on both paths, and nothing is erased', async () => {
    await storeProfilePublic(pat.id, true)
    const minutesLater = async (m: number, run: () => Promise<void>) => {
      vi.useFakeTimers({ toFake: ['Date'] })
      try { vi.setSystemTime(Date.now() + m * 60_000); await run() } finally { vi.useRealTimers() }
    }
    await minutesLater(11, async () => {
      const app = await deleteAccount(req('DELETE', '/api/account', pat.idToken, { refreshToken: pat.refreshToken }))
      expect(app.status).toBe(403)
      expect(await app.json()).toMatchObject({ error: expect.any(String), reauth: true })
      jar({ tt_id: pat.idToken, tt_refresh: pat.refreshToken })
      const site = await deleteAccount(req('DELETE', '/api/account'))
      expect(site.status).toBe(403)
      expect(await site.json()).toMatchObject({ reauth: true })
      jar({})
      expect(await (await accountStatus(req('GET', '/api/account', pat.idToken))).json()).toEqual({ recentSignIn: false })
    })
    // Nothing was erased or revoked.
    expect((await getProfileSettings(pat.id)).public).toBe(true)
    expect(revoke).not.toHaveBeenCalled()
    // Nine minutes on is still within the window.
    await minutesLater(9, async () => {
      expect(await (await accountStatus(req('GET', '/api/account', pat.idToken))).json()).toEqual({ recentSignIn: true })
      await fits(Ok, await deleteAccount(req('DELETE', '/api/account', pat.idToken)))
    })
  })

  it('only an app\'s Bearer token can mint a web-code link, never the website cookie', async () => {
    jar({ tt_id: pat.idToken })
    expect((await mintWebCode(req('POST', '/att/api/auth/web-code', undefined, { next: '/account' }))).status).toBe(401)
    jar({})
    const ok = await mintWebCode(req('POST', '/att/api/auth/web-code', pat.idToken, { next: '/account' }))
    expect(ok.status).toBe(200)
  })

  it('a session a web-code link made never counts as a recent sign-in', async () => {
    const claims = JSON.parse(Buffer.from(pat.idToken.split('.')[1], 'base64url').toString())
    await markLinkSession(pat.id, claims.origin_jti ?? claims.jti)
    expect(await (await accountStatus(req('GET', '/api/account', pat.idToken))).json()).toEqual({ recentSignIn: false })
    expect((await deleteAccount(req('DELETE', '/api/account', pat.idToken))).status).toBe(403)
  })

  it('the session a fresh token names is the one the verified token names (what web-code marks)', async () => {
    expect(sessionOfFreshToken(pat.idToken)).toBe((await idTokenSignIn(pat.idToken))?.session)
    expect(sessionOfFreshToken(pat.idToken)).toEqual(expect.any(String))
    expect(sessionOfFreshToken('not-a-token')).toBeNull()
  })

  it('a recent sign-in counts only for its own person', async () => {
    const sam = await makeUser('Sam')
    expect(await hasRecentSignIn(req('GET', '/api/account', sam.idToken), pat.id)).toBe(false)
    expect(await hasRecentSignIn(req('GET', '/api/account', pat.idToken), pat.id)).toBe(true)
    await fits(AccountStatus, await accountStatus(req('GET', '/api/account', pat.idToken)))
  })

  it('the sign-in time is auth_time, never iat; a token without one, or not an ID token, is no sign-in', () => {
    expect(signInFromClaims({ token_use: 'id', sub: 's', auth_time: 100, iat: 999, jti: 'j' })).toEqual({ sub: 's', signedInAt: 100, session: 'j' })
    expect(signInFromClaims({ token_use: 'id', sub: 's', iat: 999, jti: 'j' })?.signedInAt).toBeNull()
    expect(signInFromClaims({ token_use: 'access', sub: 's', auth_time: 100 })).toBeNull()
    // origin_jti (the same across refreshes) wins over jti.
    expect(signInFromClaims({ token_use: 'id', sub: 's', auth_time: 1, jti: 'j', origin_jti: 'o' })?.session).toBe('o')
  })


  it('delete account twice (the first answer was lost) succeeds both times', async () => {
    await fits(Ok, await deleteAccount(req('DELETE', '/api/account', pat.idToken)))
    await fits(Ok, await deleteAccount(req('DELETE', '/api/account', pat.idToken)))
  })

  it('delete account from the website revokes the cookie\'s refresh token, never one in the body', async () => {
    jar({ tt_id: pat.idToken, tt_refresh: pat.refreshToken })
    await fits(Ok, await deleteAccount(req('DELETE', '/api/account', undefined, { refreshToken: 'someone-elses' })))
    expect(revoke).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith(pat.refreshToken)
  })
})

// ---- Trackers ----

// The tracker list and recordings answer what the website's code builds; these
// fail `pnpm typecheck` if the contract and that code stop matching anywhere,
// nested fields included. `Norm` makes optional and `| undefined` alike (the
// list spreads its optional fields in as `undefined`).
type Norm<T> = T extends object ? { [K in keyof T]-?: Norm<Exclude<T[K], undefined>> } : T
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
const check = <T extends true>() => undefined as unknown as T
check<Same<Norm<z.infer<typeof TrackerList>>, Norm<Awaited<ReturnType<typeof deviceList>>>>>()
// The stored metadata, less the owner's own id (unnamed fields are allowed).
check<Same<Norm<z.infer<typeof RecordingList>['sessions'][number]>, Norm<Omit<DeviceSessionMeta, 'userId'>>>>()

const trackerRoutes = ['GET /api/account/devices', 'DELETE /api/account/devices', 'GET /api/account/devices/sessions']
const DEVICE = 'C0FFEE01'
const CSV = [
  'timestamp,lat,lon,tx_seq,battery',
  '2026-09-05T09:00:00Z,51.4600,-0.9300,1,4.05',
  '2026-09-05T09:00:01Z,51.4601,-0.9301,2,4.05',
  '2026-09-05T09:00:02Z,51.4602,-0.9302,3,4.04',
].join('\n')

const tokenOf = new Map<string, string>()
/** Pairs a tracker as the real one does (the app adds it with its Bearer token), then it uploads one recording. */
async function trackerWithRecording(owner: TestUser) {
  const post = (url: string, body: unknown, bearer?: string) => new NextRequest(`http://x${url}`, {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
  })
  const { claimCode, claimSecret } = await (await claim(post('/api/devices/claim', { deviceId: DEVICE, model: 'tbeam', firmware: '0.19.3' }))).json()
  expect((await link(post('/api/account/devices/link', { claimCode }, owner.idToken))).status).toBe(200)
  const { deviceToken } = await (await token(post('/api/devices/token', await provedPoll(DEVICE, claimSecret)))).json()
  tokenOf.set(DEVICE, deviceToken)
  const res = await upload(new Request('http://x/api/devices/sessions?filename=track_0001.csv', {
    method: 'POST', body: CSV, headers: { authorization: `Bearer ${deviceToken}`, 'content-type': 'text/csv' },
  }))
  expect(res.status).toBe(201)
}

describe('trackers in the apps', () => {
  it('list the trackers and their recordings with only the Bearer token, as the contract says', async () => {
    await trackerWithRecording(pat)
    const list = await fits(TrackerList, await listTrackers(req('GET', '/api/account/devices', pat.idToken)))
    expect(list.devices).toMatchObject([{ deviceId: DEVICE, firmware: '0.19.3' }])
    expect(list.devices[0]).not.toHaveProperty('tokenHash')
    // The card, worked out by the server: the apps show it as it comes.
    expect(list.summaries).toMatchObject([{ deviceId: DEVICE, linked: true, recordings: 1, motionRecordings: 0, quiet: false }])
    expect(['up_to_date', 'update_pending', 'unknown']).toContain(list.summaries[0].firmwareState)
    const recs = await fits(RecordingList, await listRecordings(req('GET', '/api/account/devices/sessions', pat.idToken)))
    expect(recs.sessions).toMatchObject([{ deviceId: DEVICE, filename: 'track_0001.csv', points: 3 }])
  })

  it('recordings come newest upload first (not newest paddle)', async () => {
    await trackerWithRecording(pat)
    // An older paddle, synced later, comes first.
    const older = CSV.replaceAll('2026-09-05', '2026-08-01')
    expect((await upload(new Request('http://x/api/devices/sessions?filename=track_0000.csv', {
      method: 'POST', body: older, headers: { authorization: `Bearer ${tokenOf.get(DEVICE)}`, 'content-type': 'text/csv' },
    }))).status).toBe(201)
    const { sessions } = await (await listRecordings(req('GET', '/api/account/devices/sessions', pat.idToken))).json()
    expect(sessions.map((r: { filename: string }) => r.filename)).toEqual(['track_0000.csv', 'track_0001.csv'])
  })

  it('remove a tracker: gone from the list, its recordings stay; someone else\'s is 404', async () => {
    await trackerWithRecording(pat)
    const sam = await makeUser('Sam')
    await fits(ApiError, await removeTracker(req('DELETE', '/api/account/devices', sam.idToken, { deviceId: DEVICE })), 404)
    await fits(Ok, await removeTracker(req('DELETE', '/api/account/devices', pat.idToken, { deviceId: DEVICE })))
    const after = await (await listTrackers(req('GET', '/api/account/devices', pat.idToken))).json()
    expect(after.devices).toEqual([])
    // Its card stays, as a removed tracker with its recording.
    expect(after.summaries).toMatchObject([{ deviceId: DEVICE, linked: false, recordings: 1, quiet: false, firmwareState: 'unknown' }])
    expect((await (await listRecordings(req('GET', '/api/account/devices/sessions', pat.idToken))).json()).sessions).toHaveLength(1)
  })

  it('refuse no sign-in, and a bad Bearer token beside a live cookie', async () => {
    const tracker = [
      (t?: string) => listTrackers(req('GET', '/api/account/devices', t)),
      (t?: string) => removeTracker(req('DELETE', '/api/account/devices', t, { deviceId: DEVICE })),
      (t?: string) => listRecordings(req('GET', '/api/account/devices/sessions', t)),
    ]
    for (const call of tracker) await fits(ApiError, await call(), 401)
    jar({ tt_id: pat.idToken })
    for (const call of tracker) expect((await call('not-a-jwt')).status).toBe(401)
  })
})
