// @vitest-environment node
// The sign-in lasts 30 days, not 24 hours: when the ID token (tt_id, 24 h) has
// expired or is missing, getAuthUser() swaps the refresh token (tt_refresh,
// 30 d) for a new one, silently. It had no test ("manual smoke only"); if it
// broke, everyone would be signed out daily.
import { describe, it, expect, vi } from 'vitest'
import { makeUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
import { cookies } from 'next/headers'
import { getAuthUser } from '@paddlesnitch/core/auth'

function jar(values: Record<string, string>, opts: { readOnly?: boolean } = {}) {
  const set = vi.fn((name: string, value: string) => {
    if (opts.readOnly) throw new Error('Cookies can only be modified in a Server Action or Route Handler')
    values[name] = value
  })
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name in values ? { name, value: values[name] } : undefined),
    set, delete: vi.fn(),
  } as never)
  return { values, set }
}

describe('staying signed in', () => {
  it('a valid ID token is enough: no refresh', async () => {
    const u = await makeUser('Fresh')
    const j = jar({ tt_id: u.idToken, tt_refresh: u.refreshToken })
    expect((await getAuthUser())?.id).toBe(u.id)
    expect(j.set).not.toHaveBeenCalled()
  })

  it('an expired or broken ID token is replaced from the refresh token, and the new one is set', async () => {
    const u = await makeUser('Returning')
    const j = jar({ tt_id: 'not-a-valid-jwt', tt_refresh: u.refreshToken })
    expect((await getAuthUser())?.id).toBe(u.id)
    expect(j.set).toHaveBeenCalledWith('tt_id', expect.any(String), expect.objectContaining({ httpOnly: true }))
    // The new token works on its own on the next request.
    jar({ tt_id: j.values.tt_id })
    expect((await getAuthUser())?.id).toBe(u.id)
  })

  it('with only the refresh token left (the ID cookie expired away), still signed in', async () => {
    const u = await makeUser('Week later')
    jar({ tt_refresh: u.refreshToken })
    expect((await getAuthUser())?.id).toBe(u.id)
  })

  it('on a page that cannot set cookies, the user is still known (the cookie is set next time)', async () => {
    const u = await makeUser('Server page')
    jar({ tt_refresh: u.refreshToken }, { readOnly: true })
    expect((await getAuthUser())?.id).toBe(u.id)
  })

  it('a refresh token that is not valid signs nobody in', async () => {
    jar({ tt_id: 'nope', tt_refresh: 'also-nope' })
    expect(await getAuthUser()).toBeNull()
    jar({})
    expect(await getAuthUser()).toBeNull()
  })
})
