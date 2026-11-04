// @vitest-environment jsdom
// Adding a paddle must refresh the Paddles list, or the new paddle is missing
// from the feed for up to PREFILLED_FRESH_MS after the upload (#865). The delete
// path already invalidates; the upload path didn't.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const state = vi.hoisted(() => ({ invalidated: 0, replaced: [] as string[] }))

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      paddles: { sessions: { invalidate: () => { state.invalidated++; return Promise.resolve() } } },
      sources: { trials: { fetch: () => Promise.resolve([]) } },
    }),
    me: { useQuery: () => ({ isPending: false, data: { user: { id: 'u1' } } }) },
  },
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: (p: string) => { state.replaced.push(p) } }) }))
vi.mock('@/lib/trace-upload', () => ({
  prepareTraceUpload: (f: File) => Promise.resolve(f),
  uploadErrorMessage: () => 'Couldn’t analyse that paddle.',
  TOO_BIG_MESSAGE: 'too big',
}))
vi.mock('@/components/AppHeader', () => ({ default: () => null }))
vi.mock('@/components/analysis/AnalysisView', () => ({ default: () => null }))

import AddPaddlePage from './page'

let container: HTMLDivElement
let root: Root
let fetchResult: unknown

beforeEach(() => {
  state.invalidated = 0; state.replaced = []
  vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: () => Promise.resolve(fetchResult) }))
})
afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  vi.unstubAllGlobals()
})

async function mountAndUpload() {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<AddPaddlePage />) })
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File(['<gpx/>'], 'paddle.gpx', { type: 'application/gpx+xml' })
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  const add = [...container.querySelectorAll('button')].find(b => b.textContent === 'Add paddle')!
  await act(async () => { add.click() })
  // let the async analyse() resolve
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

describe('add a paddle refreshes the feed', () => {
  it('invalidates the Paddles list before navigating to the new paddle', async () => {
    fetchResult = { id: 'new1' }
    await mountAndUpload()
    expect(state.invalidated).toBe(1)
    expect(state.replaced).toEqual(['/paddles/new1'])
  })

  it('does not invalidate the list for a duplicate (nothing new was added)', async () => {
    fetchResult = { id: 'dup1', duplicate: true }
    await mountAndUpload()
    expect(state.invalidated).toBe(0)
    expect(state.replaced).toEqual([])
    expect(container.textContent).toContain('already added this paddle')
  })
})
