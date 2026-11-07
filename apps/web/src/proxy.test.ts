import { describe, it, expect, vi, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from './proxy'
import { resetOriginVerifyWarnings } from './lib/origin-verify'

// Build a request with the given method + path and (optionally) an auth cookie.
function req(method: string, path: string, authed = false): NextRequest {
  const r = new NextRequest(`https://paddlesnitch.com${path}`, { method })
  if (authed) r.cookies.set('tt_id', 'token')
  return r
}
const redirectsToAuth = (res: Response) =>
  res.status >= 300 && res.status < 400 && (res.headers.get('location') ?? '').includes('/signin')

describe('tracker QR: uppercase /L/', () => {
  it('serves /L/<code> from the /l/<code> handler (an internal rewrite, no extra redirect)', () => {
    const res = proxy(req('GET', '/L/ABC123'))
    expect(res.headers.get('x-middleware-rewrite')).toBe('https://paddlesnitch.com/l/ABC123')
    expect(res.headers.get('location')).toBeNull()
  })
  it('leaves lowercase /l/<code> alone (it used to redirect to itself forever)', () => {
    const res = proxy(req('GET', '/l/abc123'))
    expect(res.headers.get('location')).toBeNull()
  })
})

describe('proxy auth gate', () => {
  it('lets an UNAUTHENTICATED POST to /att/api/feedback through (public report widget)', () => {
    // Regression: the proxy used to redirect every unauthenticated /att/api
    // mutation to sign-in, silently losing anonymous customer feedback.
    expect(redirectsToAuth(proxy(req('POST', '/att/api/feedback')))).toBe(false)
  })

  it('lets an UNAUTHENTICATED POST to /att/api/track through (anonymous analytics beacons)', () => {
    // Regression: the mutation gate 307-redirected every signed-out client
    // analytics beacon to sign-in, so no anonymous pageviews were ever recorded.
    expect(redirectsToAuth(proxy(req('POST', '/att/api/track')))).toBe(false)
  })

  it('lets an UNAUTHENTICATED POST to /api/beta-signup through (applicants usually have no account)', () => {
    expect(redirectsToAuth(proxy(req('POST', '/api/beta-signup')))).toBe(false)
  })

  it('lets the jobs kicker (no account, no cookie) reach /api/jobs/run and /api/jobs/sweep (#413)', () => {
    expect(redirectsToAuth(proxy(req('POST', '/api/jobs/run')))).toBe(false)
    expect(redirectsToAuth(proxy(req('POST', '/api/jobs/sweep')))).toBe(false)
  })

  it('still gates other unauthenticated API mutations to sign-in', () => {
    expect(redirectsToAuth(proxy(req('POST', '/att/api/courses')))).toBe(true)
    expect(redirectsToAuth(proxy(req('DELETE', '/api/account')))).toBe(true)
  })

  it('gates the account page, but not a public profile or a path that merely starts with "account"', () => {
    expect(redirectsToAuth(proxy(req('GET', '/account')))).toBe(true)
    expect(redirectsToAuth(proxy(req('GET', '/account', true)))).toBe(false)
    expect(redirectsToAuth(proxy(req('GET', '/profile/abc')))).toBe(false)
    expect(redirectsToAuth(proxy(req('GET', '/accounting')))).toBe(false)
    expect(redirectsToAuth(proxy(req('GET', '/devices')))).toBe(true)
    expect(redirectsToAuth(proxy(req('GET', '/devices/AABBCCDD')))).toBe(true)
    expect(redirectsToAuth(proxy(req('GET', '/buddies')))).toBe(true)
    expect(redirectsToAuth(proxy(req('GET', '/buddies/ann')))).toBe(true)
  })

  it('lets authenticated API mutations through', () => {
    expect(redirectsToAuth(proxy(req('POST', '/att/api/courses', true)))).toBe(false)
  })

  it('lets a mobile app\'s Bearer-signed API mutation through (the route verifies the token)', () => {
    const bearer = (method: string, path: string) =>
      new NextRequest(`https://paddlesnitch.com${path}`, { method, headers: { authorization: 'Bearer eyJ.app.token' } })
    expect(redirectsToAuth(proxy(bearer('POST', '/att/api/trials/t1/upload')))).toBe(false)
    expect(redirectsToAuth(proxy(bearer('POST', '/api/account/devices/link')))).toBe(false)
    // Pages still need the website's cookie.
    expect(redirectsToAuth(proxy(bearer('GET', '/account')))).toBe(true)
  })

  it('never gates GETs', () => {
    expect(redirectsToAuth(proxy(req('GET', '/att/api/courses')))).toBe(false)
  })

  it('keeps auth endpoints public', () => {
    expect(redirectsToAuth(proxy(req('POST', '/att/api/auth/otp-request')))).toBe(false)
  })

  it('carries the query string through sign-in, not just the path', () => {
    // Regression: `next` was set to the pathname alone while the cloned URL
    // kept the original params, so /devices?code=ABC123 became
    // /signin?code=ABC123&next=/account and the code was dropped
    // on the way back. That silently breaks scan-to-link for anyone not
    // already signed in -- i.e. most people setting up a device.
    const res = proxy(req('GET', '/devices?code=ABC123'))
    const loc = new URL(res.headers.get('location') ?? '', 'https://paddlesnitch.com')
    expect(loc.pathname).toBe('/signin')
    expect(loc.searchParams.get('next')).toBe('/devices?code=ABC123')
    // An invite link opened signed out comes back to the invite after sign-in.
    const inv = new URL(proxy(req('GET', '/buddies?invite=abc123')).headers.get('location')!)
    expect(inv.searchParams.get('next')).toBe('/buddies?invite=abc123')
    // ...and the code must not be left loose on the auth URL itself.
    expect(loc.searchParams.get('code')).toBeNull()
  })
})

// #908: only CloudFront may call the server. CloudFront adds x-origin-verify
// on the server origin; a request straight to the function URL has none.
describe('only CloudFront may call the server (#908)', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

  // Every route family the server answers, as CloudFront forwards it: pages,
  // tRPC (web cookie and app Bearer), uploads (multipart and chunked tracker
  // uploads), the tracker endpoints, sign-in, the public API, MCP, jobs, the
  // claim QR and the planner data.
  const families: [string, string, Record<string, string>?][] = [
    ['GET', '/'],
    ['GET', '/paddles'],
    ['GET', '/devices'],
    ['GET', '/api/trpc/me'],
    ['POST', '/api/trpc/paddles.rename', { authorization: 'Bearer app-token' }],
    ['POST', '/paddles/api/analyse'],
    ['POST', '/att/api/trials/t1/entries'],
    ['POST', '/api/devices/sessions?part=2&parts=5'],
    ['GET', '/api/devices/firmware?version=0.19.3'],
    ['POST', '/api/devices/health'],
    ['POST', '/api/devices/token'],
    ['POST', '/api/devices/claim'],
    ['POST', '/att/api/auth/signin'],
    ['POST', '/att/api/track'],
    ['POST', '/api/jobs/run'],
    ['GET', '/api/v1/trials'],
    ['POST', '/mcp'],
    ['GET', '/L/ABC123'],
    ['GET', '/plan/data/v1/overview'],
  ]
  function viewer(method: string, path: string, headers: Record<string, string> = {}, verify?: string): NextRequest {
    const all = verify === undefined ? headers : { ...headers, 'x-origin-verify': verify }
    const r = new NextRequest(`https://paddlesnitch.com${path}`, { method, headers: all })
    r.cookies.set('tt_id', 'token')
    return r
  }
  const refused = (res: Response) => res.status === 403

  it.each(families)('enforced: %s %s is refused without the header or with a wrong one, and passes with it', (method, path, headers) => {
    vi.stubEnv('ORIGIN_VERIFY_SECRETS', 'right-secret')
    vi.stubEnv('ORIGIN_VERIFY_MODE', 'enforce')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(refused(proxy(viewer(method, path, headers)))).toBe(true)
    expect(refused(proxy(viewer(method, path, headers, 'wrong-secret')))).toBe(true)
    expect(refused(proxy(viewer(method, path, headers, 'right-secre')))).toBe(true)
    expect(refused(proxy(viewer(method, path, headers, '')))).toBe(true)
    expect(refused(proxy(viewer(method, path, headers, 'right-secret')))).toBe(false)
  })

  it('a refused request is refused before the auth gate and the /L/ rewrite', () => {
    vi.stubEnv('ORIGIN_VERIFY_SECRETS', 'right-secret')
    vi.stubEnv('ORIGIN_VERIFY_MODE', 'enforce')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const path of ['/devices', '/L/ABC123']) {
      const res = proxy(new NextRequest(`https://abc.lambda-url.eu-west-1.on.aws${path}`))
      expect(res.status).toBe(403)
      expect(res.headers.get('location')).toBeNull()
      expect(res.headers.get('x-middleware-rewrite')).toBeNull()
    }
  })

  it('accepts the previous value too while the secret is rotated', () => {
    vi.stubEnv('ORIGIN_VERIFY_SECRETS', 'new-secret,old-secret')
    vi.stubEnv('ORIGIN_VERIFY_MODE', 'enforce')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const upload = (v: string) => proxy(viewer('POST', '/api/devices/sessions?part=1&parts=2', {}, v))
    expect(refused(upload('new-secret'))).toBe(false)
    expect(refused(upload('old-secret'))).toBe(false)
    expect(refused(upload('new-secret,old-secret'))).toBe(true)
  })

  it('splits the values exactly as CloudFront does (on ",", no trimming), so both sides agree', () => {
    // CloudFront sends Fn::Select[0, Fn::Split[",", value]] verbatim.
    vi.stubEnv('ORIGIN_VERIFY_SECRETS', 'new-secret, old-secret')
    vi.stubEnv('ORIGIN_VERIFY_MODE', 'enforce')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const page = (v: string) => proxy(viewer('GET', '/paddles', {}, v))
    expect(refused(page('new-secret'))).toBe(false)
    // The stored second value is " old-secret"; no header can carry a leading
    // space (HTTP trims it), so a spaced list only half works: infra/CLAUDE.md
    // says no spaces.
    expect(refused(page('old-secret'))).toBe(true)
  })

  it('never logs a method the caller made up (the server-errors alarm matches ERROR)', () => {
    vi.stubEnv('ORIGIN_VERIFY_SECRETS', 'right-secret')
    vi.stubEnv('ORIGIN_VERIFY_MODE', 'enforce')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(refused(proxy(new NextRequest('https://abc.lambda-url.eu-west-1.on.aws/', { method: 'ERROR' })))).toBe(true)
    expect(refused(proxy(new NextRequest('https://abc.lambda-url.eu-west-1.on.aws/', { method: 'POST' })))).toBe(true)
    const lines = warn.mock.calls.map((c) => String(c[0]))
    expect(lines[0]).toContain('"method":"other"')
    expect(lines[0]).not.toMatch(/error/i)
    expect(lines[1]).toContain('"method":"POST"')
  })

  it.each([['unset', undefined], ['unknown', 'refuse'], ['empty', '']])('a secret with the mode %s means report: nothing is refused, a warning is logged', (_name, mode) => {
    vi.stubEnv('ORIGIN_VERIFY_SECRETS', 'right-secret')
    vi.stubEnv('ORIGIN_VERIFY_MODE', mode)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(refused(proxy(viewer('POST', '/api/devices/health')))).toBe(false)
    expect(String(warn.mock.calls[0][0])).toContain('"refused":false')
  })

  it('enforce without any secret warns once instead of going quietly open', () => {
    resetOriginVerifyWarnings()
    vi.stubEnv('ORIGIN_VERIFY_SECRETS', undefined)
    vi.stubEnv('ORIGIN_VERIFY_MODE', 'enforce')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(refused(proxy(viewer('GET', '/paddles')))).toBe(false)
    expect(refused(proxy(viewer('GET', '/paddles')))).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('origin_verify_off')
    resetOriginVerifyWarnings()
  })

  it('report mode refuses nothing but warns (without the value), so a first deploy proves CloudFront sends it', () => {
    vi.stubEnv('ORIGIN_VERIFY_SECRETS', 'right-secret')
    vi.stubEnv('ORIGIN_VERIFY_MODE', 'report')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(refused(proxy(viewer('GET', '/paddles', {}, 'wrong-secret')))).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('"verdict":"wrong"')
    expect(String(warn.mock.calls[0][0])).not.toContain('secret')
    expect(error).not.toHaveBeenCalled()
    proxy(viewer('GET', '/paddles', {}, 'right-secret'))
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it.each(families)('off when ORIGIN_VERIFY_SECRETS is unset or empty (local dev, tests): %s %s passes without the header', (method, path, headers) => {
    const warn = vi.spyOn(console, 'warn')
    for (const secrets of [undefined, '', ',']) {
      vi.stubEnv('ORIGIN_VERIFY_SECRETS', secrets)
      vi.stubEnv('ORIGIN_VERIFY_MODE', undefined)
      expect(process.env.ORIGIN_VERIFY_SECRETS).toBe(secrets)
      expect(refused(proxy(viewer(method, path, headers)))).toBe(false)
      expect(refused(proxy(viewer(method, path, headers, 'anything')))).toBe(false)
    }
    expect(warn).not.toHaveBeenCalled()
  })

  it('off in this test run: the suite sets no secret', () => {
    expect(process.env.ORIGIN_VERIFY_SECRETS ?? '').toBe('')
  })
})
