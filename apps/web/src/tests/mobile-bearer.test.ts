// @vitest-environment node
// The mobile apps sign REST calls with `Authorization: Bearer <Cognito ID
// token>` and no cookie (docs/features/mobile-apps.md, phase C2). Each route the
// apps call must treat that exactly like the website's tt_id cookie, and a
// Bearer header that isn't an ID token must never sign anyone in.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir, makeUser, makeCourse, makeTrial, type TestUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { cookies } from 'next/headers'
import { getRequestUser } from '@/lib/auth'
import { GET as listTrials } from '@/app/att/api/trials/route'
import { GET as getTrial } from '@/app/att/api/trials/[trialId]/route'
import { GET as leaderboard } from '@/app/att/api/trials/[trialId]/leaderboard/route'
import { GET as canSubmit } from '@/app/att/api/trials/[trialId]/can-submit/route'
import { POST as upload } from '@/app/att/api/trials/[trialId]/upload/route'
import { GET as listDevices, DELETE as removeDevice } from '@/app/api/account/devices/route'
import { POST as relay, GET as staged } from '@/app/api/account/devices/[deviceId]/sessions/route'
import { GET as deviceSessions } from '@/app/api/account/devices/sessions/route'
import { GET as deviceSession } from '@/app/api/account/devices/sessions/[sessionId]/route'
import { POST as link } from '@/app/api/account/devices/link/route'
import { POST as linkBluetooth } from '@/app/api/account/devices/link-bluetooth/route'
import { POST as analyse } from '@/app/paddles/api/analyse/route'

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir); vi.restoreAllMocks() })

/** The website's cookie jar, holding `idToken` as tt_id (or empty). */
function cookie(idToken: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name === 'tt_id' && idToken ? { name, value: idToken } : undefined),
    set: () => {}, delete: () => {},
  } as unknown as Awaited<ReturnType<typeof cookies>>)
}
const req = (url: string, init: { method?: string; token?: string; body?: BodyInit; type?: string } = {}) =>
  new NextRequest(`http://x${url}`, {
    method: init.method ?? 'GET',
    body: init.body,
    headers: {
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...(init.type ? { 'content-type': init.type } : {}),
    },
  })
const params = <T extends object>(p: T) => ({ params: Promise.resolve(p) })

describe('getRequestUser', () => {
  let pat: TestUser
  beforeEach(async () => { pat = await makeUser('Pat') })

  it('signs in from a Bearer ID token with no cookie', async () => {
    cookie(null)
    expect((await getRequestUser(req('/', { token: pat.idToken })))?.id).toBe(pat.id)
  })

  it('still signs in the website from its cookie', async () => {
    cookie(pat.idToken)
    expect((await getRequestUser(req('/')))?.id).toBe(pat.id)
  })

  it('never falls back to the cookie when the Bearer token is bad', async () => {
    cookie(pat.idToken)
    expect(await getRequestUser(req('/', { token: 'not-a-jwt' }))).toBeNull()
  })

  it('never signs a person in with a tracker\'s device token', async () => {
    cookie(null)
    expect(await getRequestUser(req('/', { token: 'c2VjcmV0LWRldmljZS10b2tlbi0zMi1ieXRlcw' }))).toBeNull()
  })
})

// Each route: signed out it refuses (401, or 404 where it hides a private
// trial), and with only the app's Bearer token it lets the user in.
describe('routes the apps call accept the Bearer token', () => {
  let pat: TestUser
  beforeEach(async () => { pat = await makeUser('Pat'); cookie(null) })

  async function privateTrial() {
    const course = await makeCourse(pat.id, { visibility: 'private' })
    return makeTrial(course.id, pat.id, 'open', { visibility: 'private' })
  }

  it('GET /att/api/trials lists the user\'s private trial', async () => {
    const trial = await privateTrial()
    const ids = async (token?: string) => ((await (await listTrials(req('/att/api/trials', { token }))).json()) as { id: string }[]).map(t => t.id)
    expect(await ids()).not.toContain(trial.id)
    expect(await ids(pat.idToken)).toContain(trial.id)
  })

  it('GET /att/api/trials/[id], its leaderboard and can-submit show the private trial', async () => {
    const trial = await privateTrial()
    const p = params({ trialId: trial.id })
    // Signed out: the trial and leaderboard hide it (404); can-submit asks to sign in (401).
    for (const [name, route, url, signedOut] of [
      ['trial', getTrial, `/att/api/trials/${trial.id}`, 404],
      ['leaderboard', leaderboard, `/att/api/trials/${trial.id}/leaderboard`, 404],
      ['can-submit', canSubmit, `/att/api/trials/${trial.id}/can-submit`, 401],
    ] as const) {
      expect((await route(req(url), p)).status, name).toBe(signedOut)
      expect((await route(req(url, { token: pat.idToken }), p)).status, name).toBe(200)
    }
  })

  it('POST /att/api/trials/[id]/upload gets past sign-in', async () => {
    const trial = await privateTrial()
    const post = (token?: string) => upload(req(`/att/api/trials/${trial.id}/upload`, { method: 'POST', token, body: new FormData() }), params({ trialId: trial.id }))
    expect((await post()).status).toBe(401)
    expect((await post(pat.idToken)).status).not.toBe(401)
  })

  it('the tracker routes get past sign-in', async () => {
    const calls: [string, (token?: string) => Promise<Response>][] = [
      ['GET devices', t => listDevices(req('/api/account/devices', { token: t }))],
      ['DELETE devices', t => removeDevice(req('/api/account/devices', { method: 'DELETE', token: t, body: JSON.stringify({ deviceId: 'AABBCCDD' }), type: 'application/json' }))],
      ['GET device sessions', t => deviceSessions(req('/api/account/devices/sessions', { token: t }))],
      ['GET one device session', t => deviceSession(req('/api/account/devices/sessions/s1', { token: t }), params({ sessionId: 's1' }))],
      ['POST relay', t => relay(req('/api/account/devices/AABBCCDD/sessions?filename=a.csv', { method: 'POST', token: t, body: 'x', type: 'text/csv' }), params({ deviceId: 'AABBCCDD' }))],
      ['GET staged parts', t => staged(req('/api/account/devices/AABBCCDD/sessions?filename=a.csv', { token: t }), params({ deviceId: 'AABBCCDD' }))],
      ['POST link', t => link(req('/api/account/devices/link', { method: 'POST', token: t, body: JSON.stringify({ code: 'ZZZZZZ' }), type: 'application/json' }))],
      ['POST link-bluetooth', t => linkBluetooth(req('/api/account/devices/link-bluetooth', { method: 'POST', token: t, body: '{}', type: 'application/json' }))],
    ]
    for (const [name, call] of calls) {
      expect((await call()).status, name).toBe(401)
      expect((await call(pat.idToken)).status, name).not.toBe(401)
    }
  })

  it('POST /paddles/api/analyse gets past sign-in', async () => {
    const post = (token?: string) => analyse(req('/paddles/api/analyse', { method: 'POST', token, body: new FormData() }))
    expect((await post()).status).toBe(401)
    expect((await post(pat.idToken)).status).not.toBe(401)
  })
})
