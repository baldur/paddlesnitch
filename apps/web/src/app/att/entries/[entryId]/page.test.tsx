// @vitest-environment jsdom
// Your own trial result opens as a paddle (site review, 2026-10): Trials and
// Paddles were two worlds with no way across.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('@/components/AppHeader', () => ({ default: () => <header>HEADER</header> }))
vi.mock('@/components/map/CourseMapClient', () => ({ default: () => null }))

import EntryDetailPage from './page'

let container: HTMLDivElement
let root: Root
afterEach(async () => { if (root) await act(async () => { root.unmount() }); container?.remove(); vi.unstubAllGlobals() })

const detail = (isOwner: boolean) => ({
  entry: { entryId: 'e1', userId: 'u1', displayName: 'Pat', raceDate: '2026-10-01', submittedAt: '2026-10-01T10:00:00Z', boatClass: 'K1', crew: [], totalElapsedSeconds: 250, splits: [] },
  isOwner, trial: { id: 't1', name: 'Autumn TT', date: '2026-10-01', status: 'open' }, course: null,
})

async function mount(isOwner: boolean, fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.startsWith('/att/api/entries') ? detail(isOwner) : { id: 'p9' })))) {
  vi.stubGlobal('fetch', fetchMock)
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<EntryDetailPage params={Promise.resolve({ entryId: 'e1' })} />) })
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  return fetchMock
}
const button = () => Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('OPEN AS A PADDLE'))

describe('a trial result opens as a paddle', () => {
  it('offers it to the owner and analyses that entry', async () => {
    const fetchMock = await mount(true)
    expect(button()).toBeTruthy()
    await act(async () => { button()!.click() })
    const call = fetchMock.mock.calls.find(([u]) => u === '/paddles/api/analyse') as unknown as [string, RequestInit]
    const body = call[1].body as FormData
    expect(body.get('trialEntryId')).toBe('e1')
    expect(body.get('trialId')).toBe('t1')
  })

  it("isn't offered on someone else's result", async () => {
    await mount(false)
    expect(container.textContent).toContain('Autumn TT')
    expect(button()).toBeUndefined()
  })
})
