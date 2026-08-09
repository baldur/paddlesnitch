// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { POST as signup } from '@/app/att/api/auth/signup/route'
import { GET as getMyTos, POST as acceptTos } from '@/app/api/account/tos/route'
import { GET as getTosDoc } from '@/app/att/api/legal/tos/route'
import { cookies } from 'next/headers'

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir) })

function mockAuth(idToken: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => name === 'tt_id' && idToken ? { name, value: idToken } : undefined,
  } as ReturnType<typeof cookies> extends Promise<infer T> ? T : never)
}

function jsonReq(method: string, body?: unknown) {
  return new NextRequest('http://x', {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json' },
  })
}

function freshEmail() {
  return `tos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
}

describe('Terms of Service — signup gating', () => {
  it('rejects signup that does not accept the current ToS version', async () => {
    const res = await signup(jsonReq('POST', {
      email: freshEmail(),
      displayName: 'NoConsent',
      password: 'Password123',
      // acceptedTosVersion deliberately omitted
    }))
    expect(res.status).toBe(422)
  })

  it('rejects signup that accepts a non-current version', async () => {
    const res = await signup(jsonReq('POST', {
      email: freshEmail(),
      displayName: 'StaleConsent',
      password: 'Password123',
      acceptedTosVersion: 'old',
    }))
    expect(res.status).toBe(422)
  })

  it('accepts signup with the current ToS version and records the consent', async () => {
    const email = freshEmail()
    const signupRes = await signup(jsonReq('POST', {
      email,
      displayName: 'Consented',
      password: 'Password123',
      acceptedTosVersion: '001',
    }))
    expect(signupRes.status).toBe(201)

    const setCookie = signupRes.headers.get('set-cookie') ?? ''
    const idToken = setCookie.match(/tt_id=([^;]+)/)?.[1] ?? ''
    mockAuth(idToken)

    const meTos = await (await getMyTos()).json()
    expect(meTos.accepted).toBe(true)
    expect(meTos.currentVersion).toBe('001')
    expect(meTos.acceptances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ version: '001' }),
      ])
    )
  })
})

describe('Terms of Service — current acceptance status', () => {
  it('a fresh user with no record reports accepted=false', async () => {
    // makeUser goes through the cognito.signUp helper directly, bypassing
    // the route's ToS gate — so the user exists without a consent record.
    const u = await makeUser('Bare')
    mockAuth(u.idToken)
    const res = await getMyTos()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.accepted).toBe(false)
  })

  it('an unauthenticated request gets 401', async () => {
    mockAuth(null)
    const res = await getMyTos()
    expect(res.status).toBe(401)
  })

  it('records acceptance via POST', async () => {
    const u = await makeUser('Acceptor')
    mockAuth(u.idToken)
    const res = await acceptTos(jsonReq('POST', { version: '001' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.acceptances.some((a: { version: string }) => a.version === '001')).toBe(true)
  })

  it('refuses to accept a non-current version (no future-version land grab)', async () => {
    const u = await makeUser('FutureGrabber')
    mockAuth(u.idToken)
    const res = await acceptTos(jsonReq('POST', { version: '999' }))
    expect(res.status).toBe(422)
  })

  it('repeated acceptance of the same version is idempotent', async () => {
    const u = await makeUser('DoubleAccept')
    mockAuth(u.idToken)
    await acceptTos(jsonReq('POST', { version: '001' }))
    const second = await acceptTos(jsonReq('POST', { version: '001' }))
    expect(second.status).toBe(200)
    const data = await second.json()
    expect(data.acceptances.filter((a: { version: string }) => a.version === '001')).toHaveLength(1)
  })
})

describe('Terms of Service — public document', () => {
  it('GET /att/api/legal/tos returns the current version + body without auth', async () => {
    mockAuth(null)
    const res = await getTosDoc()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.version).toBe('001')
    expect(typeof data.body).toBe('string')
    expect(data.body.length).toBeGreaterThan(100)
  })
})
