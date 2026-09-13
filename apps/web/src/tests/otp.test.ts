// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

// OTP route logic only — Cognito Custom Auth requires Lambda triggers that
// cognito-local doesn't support. We mock the SDK wrappers here to verify the
// route handlers themselves do the right thing (validation, error mapping,
// cookie setting, retry semantics on wrong code). The Lambda triggers
// themselves are exercised by unit tests in trigger-lambdas.test.ts; the
// happy-path Cognito integration is verified manually against real Cognito
// once SES sandbox approval lands.
vi.mock('@/lib/cognito', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cognito')>()
  return {
    ...actual,
    otpRequest: vi.fn(),
    otpVerify: vi.fn(),
    signUp: vi.fn(),
    verifyIdToken: vi.fn(),
  }
})

import { POST as otpRequest } from '@/app/att/api/auth/otp-request/route'
import { POST as otpVerify } from '@/app/att/api/auth/otp-verify/route'
import * as cognito from '@/lib/cognito'

let dataDir: string
beforeEach(async () => {
  dataDir = await makeDataDir()
  vi.mocked(cognito.otpRequest).mockReset()
  vi.mocked(cognito.otpVerify).mockReset()
  vi.mocked(cognito.signUp).mockReset()
  vi.mocked(cognito.verifyIdToken).mockReset()
})
afterEach(async () => { await cleanDataDir(dataDir) })

// Real clients post anti-bot fields (an empty honeypot + the elapsed time
// since the form loaded). Default to a human-like submission so the existing
// cases sail through the gate; bot tests override `website` / `elapsedMs`.
function jsonReq(body: Record<string, unknown>) {
  return new NextRequest('http://x', {
    method: 'POST',
    body: JSON.stringify({ website: '', elapsedMs: 5_000, ...body }),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /att/api/auth/otp-request', () => {
  it('returns the session token from cognito on success', async () => {
    vi.mocked(cognito.otpRequest).mockResolvedValue({ session: 'sess-abc' })
    const res = await otpRequest(jsonReq({ email: 'alice@example.com' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ session: 'sess-abc' })
  })

  it('signs up the user on the fly when Cognito reports user not found', async () => {
    vi.mocked(cognito.otpRequest)
      .mockResolvedValueOnce({ error: 'user_not_found' })
      .mockResolvedValueOnce({ session: 'sess-new' })
    vi.mocked(cognito.signUp).mockResolvedValue({ sub: 'new-sub-1' })

    const res = await otpRequest(jsonReq({ email: 'newuser@example.com' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ session: 'sess-new' })
    expect(cognito.signUp).toHaveBeenCalledTimes(1)
  })

  it('returns 400 when email is missing', async () => {
    const res = await otpRequest(jsonReq({}))
    expect(res.status).toBe(400)
  })

  it('returns 500 when cognito returns an unknown error', async () => {
    vi.mocked(cognito.otpRequest).mockResolvedValue({ error: 'unknown' })
    const res = await otpRequest(jsonReq({ email: 'a@b.c' }))
    expect(res.status).toBe(500)
  })

  it('drops a populated-honeypot submission without sending mail or creating a user', async () => {
    const res = await otpRequest(jsonReq({ email: 'bot@example.com', website: 'http://spam.example' }))
    // Success-looking response so the bot gets no signal...
    expect(res.status).toBe(200)
    expect((await res.json()).session).toBeTruthy()
    // ...but no Cognito work happened: no email sent, no account churned.
    expect(cognito.otpRequest).not.toHaveBeenCalled()
    expect(cognito.signUp).not.toHaveBeenCalled()
  })

  it('drops an instantly-submitted form (faster than a human) the same way', async () => {
    const res = await otpRequest(jsonReq({ email: 'bot@example.com', elapsedMs: 50 }))
    expect(res.status).toBe(200)
    expect(cognito.otpRequest).not.toHaveBeenCalled()
    expect(cognito.signUp).not.toHaveBeenCalled()
  })
})

describe('POST /att/api/auth/otp-verify', () => {
  it('sets tt_id + tt_refresh on success', async () => {
    vi.mocked(cognito.otpVerify).mockResolvedValue({
      idToken: 'id-token-xxx',
      refreshToken: 'refresh-token-xxx',
    })
    vi.mocked(cognito.verifyIdToken).mockResolvedValue({
      id: 'sub-1',
      email: 'alice@example.com',
      displayName: 'Alice',
    })

    const res = await otpVerify(jsonReq({ email: 'alice@example.com', session: 'sess', code: '123456' }))
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('tt_id=')
    expect(setCookie).toContain('tt_refresh=')
  })

  it('returns 400 with a new session when the wrong code was given but retries remain', async () => {
    vi.mocked(cognito.otpVerify).mockResolvedValue({ needsAnotherTry: true, session: 'sess-2' })

    const res = await otpVerify(jsonReq({ email: 'alice@example.com', session: 'sess-1', code: '000000' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.session).toBe('sess-2')
  })

  it('returns 400 when cognito reports the code is invalid (no retries left)', async () => {
    vi.mocked(cognito.otpVerify).mockResolvedValue({ error: 'invalid_code' })

    const res = await otpVerify(jsonReq({ email: 'alice@example.com', session: 'sess', code: '000000' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.session).toBeUndefined()
  })

  it('returns 400 when fields are missing', async () => {
    const res = await otpVerify(jsonReq({ email: 'a@b.c' }))
    expect(res.status).toBe(400)
  })
})
