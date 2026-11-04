// @vitest-environment jsdom
// #865: adding a paddle must refresh the Paddles list. The list query is cached
// fresh for 30 s (PREFILLED_FRESH_MS), so without invalidating it on a
// successful upload the feed kept the old set and the new paddle was missing
// for up to 30 s. The delete path already invalidates — the upload path didn't.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const spies = vi.hoisted(() => ({
  invalidate: vi.fn(() => Promise.resolve()),
  replace: vi.fn(),
}))

vi.mock('@/components/AppHeader', () => ({ default: () => null }))
vi.mock('@/components/analysis/AnalysisView', () => ({ default: () => null }))
vi.mock('@/components/LoadingState', () => ({ default: () => null }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href?: string }) => <a href={href}>{children}</a> }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: spies.replace }) }))
vi.mock('@/lib/trace-upload', () => ({
  prepareTraceUpload: (f: File) => Promise.resolve(f),
  uploadErrorMessage: (_s: number, _b: unknown, fallback: string) => fallback,
  TOO_BIG_MESSAGE: 'too big',
}))
vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      paddles: { sessions: { invalidate: spies.invalidate } },
      sources: { trials: { fetch: () => Promise.resolve([]) } },
    }),
    me: { useQuery: () => ({ isPending: false, data: { user: { id: 'u1' } } }) },
  },
}))

import AddPaddlePage from './page'

let container: HTMLDivElement
let root: Root
afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  vi.restoreAllMocks()
  spies.invalidate.mockClear()
  spies.replace.mockClear()
})

async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() })
}

describe('adding a paddle refreshes the feed (#865)', () => {
  it('invalidates the Paddles list before navigating to the new paddle', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ id: 'new1' }),
    } as Response)))

    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => { root.render(<AddPaddlePage />) })

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['<gpx></gpx>'], 'paddle.gpx', { type: 'application/gpx+xml' })
    Object.defineProperty(input, 'files', { value: [file] })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })

    const add = [...container.querySelectorAll('button')].find(b => b.textContent === 'Add paddle')!
    await act(async () => { add.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flush()

    expect(spies.invalidate).toHaveBeenCalledTimes(1)
    expect(spies.replace).toHaveBeenCalledWith('/paddles/new1')
  })
})
