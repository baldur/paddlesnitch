// @vitest-environment node
// DELETE /api/account marks the account deleted BEFORE erasing anything (C3):
// a phone holding its token must stop uploading even while erasure runs, and
// even if a step fails half way.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
const seen = vi.hoisted(() => ({ markedWhenErasing: null as boolean | null }))
vi.mock('@paddlesnitch/analysis/analysis-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@paddlesnitch/analysis/analysis-store')>()),
  eraseUserAnalysis: async (userId: string) => {
    const { erasureState } = await import('@paddlesnitch/core/erased')
    seen.markedWhenErasing = (await erasureState(userId)) === 'pending'
    throw new Error('storage down')
  },
}))

import { cookies } from 'next/headers'
import { DELETE as deleteAccount } from '@/app/api/account/route'
import { isAccountErased, erasureState } from '@paddlesnitch/core/erased'

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir(); seen.markedWhenErasing = null })
afterEach(async () => { await cleanDataDir(dataDir) })

describe('erasure marks the account first', () => {
  it('is marked pending before the paddles go; a failed delete never reads as deleted', async () => {
    const me = await makeUser('Half Erased')
    vi.mocked(cookies).mockResolvedValue({ get: (n: string) => (n === 'tt_id' ? { name: n, value: me.idToken } : undefined) } as never)
    await expect(deleteAccount(new Request('http://x'))).rejects.toThrow('storage down')
    expect(seen.markedWhenErasing).toBe(true)
    // The account is still live: phones wait (503), they never delete (410).
    expect(await erasureState(me.id)).toBe('pending')
    expect(await isAccountErased(me.id)).toBe(false)
  })
})
