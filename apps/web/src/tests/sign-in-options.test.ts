// @vitest-environment node
// Which outside sign-ins are on (lib/sign-in-options.ts): the switch, and the
// answer the apps read. Strava was removed (2026-11): older app builds still
// read a `strava` field, so it stays, always false.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import path from 'path'

import { GET as options } from '@/app/att/api/auth/options/route'
import { SignInOptions } from '@paddlesnitch/api/contract'

afterEach(() => vi.unstubAllEnvs())

const repo = path.join(__dirname, '../../../..')
const fixture = (name: string) =>
  JSON.parse(readFileSync(path.join(repo, 'mobile/contract/fixtures/api', name), 'utf8'))

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

  it('still answers strava, always false, so older app builds decode it', async () => {
    expect((await (await options()).json()).strava).toBe(false)
    // The old switch does nothing now.
    vi.stubEnv('NEXT_PUBLIC_STRAVA_OFF', '')
    expect((await (await options()).json()).strava).toBe(false)
  })

  it('answers in the contract\'s shape, as the fixtures show', async () => {
    expect(SignInOptions.parse(await (await options()).json())).toBeTruthy()
    for (const f of ['auth.options.json', 'auth.options.email-only.json']) expect(SignInOptions.parse(fixture(f)), f).toEqual(fixture(f))
  })
})

describe('Strava is gone', () => {
  it('has no routes left: sign-in, connect, import or webhook', () => {
    for (const dir of ['att/api/auth/strava', 'att/api/strava', 'api/strava']) {
      expect(existsSync(path.join(repo, 'apps/web/src/app', dir)), dir).toBe(false)
    }
  })

  it('has no build switch left', () => {
    const deploy = readFileSync(path.join(repo, '.github/workflows/deploy.yml'), 'utf8')
    expect(deploy).not.toContain('STRAVA')
  })
})
