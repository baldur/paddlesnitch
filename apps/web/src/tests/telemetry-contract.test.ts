// @vitest-environment node
// Client telemetry through POST /att/api/track (docs/features/observability.md,
// mobile/contract/telemetry.md): the apps get in with their header instead of
// an Origin, the server stamps the platform, and the two error reports keep
// only their fixed fields.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import path from 'path'
import { NextRequest } from 'next/server'
import { POST as track } from '@/app/att/api/track/route'

let lines: Record<string, unknown>[]
beforeEach(() => {
  lines = []
  vi.spyOn(console, 'log').mockImplementation((s: unknown) => { lines.push(JSON.parse(String(s))) })
})
afterEach(() => vi.restoreAllMocks())

const send = (body: unknown, headers: Record<string, string>) =>
  track(new NextRequest('http://x/att/api/track', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } }))
const ANDROID = { 'x-paddlesnitch-app': 'android/1.0.3 (42)' }
const WEB = { origin: 'https://paddlesnitch.com' }
const event = (e: string, props?: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ events: [{ event: e, ...(props ? { props } : {}), ...extra }] })

describe('who may send events', () => {
  it('an app with its header gets in without an Origin', async () => {
    expect((await send(event('app_open'), ANDROID)).status).toBe(204)
    expect(lines).toEqual([expect.objectContaining({ Event: 'app_open', platform: 'android', appVersion: '1.0.3', build: '42' })])
  })

  it('a junk client header is not an app, so it still needs an Origin', async () => {
    await send(event('app_open'), { 'x-paddlesnitch-app': 'windows/1.0' })
    expect(lines).toEqual([])
  })

  it('the web site is stamped "web"', async () => {
    await send(event('pageview', undefined, { path: '/att' }), WEB)
    expect(lines[0]).toMatchObject({ Event: 'pageview', platform: 'web', path: '/att' })
  })

  it("the platform and version come from the request, never the client's props", async () => {
    await send(event('app_open', { platform: 'ios', appVersion: '9.9.9', build: '1', screen: 'paddles' }), ANDROID)
    expect(lines[0]).toMatchObject({ platform: 'android', appVersion: '1.0.3', build: '42' })
    expect(lines[0]).not.toHaveProperty('screen') // app_open has no props: the screen goes in path, app:<screen>
  })
})

describe('crash reports keep only their fixed fields', () => {
  it('drops frames that are paths or messages, and keeps at most 12', async () => {
    const frames = ['com.paddlesnitch.A.b:1', '/data/user/0/com.paddlesnitch/files/x.kt:3', 'user typed this', ...Array.from({ length: 20 }, (_, i) => `com.paddlesnitch.C.d:${i}`)]
    await send(event('crash_report', { type: 'java.lang.NullPointerException', frames: frames.join('|'), message: 'secret user text' }), ANDROID)
    const crash = lines[0]
    expect(crash.signature).toBe('java.lang.NullPointerException @ com.paddlesnitch.A.b:1')
    expect(String(crash.frames).split('|')).toHaveLength(12)
    expect(String(crash.frames)).not.toMatch(/data\/user|typed/)
    expect(crash).not.toHaveProperty('message')
  })

  it('a report with no valid type is dropped, not counted', async () => {
    await send(event('crash_report', { type: 'not a class name', frames: 'a.b:1' }), ANDROID)
    await send(event('crash_report', { frames: 'a.b:1' }), ANDROID)
    expect(lines).toEqual([])
  })

  it('a bad crashed version is left out', async () => {
    await send(event('crash_report', { type: 'X', appVersion: '1.0; drop table', build: 'abc' }), ANDROID)
    expect(lines[0]).not.toHaveProperty('crashedVersion')
    expect(lines[0]).not.toHaveProperty('crashedBuild')
  })
})

describe('browser errors', () => {
  it('keep the first line of the message, cut short, and a page with personal segments replaced', async () => {
    await send(event('client_error', { type: 'TypeError', message: `x is undefined${'!'.repeat(200)}\n    at secret (https://paddlesnitch.com/_next/a.js:1:2)`, path: '/paddles/shared/abc123' }), WEB)
    const err = lines[0]
    expect(err).toMatchObject({ Event: 'client_error', type: 'TypeError', platform: 'web' })
    expect(String(err.message)).toHaveLength(120)
    expect(String(err.message)).not.toContain('\n')
    expect(err.path).not.toContain('abc123')
  })

  it('an empty error is dropped', async () => {
    await send(event('client_error', { type: 'Error', message: '  ' }), WEB)
    expect(lines).toEqual([])
  })
})

describe('mobile/contract/fixtures/telemetry', () => {
  const dir = path.join(__dirname, '../../../../mobile/contract/fixtures/telemetry')
  const names = readdirSync(dir).filter(f => f.endsWith('.json'))

  it('has fixtures', () => expect(names.length).toBeGreaterThanOrEqual(3))

  it.each(names)('%s: the server logs exactly what the contract says', async (name) => {
    const fx = JSON.parse(readFileSync(path.join(dir, name), 'utf8').replaceAll('"{{now}}"', String(Date.now())))
    const res = await send(fx.body, fx.headers)
    expect(res.status).toBe(204)
    expect(lines).toHaveLength(fx.emits.length)
    fx.emits.forEach((want: Record<string, unknown>, i: number) => expect(lines[i]).toMatchObject(want))
  })
})
