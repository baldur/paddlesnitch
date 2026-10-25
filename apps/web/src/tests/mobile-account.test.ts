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

import { cookies } from 'next/headers'
import { CURRENT_TOS_VERSION } from '@/lib/types'
import { refresh } from '@/lib/cognito'
import { GET as tosStatus, POST as acceptTos } from '@/app/api/account/tos/route'
import { POST as exportLink } from '@/app/api/account/export/route'
import { DELETE as deleteAccount } from '@/app/api/account/route'
import { GET as getProfile, PATCH as setProfile } from '@/app/api/account/profile/route'
import { GET as checkHandle, PUT as claimHandle, DELETE as releaseHandle } from '@/app/api/account/handle/route'
import { GET as getContact, POST as setContact, DELETE as clearContact } from '@/app/api/account/contact/route'
import {
  restRoutes, ApiError, Ok, TosStatus, TosAccepted, DownloadLink, ProfileSettings, HandleAvailability, Contact,
} from '@paddlesnitch/api/contract'

let dataDir: string
let pat: TestUser
beforeEach(async () => {
  dataDir = await makeDataDir()
  // No cookie at all: only the Bearer header can sign anyone in.
  vi.mocked(cookies).mockResolvedValue({
    get: () => undefined, set: () => {}, delete: () => {},
  } as unknown as Awaited<ReturnType<typeof cookies>>)
  pat = await makeUser('Pat')
})
afterEach(async () => { await cleanDataDir(dataDir); vi.restoreAllMocks() })

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
    const tested = new Set([...calls().map(([r]) => r), 'DELETE /api/account'])
    for (const route of Object.keys(restRoutes).filter(r => r.includes('/api/account'))) expect(tested.has(route as never), route).toBe(true)
  })

  it('refuse a caller with no sign-in (401, an ApiError)', async () => {
    for (const [route, call] of [...calls(), ['DELETE /api/account', () => deleteAccount(req('DELETE', '/api/account'))] as Call]) {
      const res = await call()
      expect(res.status, route).toBe(401)
      expect(ApiError.safeParse(await res.json()).success, route).toBe(true)
    }
  })

  it('refuse a Bearer header that is not an ID token', async () => {
    for (const [route, call] of calls()) expect((await call('not-a-jwt')).status, route).toBe(401)
  })

  it('let the person in with only the Bearer token, and answer what the contract says', async () => {
    const schemaOf: Record<string, z.ZodType> = {
      'GET /api/account/tos': TosStatus, 'POST /api/account/tos': TosAccepted,
      'POST /api/account/export': DownloadLink,
      'GET /api/account/profile': ProfileSettings, 'PATCH /api/account/profile': ProfileSettings,
      'GET /api/account/handle': HandleAvailability, 'PUT /api/account/handle': ProfileSettings, 'DELETE /api/account/handle': ProfileSettings,
      'GET /api/account/contact': Contact, 'POST /api/account/contact': Contact, 'DELETE /api/account/contact': Ok,
    }
    for (const [route, call] of calls()) {
      const res = await call(pat.idToken)
      expect(res.status, route).toBe(200)
      expect(schemaOf[route].safeParse(await res.json()).error?.issues, route).toBeUndefined()
    }
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

  it('delete account: erases it and revokes the refresh token the app sends', async () => {
    await fits(Ok, await deleteAccount(req('DELETE', '/api/account', pat.idToken, { refreshToken: pat.refreshToken })))
    expect('error' in (await refresh(pat.refreshToken))).toBe(true)
  })
})
