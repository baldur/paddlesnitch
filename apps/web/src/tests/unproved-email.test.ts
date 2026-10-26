// @vitest-environment node
// #713: anyone can set their own email to another person's address through
// Cognito's public client. It stays unverified, so an email proves nothing
// unless the token says email_verified. These records are keyed by email.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'
import type { AuthUser } from '@/lib/types'

vi.mock('@/lib/auth', async (orig) => ({ ...(await orig<typeof import('@/lib/auth')>()), getRequestUser: vi.fn(), getAuthUser: vi.fn() }))
vi.mock('@/lib/app-signin', async (orig) => ({ ...(await orig<typeof import('@/lib/app-signin')>()), hasRecentSignIn: vi.fn(async () => true) }))
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: () => undefined, delete: vi.fn(), set: vi.fn() })) }))

import { getRequestUser } from '@/lib/auth'
import { verifyIdToken } from '@/lib/cognito'
import { buildAccountExport } from '@/lib/account-export'
import { saveBetaApplication, getBetaApplication } from '@/lib/beta-signups'
import { DELETE as deleteAccount } from '@/app/api/account/route'

const victim = 'victim-713@example.com'
let dir: string
beforeEach(async () => {
  dir = await makeDataDir()
  await saveBetaApplication({ name: 'Vic', email: victim, sport: 'kayak', frequency: 'weekly' } as never)
})
afterEach(async () => { await cleanDataDir(dir); vi.clearAllMocks() })

const squatter = (emailVerified: boolean): AuthUser => ({ id: 'squatter-sub', email: victim, displayName: 'S', emailVerified })

describe('an email the account never proved', () => {
  it('a real sign-in token carries email_verified', async () => {
    const me = await makeUser('Me')
    expect(await verifyIdToken(me.idToken)).toMatchObject({ email: me.email, emailVerified: true })
  })

  it('doesn\'t bring someone else\'s beta application into the export', async () => {
    expect((await buildAccountExport(squatter(false))).betaApplication).toBeNull()
    expect((await buildAccountExport(squatter(true))).betaApplication).toMatchObject({ email: victim })
  })

  it('doesn\'t delete someone else\'s beta application with the account', async () => {
    vi.mocked(getRequestUser).mockResolvedValue(squatter(false))
    const res = await deleteAccount(new Request('http://x', { method: 'DELETE', body: '{}' }))
    expect(res.status).toBe(200)
    expect(await getBetaApplication(victim)).not.toBeNull()
  })
})
