// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { GET as checkHandle, PUT as putHandle, DELETE as deleteHandle } from '@/app/api/account/handle/route'
import { cookies } from 'next/headers'

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir) })

function mockAuth(idToken: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => name === 'tt_id' && idToken ? { name, value: idToken } : undefined,
  } as ReturnType<typeof cookies> extends Promise<infer T> ? T : never)
}

const putReq = (handle: unknown) => new NextRequest('http://x/api/account/handle', {
  method: 'PUT', body: JSON.stringify({ handle }), headers: { 'Content-Type': 'application/json' },
})
const checkReq = (slug: string) => new NextRequest(`http://x/api/account/handle?check=${encodeURIComponent(slug)}`)

describe('/api/account/handle', () => {
  it('requires auth', async () => {
    mockAuth(null)
    expect((await checkHandle(checkReq('foo'))).status).toBe(401)
    expect((await putHandle(putReq('foo'))).status).toBe(401)
    expect((await deleteHandle()).status).toBe(401)
  })

  it('claims, reports availability, and rejects a taken handle', async () => {
    const a = await makeUser('A')
    const b = await makeUser('B')

    mockAuth(a.idToken)
    expect(await (await checkHandle(checkReq('coxless'))).json()).toMatchObject({ available: true })
    const claimed = await putHandle(putReq('coxless'))
    expect(claimed.status).toBe(200)
    expect((await claimed.json()).handle).toBe('coxless')

    // b sees it as unavailable and gets 400 on claim.
    mockAuth(b.idToken)
    expect(await (await checkHandle(checkReq('coxless'))).json()).toMatchObject({ available: false })
    expect((await putHandle(putReq('coxless'))).status).toBe(400)
  })

  it('rejects an invalid handle', async () => {
    const u = await makeUser()
    mockAuth(u.idToken)
    expect((await putHandle(putReq('no'))).status).toBe(400)       // too short
    expect((await putHandle(putReq('admin'))).status).toBe(400)    // reserved
  })

  it('releases a handle', async () => {
    const u = await makeUser()
    mockAuth(u.idToken)
    await putHandle(putReq('letmego'))
    const released = await deleteHandle()
    expect(released.status).toBe(200)
    expect((await released.json()).handle).toBeUndefined()
    // Now available again.
    expect(await (await checkHandle(checkReq('letmego'))).json()).toMatchObject({ available: true })
  })
})
