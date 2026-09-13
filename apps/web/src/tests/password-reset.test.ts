// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'
import { readConfirmationCode } from './cognito-db'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { POST as requestReset } from '@/app/att/api/auth/password-reset/request/route'
import { POST as confirmReset } from '@/app/att/api/auth/password-reset/confirm/route'
import { POST as login } from '@/app/att/api/auth/login/route'
import * as cognito from '@/lib/cognito'

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir); vi.restoreAllMocks() })

// Real clients post anti-bot fields (an empty honeypot + the elapsed time
// since the form loaded). Default to a human-like submission so the existing
// cases sail through the gate; the bot test overrides them.
function jsonReq(url: string, body: Record<string, unknown>) {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify({ website: '', elapsedMs: 5_000, ...body }),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /att/api/auth/password-reset/request', () => {
  it('returns 200 and sets a ConfirmationCode on the user', async () => {
    const user = await makeUser()
    const res = await requestReset(jsonReq('http://x', { email: user.email }))
    expect(res.status).toBe(200)
    const code = await readConfirmationCode(user.email)
    expect(code).toMatch(/^\d{6}$/)
  })

  it('returns 200 for an unknown email (no account-existence leak)', async () => {
    const res = await requestReset(jsonReq('http://x', { email: 'nobody-' + Date.now() + '@example.com' }))
    expect(res.status).toBe(200)
  })

  it('returns 400 when email is missing', async () => {
    const res = await requestReset(jsonReq('http://x', {}))
    expect(res.status).toBe(400)
  })

  it('drops a bot submission (populated honeypot) without emailing a code', async () => {
    const user = await makeUser()
    // Deterministic: assert forgotPassword was never invoked, rather than
    // diffing the cognito-local db file (whose signup ConfirmationCode is
    // written asynchronously and races with the read — the old flake).
    const spy = vi.spyOn(cognito, 'forgotPassword').mockResolvedValue({ ok: true })
    const res = await requestReset(jsonReq('http://x', { email: user.email, website: 'http://spam.example' }))
    // Same { ok: true } a real request gets — no signal to the bot...
    expect(res.status).toBe(200)
    // ...and the gate dropped it before any Cognito email work.
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('POST /att/api/auth/password-reset/confirm', () => {
  it('accepts a valid code and lets the user sign in with the new password', async () => {
    const user = await makeUser()
    await requestReset(jsonReq('http://x', { email: user.email }))
    const code = await readConfirmationCode(user.email)
    expect(code).not.toBeNull()

    const newPassword = 'BrandNew99'
    const res = await confirmReset(jsonReq('http://x', { email: user.email, code, password: newPassword }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)

    // Old password no longer works.
    const oldLogin = await login(jsonReq('http://x', { email: user.email, password: 'Password123' }))
    expect(oldLogin.status).toBe(401)

    // New password works.
    const newLogin = await login(jsonReq('http://x', { email: user.email, password: newPassword }))
    expect(newLogin.status).toBe(200)
  })

  it('rejects a wrong code', async () => {
    const user = await makeUser()
    await requestReset(jsonReq('http://x', { email: user.email }))
    const res = await confirmReset(jsonReq('http://x', {
      email: user.email,
      code: '000000',
      password: 'BrandNew99',
    }))
    expect(res.status).toBe(400)
  })

  it('rejects a too-short password', async () => {
    const user = await makeUser()
    await requestReset(jsonReq('http://x', { email: user.email }))
    const code = await readConfirmationCode(user.email)
    const res = await confirmReset(jsonReq('http://x', {
      email: user.email,
      code,
      password: 'short',
    }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when any field is missing', async () => {
    const user = await makeUser()
    const res = await confirmReset(jsonReq('http://x', { email: user.email }))
    expect(res.status).toBe(400)
  })
})
