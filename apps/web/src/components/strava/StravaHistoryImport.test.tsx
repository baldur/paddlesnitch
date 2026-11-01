// @vitest-environment jsdom
// The first month of Strava paddles comes in by itself, once, with progress;
// when Strava asks us to slow down the page waits and carries on (#415).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const state = vi.hoisted(() => ({
  history: null as unknown,
  replies: [] as unknown[],
  imported: [] as number[],
  doneMarked: 0,
  more: null as unknown,              // what the Older paddles listing answers (an Error: it throws)
  hold: null as Promise<void> | null, // set: each import waits on it
}))
vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      paddles: { sessions: { invalidate: async () => {} } },
      sources: { stravaHistory: { fetch: async () => { if (state.more instanceof Error) throw state.more; return state.more } } },
    }),
    sources: {
      stravaHistory: { useQuery: () => ({ data: state.history }) },
      importStravaPaddle: { useMutation: () => ({ mutateAsync: async (x: { id: number }) => {
        state.imported.push(x.id)
        if (state.hold) await state.hold
        const r = state.replies.shift() ?? { status: 'imported', sessionId: 's' }
        if (r instanceof Error) throw r
        return r
      } }) },
      stravaHistoryDone: { useMutation: () => ({ mutate: () => { state.doneMarked++ } }) },
    },
  },
}))
import { StravaFirstImport, StravaImports } from './StravaHistoryImport'

let container: HTMLDivElement
let root: Root
afterEach(async () => {
  if (root) await act(async () => { root.unmount() }); container?.remove(); vi.useRealTimers()
  state.imported = []; state.replies = []; state.doneMarked = 0; state.more = null; state.hold = null
})
async function mount(ui: ReactNode = <StravaFirstImport />) {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(ui) })
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

// #716: the web says what the app says, and never a meaningless "0 of 0".
describe('older paddles from Strava', () => {
  const olderButton = () => [...container.querySelectorAll('button')].find(b => /Bring/.test(b.textContent ?? ''))!
  const startOlder = async () => { await act(async () => { olderButton().click() }); await flush() }
  // Nothing for the first month to do, so Older paddles is free.
  const firstDone = () => { state.history = { status: 'ok', toImport: [], alreadyIn: 0, firstImportDone: true } }

  it('says Strava’s limit is used up when the listing is rate limited, never "0 of 0"', async () => {
    firstDone(); state.more = { status: 'rate_limited' }
    await mount(<StravaImports />); await startOlder()
    expect(container.textContent).toContain('Strava’s limit for today is used up. Please try again tomorrow.')
    expect(container.textContent).not.toContain('0 of 0')
  })

  it('says it couldn’t bring them in when the listing fails, never "0 of 0"', async () => {
    firstDone(); state.more = new Error('network')
    await mount(<StravaImports />); await startOlder()
    expect(container.textContent).toContain('Couldn’t bring in your Strava paddles. Please try again later.')
    expect(container.textContent).not.toContain('0 of 0')
  })

  it('keeps the counts when it stops after paddles were listed', async () => {
    firstDone(); state.more = { status: 'ok', toImport: items(2), alreadyIn: 0 }
    state.replies = [{ status: 'imported', sessionId: 'a' }, new Error('network')]
    await mount(<StravaImports />); await startOlder()
    expect(container.textContent).toContain('Couldn’t bring in all your Strava paddles (1 of 2). Please try again later.')
  })

  it('cannot start while the first month is still coming in', async () => {
    let release!: () => void
    state.hold = new Promise(r => { release = r })
    state.history = { status: 'ok', toImport: items(2), alreadyIn: 0, firstImportDone: false }
    await mount(<StravaImports />); await flush()
    expect(container.textContent).toContain('Bringing in your last month from Strava')
    expect(olderButton().disabled).toBe(true)
    expect(container.querySelector('select')!.disabled).toBe(true)
    state.hold = null; release(); await flush()
    expect(container.textContent).toContain('Added 2 paddles from Strava.')
    expect(olderButton().disabled).toBe(false)
    expect(container.querySelector('select')!.disabled).toBe(false)
  })
})
