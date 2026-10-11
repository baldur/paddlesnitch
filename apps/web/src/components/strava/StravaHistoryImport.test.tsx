// @vitest-environment jsdom
// The first month of Strava paddles comes in by itself, once, with progress;
// when Strava asks us to slow down the page waits and carries on (#415).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const state = vi.hoisted(() => ({
  history: null as unknown,
  replies: [] as unknown[],
  imported: [] as number[],
  doneMarked: 0,
}))
vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ paddles: { sessions: { invalidate: async () => {} } }, sources: { stravaHistory: { fetch: async () => state.history } } }),
    sources: {
      stravaHistory: { useQuery: () => ({ data: state.history }) },
      importStravaPaddle: { useMutation: () => ({ mutateAsync: async (x: { id: number }) => { state.imported.push(x.id); return state.replies.shift() ?? { status: 'imported', sessionId: 's' } } }) },
      stravaHistoryDone: { useMutation: () => ({ mutate: () => { state.doneMarked++ } }) },
    },
  },
}))
import { StravaFirstImport } from './StravaHistoryImport'

let container: HTMLDivElement
let root: Root
afterEach(async () => { if (root) await act(async () => { root.unmount() }); container?.remove(); vi.useRealTimers(); state.imported = []; state.replies = []; state.doneMarked = 0 })
async function mount() {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<StravaFirstImport />) })
}
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: 'p', sport: 'Kayaking', startDate: '2026-10-01T07:00:00Z', distanceMetres: 5000 }))
const flush = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve() })

describe('the first month from Strava', () => {
  it('brings each paddle in, says how many, and marks it done', async () => {
    state.history = { status: 'ok', toImport: items(3), alreadyIn: 0, firstImportDone: false }
    await mount(); await flush()
    expect(state.imported).toEqual([1, 2, 3])
    expect(container.textContent).toBe('Added 3 paddles from Strava.')
    expect(state.doneMarked).toBe(1)
  })

  it('does nothing once done, or with nothing to bring in', async () => {
    state.history = { status: 'ok', toImport: items(2), alreadyIn: 0, firstImportDone: true }
    await mount(); await flush()
    expect(container.textContent).toBe('')
    expect(state.imported).toEqual([])
  })

  it('waits for Strava\'s next quarter hour when asked to slow down, then carries on', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-10-11T10:07:00'))
    state.history = { status: 'ok', toImport: items(2), alreadyIn: 0, firstImportDone: false }
    state.replies = [{ status: 'imported', sessionId: 'a' }, { status: 'skipped', reason: 'rate_limited' }]
    await mount(); await flush()
    expect(container.textContent).toContain('Strava asks us to slow down. Carrying on at 10:15 (1 of 2 so far).')
    expect(state.doneMarked).toBe(0)
    await act(async () => { await vi.advanceTimersByTimeAsync(9 * 60_000) })
    await flush()
    expect(state.imported).toEqual([1, 2, 2])
    expect(container.textContent).toBe('Added 2 paddles from Strava.')
    expect(state.doneMarked).toBe(1)
  })
})
