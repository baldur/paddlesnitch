// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// The view itself is tested elsewhere: here only what SavedPaddle passes it.
vi.mock('@/components/analysis/AnalysisView', () => ({
  default: (p: { data: { insight: string }; summaryPending?: boolean }) => <div>{p.data.insight}{p.summaryPending ? ' | pending' : ''}</div>,
}))
const t = vi.hoisted(() => ({ data: null as null | Record<string, unknown>, mutate: vi.fn() }))
vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ paddles: { get: { setData: () => {} } } }),
    paddles: {
      get: { useQuery: () => ({ isPending: false, isError: false, data: t.data }) },
      writeSummary: { useMutation: () => ({ mutate: t.mutate, isError: false }) },
    },
  },
}))

import SavedPaddle from './SavedPaddle'

let container: HTMLDivElement, root: Root
afterEach(async () => { await act(async () => { root.unmount() }); container.remove(); t.mutate.mockReset() })
async function mount() {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  await act(async () => { root.render(<SavedPaddle id="p1" />) })
  await act(async () => { root.render(<SavedPaddle id="p1" />) })   // a re-render must not ask twice
}
const paddle = (extra: object) => ({ id: 'p1', paddledAt: '2026-10-08T09:00:00Z', source: { type: 'file' }, note: '', result: { insight: 'Plain summary.' }, ...extra })

describe('SavedPaddle', () => {
  it('asks once for a pending summary and says it is being written', async () => {
    t.data = paddle({ insightPending: true })
    await mount()
    expect(t.mutate).toHaveBeenCalledTimes(1)
    expect(t.mutate).toHaveBeenCalledWith({ id: 'p1' })
    expect(container.textContent).toBe('Plain summary. | pending')
  })

  it('asks for nothing when the summary is written', async () => {
    t.data = paddle({})
    await mount()
    expect(t.mutate).not.toHaveBeenCalled()
    expect(container.textContent).toBe('Plain summary.')
  })
})
