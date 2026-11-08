// @vitest-environment jsdom
// Pace must be editable on a phone (#918): the field has to be clearable so you
// can retype it. The old code bound value to draft.paceKmh and rejected every
// out-of-range input (including the empty string), so clearing the field to
// retype snapped the old number straight back and the value got stuck.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { httpBatchLink } from '@trpc/client'
import { getQueryKey } from '@trpc/react-query'
import { trpc } from '@/lib/trpc'
import type { PlanDraft } from '@/lib/plan-ui'
import Planner from './Planner'

const replace = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href?: string }) => <a href={href}>{children}</a> }))
vi.mock('@/components/map/PlanMapClient', () => ({ default: () => <div data-testid="map" /> }))
vi.mock('./EndSearch', () => ({ default: () => <div data-testid="end-search" /> }))

let container: HTMLDivElement
let root: Root
afterEach(async () => { await act(async () => { root.unmount() }); container.remove(); replace.mockClear() })

const DRAFT: PlanDraft = { start: null, finish: null, shape: 'one_way', paceKmh: 8, portageMinutes: 3 }

async function mount(initial: PlanDraft = DRAFT) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  // Signed out: portage.mine and the route query stay disabled, so nothing fetches.
  qc.setQueryData(getQueryKey(trpc.me, undefined, 'query'), { user: null })
  const client = trpc.createClient({ links: [httpBatchLink({ url: 'http://localhost/api/trpc' })] })
  await act(async () => {
    root.render(<trpc.Provider client={client} queryClient={qc}><QueryClientProvider client={qc}><Planner initial={initial} /></QueryClientProvider></trpc.Provider>)
  })
}

const pace = () => container.querySelector<HTMLInputElement>('#plan-pace')!

// React tracks the input's value; set it through the native setter so the
// change event carries the new value, the way a real keypress would.
async function typeValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}
const blur = async (el: HTMLInputElement) => { await act(async () => { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) }) }

describe('Plan pace field on a phone (#918)', () => {
  it('can be cleared to empty instead of snapping back to the old number', async () => {
    await mount()
    expect(pace().value).toBe('8')
    await typeValue(pace(), '')
    // The bug: the field refused to go empty, so you could never start retyping.
    expect(pace().value).toBe('')
  })

  it('takes a retyped value and feeds it to the draft', async () => {
    await mount()
    await typeValue(pace(), '')
    await typeValue(pace(), '12')
    expect(pace().value).toBe('12')
    // The draft followed: the plan link the effect writes carries pace=12.
    expect(replace).toHaveBeenLastCalledWith(expect.stringContaining('pace=12'), expect.anything())
  })

  it('clamps an out-of-range number to 1–30 on blur', async () => {
    await mount()
    await typeValue(pace(), '40')
    await blur(pace())
    expect(pace().value).toBe('30')
    expect(replace).toHaveBeenLastCalledWith(expect.stringContaining('pace=30'), expect.anything())
  })
})
