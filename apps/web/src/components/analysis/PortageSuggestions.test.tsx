// @vitest-environment jsdom
// Carries on this paddle: suggestions drawn, publish only after the CC0 tick,
// and nothing at all when there's nothing to suggest.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const state = vi.hoisted(() => ({ data: [] as unknown[], added: [] as unknown[] }))
vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ portage: { fromPaddle: { invalidate: () => {} } } }),
    portage: {
      fromPaddle: { useQuery: () => ({ data: state.data }) },
      add: { useMutation: (o: { onSuccess: () => void }) => ({ isPending: false, isError: false, mutate: (v: unknown) => { state.added.push(v); o.onSuccess() } }) },
    },
  },
}))

import PortageSuggestions from './PortageSuggestions'

let container: HTMLDivElement
let root: Root
afterEach(async () => { if (root) await act(async () => { root.unmount() }); container?.remove(); state.data = []; state.added = [] })

const points = Array.from({ length: 40 }, (_, i) => ({ lat: 51.5286, lng: -0.9 + i * 0.001 }))
const suggestion = { featureId: 'ea-lock:marsh', name: 'Marsh Lock', at: [51.5286, -0.8855], landings: [[51.5287, -0.8864], [51.5287, -0.8846]], carryM: 130, minutes: 2 }

async function mount() {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<PortageSuggestions sessionId="p1" points={points} />) })
}

describe('carries on this paddle', () => {
  it('draws the suggestion and publishes only once you release it under CC0', async () => {
    state.data = [suggestion]
    await mount()
    expect(container.textContent).toContain('Marsh Lock')
    expect(container.textContent).toContain('about 130 m and 2 min')
    expect(container.querySelector('[data-testid="portage-drawing"]')).not.toBeNull()
    const publish = [...container.querySelectorAll('button')].find(b => b.textContent === 'Publish')!
    expect(publish.disabled).toBe(true)
    await act(async () => { (container.querySelector('input[aria-label="Release under CC0"]') as HTMLInputElement).click() })
    await act(async () => { publish.click() })
    expect(state.added).toEqual([{ featureId: 'ea-lock:marsh', at: suggestion.at, landings: suggestion.landings, cc0: true }])
    expect(container.textContent).toContain('Published, thank you')
  })

  it('shows nothing when the paddle passes no lock it could have carried round', async () => {
    await mount()
    expect(container.querySelector('[data-testid="portage-suggestions"]')).toBeNull()
  })
})
