// @vitest-environment node
// Data in the first HTML (performance.md, phase 2): the server pages put the
// viewer's own data in the query cache, under the keys the client reads, and
// nothing for anyone else.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import type { DehydratedState } from '@tanstack/react-query'

const auth = vi.hoisted(() => ({ user: null as null | { id: string; email: string; displayName: string } }))
vi.mock('@/lib/auth', () => ({ getAuthUser: async () => auth.user }))

import { prefetch, trpcQueryKey } from '@/lib/trpc-server'
import PaddlesPage from '@/app/paddles/page'
import SavedPaddlePage from '@/app/paddles/[id]/page'

const PAT = { id: 'user-1', email: 'p@example.com', displayName: 'Pat' }

async function writeSession(dir: string, userId: string, id: string) {
  const p = path.join(dir, 'analysis', userId, id)
  await fs.mkdir(p, { recursive: true })
  await fs.writeFile(path.join(p, 'session.json'), JSON.stringify({
    id, paddledAt: '2026-09-01T10:00:00.000Z', source: { type: 'file' },
    result: { distanceKm: 4, durationS: 1200, cruiseSpeed: 3.1, avgSR: 60, surges: [], points: [] },
  }))
}

// What a server page hands the client: the dehydrated cache in its props.
function cached(el: unknown): Map<string, unknown> {
  const state = (el as { props: { state: DehydratedState } }).props.state
  return new Map(state.queries.map(q => [JSON.stringify(q.queryKey), q.state.data]))
}
const key = (p: string, input?: unknown) => JSON.stringify(trpcQueryKey(p, input))

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'first-html-'))
  process.env.USE_LOCAL_STORAGE = 'true'
  process.env.DATA_DIR = dir
  auth.user = PAT
})
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); delete process.env.DATA_DIR })

describe('data in the first HTML', () => {
  it('PADDLES carries who is signed in and their paddles', async () => {
    await writeSession(dir, PAT.id, 'aaa')
    const c = cached(await PaddlesPage())
    expect(c.get(key('me'))).toEqual({ user: PAT })
    expect((c.get(key('paddles.sessions')) as { id: string }[]).map(s => s.id)).toEqual(['aaa'])
  })

  it('signed out, PADDLES carries only "nobody" and asks for no paddles', async () => {
    auth.user = null
    const c = cached(await PaddlesPage())
    expect(c.get(key('me'))).toEqual({ user: null })
    expect(c.has(key('paddles.sessions'))).toBe(false)
  })

  it('a paddle page carries the paddle', async () => {
    await writeSession(dir, PAT.id, 'aaa')
    const c = cached(await SavedPaddlePage({ params: Promise.resolve({ id: 'aaa' }) }))
    expect((c.get(key('paddles.get', { id: 'aaa' })) as { id: string }).id).toBe('aaa')
  })

  it("someone else's paddle is not prefilled (the page says it can't find it, as before)", async () => {
    await writeSession(dir, 'someone-else', 'zzz')
    const c = cached(await SavedPaddlePage({ params: Promise.resolve({ id: 'zzz' }) }))
    expect(c.has(key('paddles.get', { id: 'zzz' }))).toBe(false)
  })

  it('a failing procedure is left out rather than failing the page', async () => {
    const pre = await prefetch()
    expect(await pre.query('paddles.get', { id: 'x' }, async () => { throw new Error('boom') })).toBeUndefined()
    expect(pre.state().queries.map(q => q.queryKey[0])).toEqual([['me']])
  })
})
