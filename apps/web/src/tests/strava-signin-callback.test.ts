// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@/lib/strava', () => ({ exchangeCode: vi.fn(), getAthleteProfile: vi.fn() }))
vi.mock('@/lib/strava-storage', () => ({
  putStravaTokens: vi.fn(),
  getUserIdByAthleteId: vi.fn(),
  putAthleteIndex: vi.fn(),
}))
vi.mock('@/lib/cognito', () => ({
  findUserByEmail: vi.fn(),
  findUserBySub: vi.fn(),
  adminCreateUserForStrava: vi.fn(),
  customAuthSignIn: vi.fn(),
  verifyIdToken: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ setAuthCookies: vi.fn() }))

import { GET as callback } from '@/app/att/api/auth/strava/callback/route'
import { cookies } from 'next/headers'
import * as strava from '@/lib/strava'
import * as stravaStorage from '@/lib/strava-storage'
import * as cognito from '@/lib/cognito'

function mockCookies(state: string, next = '/att') {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => {
      if (name === 'strava_signin_state') return { name, value: state }
      if (name === 'strava_signin_next') return { name, value: next }
      return undefined
    },
  } as unknown as Awaited<ReturnType<typeof cookies>>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCookies('state123')
  // Strava never returns an email; athlete 555 exchanges fine.
  vi.mocked(strava.exchangeCode).mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresAt: 0, athleteId: 555 } as never)
  vi.mocked(strava.getAthleteProfile).mockResolvedValue({ id: 555, firstname: 'Bal', lastname: 'G' } as never)
  vi.mocked(cognito.customAuthSignIn).mockResolvedValue({ idToken: 'id', refreshToken: 'rt' } as never)
  vi.mocked(cognito.verifyIdToken).mockResolvedValue({ id: 'real-sub-1', email: 'baldur@example.com', displayName: 'Baldur' } as never)
  vi.mocked(cognito.findUserByEmail).mockResolvedValue(null)
  vi.mocked(cognito.adminCreateUserForStrava).mockResolvedValue({ error: 'UsernameExistsException' } as never)
}, )

const req = () => new NextRequest('http://x/att/api/auth/strava/callback?code=c&state=state123')

describe('Strava sign-in callback — linked-account resolution', () => {
  it('signs into the existing account (resolved by sub) when the athlete is linked, without creating a duplicate', async () => {
    // Athlete is linked to a REAL-email Cognito account (the user connected
    // Strava while signed in). The record's email is NOT the synthetic address.
    vi.mocked(stravaStorage.getUserIdByAthleteId).mockResolvedValue('real-sub-1')
    vi.mocked(cognito.findUserBySub).mockResolvedValue({ sub: 'real-sub-1', email: 'baldur@example.com', displayName: 'Baldur' } as never)

    const res = await callback(req())

    // Signed in (redirect to /att), NOT the error page.
    expect(res.status).toBe(307)
    expect(res.headers.get('location') ?? '').not.toContain('error=')
    // Resolved by sub → signs in with the REAL email, no duplicate created.
    expect(cognito.findUserBySub).toHaveBeenCalledWith('real-sub-1')
    expect(cognito.customAuthSignIn).toHaveBeenCalledWith('baldur@example.com', expect.any(String))
    expect(cognito.adminCreateUserForStrava).not.toHaveBeenCalled()
  })

  it('creates a fresh account only when the athlete is NOT linked', async () => {
    vi.mocked(stravaStorage.getUserIdByAthleteId).mockResolvedValue(null)
    vi.mocked(cognito.adminCreateUserForStrava).mockResolvedValue({ sub: 'new-sub' } as never)

    const res = await callback(req())

    expect(res.status).toBe(307)
    expect(res.headers.get('location') ?? '').not.toContain('error=')
    expect(cognito.adminCreateUserForStrava).toHaveBeenCalled()
  })

  // Regression: Strava returns email as '' (empty string) not undefined, so
  // `profile.email ?? synth` kept the '' and AdminCreateUser was called with an
  // empty username → InvalidParameterException → "Could not create an account
  // from your Strava profile". The synthetic address must be used for '' too.
  it('uses the synthetic address (never an empty username) when Strava gives an empty email', async () => {
    vi.mocked(strava.getAthleteProfile).mockResolvedValue({ id: 555, firstname: 'Bal', lastname: 'G', email: '' } as never)
    vi.mocked(stravaStorage.getUserIdByAthleteId).mockResolvedValue(null)
    vi.mocked(cognito.adminCreateUserForStrava).mockResolvedValue({ sub: 'new-sub' } as never)

    const res = await callback(req())

    expect(res.status).toBe(307)
    expect(res.headers.get('location') ?? '').not.toContain('error=')
    const [emailArg] = vi.mocked(cognito.adminCreateUserForStrava).mock.calls[0]
    expect(emailArg).toBe('strava-555@noreply.paddlesnitch.com')
    expect(emailArg).not.toBe('')
  })
})
