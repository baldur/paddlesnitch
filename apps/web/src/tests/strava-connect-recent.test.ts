// @vitest-environment node
// Linking a Strava account makes "Sign in with Strava" a way into the
// account, so connecting needs a recent real sign-in, like deleting it
// (security review, 2026-10-25): from a left-open browser, someone could
// otherwise link their own Strava and sign in as this person for good.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir, makeUser, type TestUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@/lib/strava', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/strava')>()),
  authorizeUrl: vi.fn(async (state: string) => `https://www.strava.com/oauth/authorize?state=${state}`),
  exchangeCode: vi.fn(async () => ({ athleteId: 999, athleteName: 'Someone', accessToken: 'a', refreshToken: 'r', expiresAt: 4_000_000_000 })),
}))

import { cookies } from 'next/headers'
import { GET as connect } from '@/app/att/api/strava/connect/route'
import { GET as callback } from '@/app/att/api/strava/callback/route'
import { markLinkSession } from '@/lib/app-signin'
import { getUserIdByAthleteId } from '@/lib/strava-storage'

let dir: string
let pat: TestUser
beforeEach(async () => { dir = await makeDataDir(); pat = await makeUser('Pat') })
afterEach(async () => { await cleanDataDir(dir); vi.useRealTimers() })

function jar(c: Record<string, string>) {
  vi.mocked(cookies).mockResolvedValue({ get: (n: string) => (c[n] ? { name: n, value: c[n] } : undefined) } as never)
}
const get = (url: string) => new NextRequest(`http://localhost${url}`)
const where = (res: Response) => { const u = new URL(res.headers.get('location')!); return u.origin === 'http://localhost' ? u.pathname + u.search : u.origin }

describe('connecting Strava needs a recent sign-in', () => {
  it('a fresh sign-in goes to Strava', async () => {
    jar({ tt_id: pat.idToken })
    expect(where(await connect(get('/att/api/strava/connect')))).toBe('https://www.strava.com')
  })

  it('an old sign-in, or a session a web-code link made, is sent to sign in again, and nothing starts', async () => {
    jar({ tt_id: pat.idToken })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 11 * 60_000)
    const old = await connect(get('/att/api/strava/connect'))
    expect(where(old)).toBe('/account?strava=reauth')
    expect(old.headers.getSetCookie().some(c => c.startsWith('strava_state='))).toBe(false)
    vi.useRealTimers()
    const claims = JSON.parse(Buffer.from(pat.idToken.split('.')[1], 'base64url').toString())
    await markLinkSession(pat.id, claims.origin_jti ?? claims.jti)
    expect(where(await connect(get('/att/api/strava/connect')))).toBe('/account?strava=reauth')
  })

  it('the callback checks again, and links nothing for an old sign-in', async () => {
    jar({ tt_id: pat.idToken, strava_state: 'abc' })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 11 * 60_000)
    expect(where(await callback(get('/att/api/strava/callback?code=c&state=abc')))).toBe('/account?strava=reauth')
    expect(await getUserIdByAthleteId(999)).toBeNull()
  })
})
