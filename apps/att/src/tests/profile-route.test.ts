// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { GET as getProfile, PATCH as patchProfile } from '@/app/api/account/profile/route'
import { cookies } from 'next/headers'

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir) })

function mockAuth(idToken: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => name === 'tt_id' && idToken ? { name, value: idToken } : undefined,
  } as ReturnType<typeof cookies> extends Promise<infer T> ? T : never)
}

function patchReq(body: unknown) {
  return new NextRequest('http://x/api/account/profile', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('GET/PATCH /api/account/profile', () => {
  it('returns 401 when not signed in', async () => {
    mockAuth(null)
    expect((await getProfile()).status).toBe(401)
    expect((await patchProfile(patchReq({ public: true }))).status).toBe(401)
  })

  it('defaults to private then flips public', async () => {
    const u = await makeUser()
    mockAuth(u.idToken)
    expect(await (await getProfile()).json()).toEqual({ public: false })

    const patched = await patchProfile(patchReq({ public: true }))
    expect(patched.status).toBe(200)
    expect(await patched.json()).toEqual({ public: true })
    expect(await (await getProfile()).json()).toEqual({ public: true })
  })

  it('rejects a non-boolean public value', async () => {
    const u = await makeUser()
    mockAuth(u.idToken)
    expect((await patchProfile(patchReq({ public: 'yes' }))).status).toBe(400)
  })
})
