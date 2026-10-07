// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { httpBatchLink } from '@trpc/client'
import AnalysisView, { type ViewData } from './AnalysisView'
import { trpc } from '@/lib/trpc'
import { getQueryKey } from '@trpc/react-query'

// On a phone the floating panels obscure the map and the segment list is cut
// off behind the replay scrubber. The paddler can now minimise the summary and
// the segments panels to reveal the map. (#187)

// The Leaflet map + next router/link aren't relevant here — stub them so the
// panels render in jsdom.
vi.mock('@/components/map/AnalysisMapClient', () => ({ default: () => null }))
vi.mock('@/components/AppHeader', () => ({ default: ({ breadcrumb }: { breadcrumb?: React.ReactNode }) => <header>{breadcrumb}</header> }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href?: string }) => <a href={href}>{children}</a> }))

let container: HTMLDivElement
let root: Root

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  vi.restoreAllMocks()
})

// AnalysisView calls tRPC hooks (mutations + query utils), so it must render
// inside the tRPC + React Query providers. The client points at a dummy URL —
// these tests only render + toggle panels, they never fire a request.
async function mount(node: React.ReactNode, prefill?: (qc: QueryClient) => void) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  prefill?.(qc)
  const client = trpc.createClient({ links: [httpBatchLink({ url: 'http://localhost/api/trpc' })] })
  await act(async () => {
    root.render(
      <trpc.Provider client={client} queryClient={qc}>
        <QueryClientProvider client={qc}>{node}</QueryClientProvider>
      </trpc.Provider>,
    )
  })
}

const surge = {
  kind: 'surge' as const, fromT: 10, toT: 40, durS: 30, distM: 100,
  avgSpeed: 4, splitPer500: 125, avgSR: 70, srCv: 5, avgDps: 2.1, trend: 'up',
}

const data: ViewData = {
  durationS: 600, distanceKm: 3.2, avgSpeed: 3, avgSR: 60, avgDps: 2, cruiseSpeed: 3,
  strokeRateDoubled: false,
  points: [
    { t: 0, lat: 51, lng: -1, speed: 3, sr: 60, dps: 2 },
    { t: 1, lat: 51.001, lng: -1.001, speed: 3, sr: 60, dps: 2 },
  ],
  stops: [], surges: [surge], sets: [],
  insight: 'You held a strong steady rhythm throughout.',
}

const btn = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)

// The paddle page (site review, 2026-10): the map on top with only the colour
// scale, replay and section picking over it; everything to read below it; the
// actions in a column. It replaced floating panels that piled on top of each
// other and the map on a phone (#187, #206 were patches on that).
describe('AnalysisView layout', () => {
  const textBtn = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim() === label)
  const mapSection = () => container.querySelector('section[aria-label="Map"]')!

  it('puts the summary, the numbers and the efforts below the map, not over it', async () => {
    await mount(<AnalysisView data={data} sessionId="abc123" />)
    expect(container.textContent).toContain('strong steady rhythm')
    expect(container.textContent).toContain('3.20 km')
    expect(container.querySelector('section[aria-label="Efforts and rests"]')).not.toBeNull()
    expect(mapSection().textContent).not.toContain('strong steady rhythm')
    expect(mapSection().textContent).not.toContain('SHARE')
  })

  it('shows times as a clock, not in words', async () => {
    await mount(<AnalysisView data={{ ...data, durationS: 3896 }} />)
    expect(container.textContent).toContain('1:04:56')
    expect(container.textContent).not.toContain('hour')
  })

  it('lists the efforts as a table', async () => {
    await mount(<AnalysisView data={data} />)
    const rows = container.querySelectorAll('section[aria-label="Efforts and rests"] tbody tr')
    expect(rows.length).toBe(1)
    expect(rows[0].textContent).toContain('70')
  })

  it("shows the replay position's pace and stroke rate, not just the time", async () => {
    await mount(<AnalysisView data={data} />)
    expect(container.querySelector('[aria-label="Replay"]')?.textContent).toMatch(/0:00 · \d+:\d+\/500 · 60 spm/)
  })

  it('shows a SHARE button when the paddle is saved (has a sessionId)', async () => {
    await mount(<AnalysisView data={data} sessionId="abc123" />)
    expect(textBtn('SHARE')).toBeTruthy()
  })

  it('has a colour legend for the track', async () => {
    await mount(<AnalysisView data={data} />)
    expect(container.querySelector('[aria-label="Colour scale"]')).not.toBeNull()
  })
})

// One paddle (one-paddle.md, phase 3): a tracker paddle's boat motion is a
// side page of the paddle, reached from the paddle itself.
describe('AnalysisView BOAT MOTION', () => {
  const link = () => Array.from(container.querySelectorAll('a')).find(a => a.textContent?.trim() === 'BOAT MOTION →')

  it('offers BOAT MOTION on a saved tracker paddle', async () => {
    await mount(<AnalysisView data={{ ...data, source: { type: 'device' } }} sessionId="t-rec1" />)
    expect(link()).toBeTruthy()
  })
  it('not on a paddle from a file or Strava (no motion data)', async () => {
    await mount(<AnalysisView data={{ ...data, source: { type: 'strava' } }} sessionId="p1" />)
    expect(link()).toBeUndefined()
  })
  it('not on a shared view (the recording is the owner\'s)', async () => {
    await mount(<AnalysisView data={{ ...data, source: { type: 'device' } }} sessionId="t-rec1" readOnly />)
    expect(link()).toBeUndefined()
  })
})

// The same outing from another source (one-paddle.md, phase 4).
describe('AnalysisView ALSO RECORDED BY', () => {
  it('links to the comparison with the same outing from another source', async () => {
    await mount(<AnalysisView data={{ ...data, source: { type: 'device' } }} sessionId="t-rec1" />, qc =>
      qc.setQueryData(getQueryKey(trpc.paddles.sameOuting, { id: 't-rec1' }, 'query'),
        [{ id: 'strava1', sourceType: 'strava', paddledAt: '2026-10-06T09:01:00Z' }]))
    const link = Array.from(container.querySelectorAll('a')).find(a => a.textContent?.includes('ALSO RECORDED BY'))
    expect(link?.textContent).toBe('ALSO RECORDED BY STRAVA →')
  })
})

// A shared paddle is the owner's: a stranger can't flip its stroke-rate setting.
describe('AnalysisView on a shared paddle', () => {
  const has = (label: string) => container.textContent?.includes(label)
  it('offers the stroke-rate doubling to the owner only, under BOAT', async () => {
    await mount(<AnalysisView data={data} sessionId="p1" />)
    const boat = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.startsWith('BOAT'))!
    await act(async () => { boat.click() })
    expect(container.querySelector('button[aria-label="Double stroke rate"]')).not.toBeNull()
    await act(async () => { root.unmount() }); container.remove()
    await mount(<AnalysisView data={data} readOnly />)
    expect(container.querySelector('button[aria-label="Double stroke rate"]')).toBeNull()
    expect(has('BOAT')).toBe(false)
  })
})

describe('AnalysisView highlights', () => {
  it('shows the paddle\'s records as badges', async () => {
    await mount(<AnalysisView data={data} sessionId="p1" />, qc =>
      qc.setQueryData(getQueryKey(trpc.paddles.highlights, { id: 'p1' }, 'query'), ['Fastest cruise yet', 'Longest paddle yet']))
    const items = Array.from(container.querySelectorAll('[aria-label="Highlights"] li')).map(li => li.textContent)
    expect(items).toEqual(['Fastest cruise yet', 'Longest paddle yet'])
  })
})
