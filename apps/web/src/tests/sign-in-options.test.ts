// @vitest-environment node
// Which outside sign-ins are on (lib/sign-in-options.ts): the switches, the
// answer the apps read, and Strava switched off everywhere at once.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { readFileSync } from 'fs'
import path from 'path'

vi.mock('@paddlesnitch/core/strava', async (orig) => ({
  ...(await orig<typeof import('@paddlesnitch/core/strava')>()),
  authorizeUrl: vi.fn(async () => 'https://www.strava.com/oauth/authorize?x=1'),
}))
vi.mock('@/lib/auth', async (orig) => ({ ...(await orig<typeof import('@/lib/auth')>()), getAuthUser: vi.fn(async () => null) }))

import { GET as options } from '@/app/att/api/auth/options/route'
import { GET as stravaInit } from '@/app/att/api/auth/strava/init/route'
import { authorizeUrl } from '@/lib/strava'
import { SignInOptions } from '@paddlesnitch/api/contract'

afterEach(() => vi.unstubAllEnvs())

const fixture = (name: string) =>
  JSON.parse(readFileSync(path.join(__dirname, '../../../../mobile/contract/fixtures/api', name), 'utf8'))

describe('GET /att/api/auth/options', () => {
  it('Google only when the build switches it on and Cognito has a hosted sign-in', async () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_SIGNIN', '1')
    vi.stubEnv('COGNITO_DOMAIN', 'https://example.auth.eu-west-1.amazoncognito.com')
    expect((await (await options()).json()).google).toBe(true)
    vi.stubEnv('COGNITO_DOMAIN', '')
    expect((await (await options()).json()).google).toBe(false)
    vi.stubEnv('COGNITO_DOMAIN', 'https://example.auth.eu-west-1.amazoncognito.com')
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_SIGNIN', '')
    expect((await (await options()).json()).google).toBe(false)
  })

  it('Strava unless the build switches it off', async () => {
    expect((await (await options()).json()).strava).toBe(true)
    vi.stubEnv('NEXT_PUBLIC_STRAVA_OFF', '1')
    expect((await (await options()).json()).strava).toBe(false)
  })

  it('answers in the contract\'s shape, as the fixtures show', async () => {
    expect(SignInOptions.parse(await (await options()).json())).toBeTruthy()
    for (const f of ['auth.options.json', 'auth.options.email-only.json']) expect(SignInOptions.parse(fixture(f)), f).toEqual(fixture(f))
  })
})

describe('Strava switched off', () => {
  it('has no consent page, so every way into Strava says it isn\'t available', async () => {
    expect(await authorizeUrl('s', 'https://x/cb')).not.toBeNull()
    vi.stubEnv('NEXT_PUBLIC_STRAVA_OFF', '1')
    expect(await authorizeUrl('s', 'https://x/cb')).toBeNull()
    const res = await stravaInit(new NextRequest('http://localhost/att/api/auth/strava/init'))
    expect(new URL(res.headers.get('location')!).searchParams.get('error')).toBe('strava_not_configured')
  })

  it('is switched by the STRAVA_OFF repository variable', () => {
    const deploy = readFileSync(path.join(__dirname, '../../../../.github/workflows/deploy.yml'), 'utf8')
    expect(deploy).toContain('NEXT_PUBLIC_STRAVA_OFF: ${{ vars.STRAVA_OFF }}')
  })
})
