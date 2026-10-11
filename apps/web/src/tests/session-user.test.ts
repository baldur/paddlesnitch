// @vitest-environment node
// The header's user comes from the server with the page (#411): who, without
// the email, and "can't tell" (so the header asks) rather than a wrong
// "signed out" when a session cookie couldn't be confirmed.
import { describe, it, expect, vi } from 'vitest'
import { makeUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
import { cookies } from 'next/headers'
import { sessionUser } from '@/lib/session-user'

function withCookies(c: Record<string, string>) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (c[name] ? { name, value: c[name] } : undefined),
    set: () => { throw new Error('read-only here') },
  } as never)
}

describe("the header's user, from the server", () => {
  it('signed in: id and name only, never the email', async () => {
    const u = await makeUser('Sam')
    withCookies({ tt_id: u.idToken })
    const who = await sessionUser()
    expect(Object.keys(who ?? {}).sort()).toEqual(['displayName', 'id'])
    expect(who?.id).toBe(u.id)
    expect(JSON.stringify(who)).not.toContain('@')
  })

  it('no session cookies: signed out', async () => {
    withCookies({})
    expect(await sessionUser()).toBeNull()
  })

  it("a session that can't be confirmed here: unknown, so the header asks", async () => {
    withCookies({ tt_id: 'not-a-token', tt_refresh: 'not-a-refresh-token' })
    expect(await sessionUser()).toBeUndefined()
  })
})
