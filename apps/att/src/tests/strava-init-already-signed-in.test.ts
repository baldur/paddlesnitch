// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { GET as stravaInit } from '@/app/att/api/auth/strava/init/route'
import { cookies } from 'next/headers'

let dataDir: string
beforeEach(async () => {
  dataDir = await makeDataDir()
  // Make sure Strava is "configured" so authorizeUrl doesn't short-circuit
  // before our auth check would fire — we want to verify the signed-in
  // bypass specifically.
  process.env.STRAVA_CLIENT_ID = '12345'
})
afterEach(async () => {
  await cleanDataDir(dataDir)
  delete process.env.STRAVA_CLIENT_ID
})

function mockAuth(idToken: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => name === 'tt_id' && idToken ? { name, value: idToken } : undefined,
  } as ReturnType<typeof cookies> extends Promise<infer T> ? T : never)
}

describe('#55 — /att/api/auth/strava/init when already signed in', () => {
  it('redirects an already-signed-in user back to /att instead of starting OAuth', async () => {
    const u = await makeUser('Already In')
    mockAuth(u.idToken)
    const res = await stravaInit(new NextRequest('http://x/att/api/auth/strava/init'))
    expect(res.status).toBe(307)
    const location = res.headers.get('location') ?? ''
    expect(location).not.toContain('strava.com')
    expect(location).toMatch(/\/att\b/)
  })

  it('honours ?next= when bouncing the already-signed-in user', async () => {
    const u = await makeUser('Already In Two')
    mockAuth(u.idToken)
    const res = await stravaInit(new NextRequest('http://x/att/api/auth/strava/init?next=/profile/me/settings'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location') ?? '').toMatch(/\/profile\/me\/settings/)
  })

  it('clamps an open-redirect attempt back to /att', async () => {
    const u = await makeUser('Open Redirect Probe')
    mockAuth(u.idToken)
    const res = await stravaInit(new NextRequest('http://x/att/api/auth/strava/init?next=https://evil.example.com/x'))
    expect(res.status).toBe(307)
    const location = res.headers.get('location') ?? ''
    // We should NOT be sent to evil.example.com — anything that doesn't
    // start with `/` is treated as untrusted and rewritten to /att.
    expect(location).not.toContain('evil.example.com')
    expect(location).toMatch(/\/att\b/)
  })

  it('an unauthenticated visitor still gets redirected to Strava', async () => {
    mockAuth(null)
    const res = await stravaInit(new NextRequest('http://x/att/api/auth/strava/init'))
    expect(res.status).toBe(307)
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('strava.com/oauth/authorize')
  })
})
