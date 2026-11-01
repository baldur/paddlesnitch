// @vitest-environment node
// Operational telemetry (docs/features/observability.md): which client made a
// request, one line per API call, one line per action. The lines are EMF, so
// these tests read them the way CloudWatch does: as JSON on stdout.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { readFileSync } from 'fs'

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: () => {} }) }))

import { clientOf, apiCallEmf, actionEmf, CLIENT_HEADER } from '@paddlesnitch/core/observe'
import { APP_HEADER } from '@paddlesnitch/core/auth'
import { withAction, outcomeOfStatus } from '@/lib/action'
import { GET as trpcGet } from '@/app/api/trpc/[trpc]/route'
import { createCaller } from '@paddlesnitch/api'

const headers = (h: Record<string, string> = {}) => new Headers(h)

let lines: Record<string, unknown>[]
let dir: string
beforeEach(async () => {
  lines = []
  vi.spyOn(console, 'log').mockImplementation((s: unknown) => {
    try { const o = JSON.parse(String(s)); if (o?.kind) lines.push(o) } catch { /* not ours */ }
  })
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'observability-'))
  process.env.USE_LOCAL_STORAGE = 'true'
  process.env.DATA_DIR = dir
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(dir, { recursive: true, force: true })
  delete process.env.DATA_DIR
})
const ofKind = (kind: string) => lines.filter(l => l.kind === kind)

describe('which client sent a request', () => {
  it('reads the app header: platform, version and build', () => {
    expect(clientOf(headers({ 'x-paddlesnitch-app': 'android/1.0.3 (42)' }))).toEqual({ platform: 'android', version: '1.0.3', build: '42' })
    expect(clientOf(headers({ 'x-paddlesnitch-app': 'ios/1.0.0' }))).toEqual({ platform: 'ios', version: '1.0.0' })
  })

  it('is the header the apps already send for sign-in, not a second one', () => {
    expect(CLIENT_HEADER).toBe(APP_HEADER)
    expect(clientOf(headers({ 'x-paddlesnitch-app': 'android/0.1.0' }))).toEqual({ platform: 'android', version: '0.1.0' })
  })

  it('no header is the web site', () => {
    expect(clientOf(headers())).toEqual({ platform: 'web' })
  })

  it('a junk header is "other", so it cannot add values to the dashboards', () => {
    for (const junk of ['windows/1.0', 'android', 'android/1.0.3 (42) extra', 'android/<script>', `android/${'9'.repeat(40)}`, ''])
      expect(clientOf(headers({ 'x-paddlesnitch-app': junk }))).toEqual({ platform: 'other' })
  })
})

describe('the API-call line', () => {
  it('counts a server error, never a caller mistake', () => {
    expect(apiCallEmf({ path: 'p', type: 'query', code: 'INTERNAL_SERVER_ERROR', ms: 5 }).ServerErrors).toBe(1)
    expect(apiCallEmf({ path: 'p', type: 'query', code: 'TIMEOUT', ms: 5 }).ServerErrors).toBe(1)
    for (const code of ['UNAUTHORIZED', 'NOT_FOUND', 'BAD_REQUEST', 'FORBIDDEN', 'TOO_MANY_REQUESTS'])
      expect(apiCallEmf({ path: 'p', type: 'query', code, ms: 5 }).ServerErrors).toBe(0)
    const ok = apiCallEmf({ path: 'paddles.list', type: 'query', ms: 12.6 }, { platform: 'web' })
    expect(ok).toMatchObject({ Calls: 1, ServerErrors: 0, ok: true, ms: 13, platform: 'web' })
    expect(ok).not.toHaveProperty('code')
  })

  it('is an EMF document with no dimensions, so it makes exactly two metrics', () => {
    const doc = apiCallEmf({ path: 'p', type: 'query', ms: 1 })
    expect(doc._aws.CloudWatchMetrics[0]).toEqual({
      Namespace: 'Paddlesnitch/Api', Dimensions: [[]],
      Metrics: [{ Name: 'Calls', Unit: 'Count' }, { Name: 'ServerErrors', Unit: 'Count' }],
    })
  })
})

describe('the action line', () => {
  it('only a fail counts as a failure; a rejection is the user, not us', () => {
    expect(actionEmf('upload', 'fail').Failures).toBe(1)
    expect(actionEmf('upload', 'rejected').Failures).toBe(0)
    expect(actionEmf('upload', 'ok').Failures).toBe(0)
  })

  it('is counted per action and in total, and keeps the reason short', () => {
    const doc = actionEmf('sign_in', 'rejected', { client: { platform: 'ios', version: '1.0.0' }, reason: 'x'.repeat(200) })
    expect(doc._aws.CloudWatchMetrics[0].Dimensions).toEqual([['Action'], []])
    expect(doc).toMatchObject({ Action: 'sign_in', outcome: 'rejected', platform: 'ios', appVersion: '1.0.0' })
    expect(doc.reason).toHaveLength(60)
  })
})

