import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from './proxy'

// Build a request with the given method + path and (optionally) an auth cookie.
function req(method: string, path: string, authed = false): NextRequest {
  const r = new NextRequest(`https://paddlesnitch.com${path}`, { method })
  if (authed) r.cookies.set('tt_id', 'token')
  return r
}
const redirectsToAuth = (res: Response) =>
  res.status >= 300 && res.status < 400 && (res.headers.get('location') ?? '').includes('/att/auth')

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

  it('still gates other unauthenticated API mutations to sign-in', () => {
    expect(redirectsToAuth(proxy(req('POST', '/att/api/courses')))).toBe(true)
    expect(redirectsToAuth(proxy(req('DELETE', '/api/account')))).toBe(true)
  })

  it('lets authenticated API mutations through', () => {
    expect(redirectsToAuth(proxy(req('POST', '/att/api/courses', true)))).toBe(false)
  })

  it('never gates GETs', () => {
    expect(redirectsToAuth(proxy(req('GET', '/att/api/courses')))).toBe(false)
  })

  it('keeps auth endpoints public', () => {
    expect(redirectsToAuth(proxy(req('POST', '/att/api/auth/otp-request')))).toBe(false)
  })
})
