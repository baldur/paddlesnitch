// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { GET, POST, DELETE } from '@/app/api/account/contact/route'
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

describe('GET /api/account/contact', () => {
  it('returns null when the user has never set a contact', async () => {
    const u = await makeUser('Bare')
    mockAuth(u.idToken)
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ contact: null })
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuth(null)
    const res = await GET()
    expect(res.status).toBe(401)
  })
})

describe('POST /api/account/contact', () => {
  it('saves a contact email and stamps addedAt', async () => {
    const u = await makeUser('Saver')
    mockAuth(u.idToken)
    const res = await POST(jsonReq('POST', { email: 'me@example.com' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.contact.email).toBe('me@example.com')
    expect(body.contact.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('normalises to lowercase', async () => {
    const u = await makeUser('Normaliser')
    mockAuth(u.idToken)
    const res = await POST(jsonReq('POST', { email: 'Me@Example.COM' }))
    expect((await res.json()).contact.email).toBe('me@example.com')
  })

  it('preserves the original addedAt on a subsequent update', async () => {
    const u = await makeUser('Updater')
    mockAuth(u.idToken)
    const first = await (await POST(jsonReq('POST', { email: 'a@example.com' }))).json()
    // Tiny sleep to ensure a different ISO timestamp if we mistakenly bumped it.
    await new Promise(r => setTimeout(r, 10))
    const second = await (await POST(jsonReq('POST', { email: 'b@example.com' }))).json()
    expect(second.contact.email).toBe('b@example.com')
    expect(second.contact.addedAt).toBe(first.contact.addedAt)
  })

  it('rejects an obviously invalid email with 400', async () => {
    const u = await makeUser('Invalid')
    mockAuth(u.idToken)
    const res = await POST(jsonReq('POST', { email: 'not-an-email' }))
    expect(res.status).toBe(400)
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuth(null)
    const res = await POST(jsonReq('POST', { email: 'a@b.com' }))
    expect(res.status).toBe(401)
  })
})

describe('DELETE /api/account/contact', () => {
  it('clears a previously-saved contact', async () => {
    const u = await makeUser('Clearer')
    mockAuth(u.idToken)
    await POST(jsonReq('POST', { email: 'me@example.com' }))
    const del = await DELETE()
    expect(del.status).toBe(200)
    mockAuth(u.idToken)
    const after = await (await GET()).json()
    expect(after.contact).toBeNull()
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuth(null)
    const res = await DELETE()
    expect(res.status).toBe(401)
  })
})