describe('tRPC over HTTP logs one line per call', () => {
  const call = (proc: string, input: unknown, h: Record<string, string> = {}) =>
    trpcGet(new Request(`http://localhost/api/trpc/${proc}?input=${encodeURIComponent(JSON.stringify(input))}`, { headers: h }))

  it('a working call from the Android app: ok, with platform and version', async () => {
    const res = await call('games.leaderboard', { course: 'race' }, { 'x-paddlesnitch-app': 'android/1.0.3 (42)' })
    expect(res.status).toBe(200)
    expect(ofKind('api_call')).toEqual([expect.objectContaining({
      path: 'games.leaderboard', type: 'query', ok: true, ServerErrors: 0, platform: 'android', appVersion: '1.0.3', build: '42',
    })])
  })

  it('a signed-out call to a signed-in procedure is the caller, not a server error', async () => {
    const res = await call('paddles.list', undefined)
    expect(res.status).toBe(401)
    expect(ofKind('api_call')).toEqual([expect.objectContaining({ path: 'paddles.list', ok: false, code: 'UNAUTHORIZED', ServerErrors: 0, platform: 'web' })])
  })

  it('bad input is the caller too', async () => {
    await call('games.leaderboard', { course: 'nowhere' })
    expect(ofKind('api_call')).toEqual([expect.objectContaining({ code: 'BAD_REQUEST', ServerErrors: 0 })])
  })

  it('in-process calls (server rendering, tests) are not logged as API calls', async () => {
    await createCaller({ user: null }).games.leaderboard({ course: 'race' })
    expect(ofKind('api_call')).toEqual([])
  })
})

describe('actions from routes', () => {
  const req = (h: Record<string, string> = {}) => new Request('http://localhost/x', { method: 'POST', headers: h })

  it('2xx and redirects worked, 4xx is the user, 5xx is us', () => {
    expect([200, 201, 302, 400, 401, 404, 422, 500, 502].map(outcomeOfStatus))
      .toEqual(['ok', 'ok', 'ok', 'rejected', 'rejected', 'rejected', 'rejected', 'fail', 'fail'])
  })

  it('logs one line per request, with the status as the reason when it did not work', async () => {
    const wrapped = withAction('upload', async (_r: Request, status: number) => new Response(null, { status }))
    await wrapped(req({ 'x-paddlesnitch-app': 'ios/1.0.0' }), 201)
    await wrapped(req(), 422)
    await wrapped(req(), 500)
    expect(ofKind('action').map(l => [l.Action, l.outcome, l.reason, l.platform])).toEqual([
      ['upload', 'ok', undefined, 'ios'],
      ['upload', 'rejected', 'http_422', 'web'],
      ['upload', 'fail', 'http_500', 'web'],
    ])
  })

  it('a handler that throws is a fail, and the error still reaches Next', async () => {
    const boom = withAction('sign_in', async () => { throw new Error('boom') })
    await expect(boom(req())).rejects.toThrow('boom')
    expect(ofKind('action')).toEqual([expect.objectContaining({ Action: 'sign_in', outcome: 'fail', reason: 'threw', Failures: 1 })])
  })

  it('a tracker is a tracker, whatever headers it sends', async () => {
    await withAction('device_sync', async () => new Response(null, { status: 200 }), { platform: 'tracker' })(req())
    expect(ofKind('action')[0]).toMatchObject({ Action: 'device_sync', platform: 'tracker' })
  })

  it('every action route is wrapped', () => {
    const root = path.join(__dirname, '../app')
    const src = (p: string) => readFileSync(path.join(root, p), 'utf8')
    expect(src('att/api/auth/login/route.ts')).toContain("export const POST = withAction('sign_in', post)")
    expect(src('att/api/auth/otp-verify/route.ts')).toContain("export const POST = withAction('sign_in', post)")
    expect(src('att/api/trials/[trialId]/upload/route.ts')).toContain("export const POST = withAction('upload', post)")
    expect(src('paddles/api/analyse/route.ts')).toContain("export const POST = withAction('upload', post)")
    expect(src('api/devices/sessions/route.ts')).toContain("export const POST = withAction('device_sync', withDeviceAuth(handleSessionUpload), { platform: 'tracker' })")
    expect(src('api/account/devices/[deviceId]/sessions/route.ts')).toContain("export const POST = withAction('device_sync', post)")
    const google = src('att/api/auth/google/callback/route.ts')
    expect(google).toContain("logAction('sign_in', 'ok'")
    expect(google).toContain("logAction('sign_in', key === 'google_failed' ? 'fail' : 'rejected'")
  })
})
