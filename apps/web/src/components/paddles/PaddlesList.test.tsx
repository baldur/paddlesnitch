// @vitest-environment jsdom
// A paddle without a map in the Paddles list (#414): a NO GPS tag instead of
// the route, "—" for its distance, no pace, and no tick box to compare it.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { httpBatchLink } from '@trpc/client'
import { getQueryKey } from '@trpc/react-query'
import { trpc } from '@/lib/trpc'
import PaddlesList from './PaddlesList'

vi.mock('@/components/AppHeader', () => ({ default: () => <header /> }))
vi.mock('@/components/strava/StravaHistoryImport', () => ({ StravaFirstImport: () => null }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href?: string }) => <a href={href}>{children}</a> }))

let container: HTMLDivElement
let root: Root
afterEach(async () => { await act(async () => { root.unmount() }); container.remove() })

const summary = (id: string, paddledAt: string, over: object = {}) => ({
  id, createdAt: paddledAt, paddledAt, source: { type: 'device' }, durationS: 3600, distanceKm: 8.5, avgSR: 52,
  cruiseSpeed: 2.4, effortCount: 0, avgDps: null, note: '', insight: '', route: [[51.5, -0.9], [51.51, -0.9]], ...over,
})

async function mount(sessions: object[]) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  qc.setQueryData(getQueryKey(trpc.me, undefined, 'query'), { user: { id: 'u', email: 'u@example.com', displayName: 'U' } })
  qc.setQueryData(getQueryKey(trpc.paddles.sessions, undefined, 'query'), sessions)
  const client = trpc.createClient({ links: [httpBatchLink({ url: 'http://localhost/api/trpc' })] })
  await act(async () => {
    root.render(<trpc.Provider client={client} queryClient={qc}><QueryClientProvider client={qc}><PaddlesList /></QueryClientProvider></trpc.Provider>)
  })
}

// A phone's recording is a device paddle like a tracker's (C3); it says Phone (#789).
describe('Paddles list, where a paddle came from', () => {
  it('says Phone for a phone paddle and Tracker for a tracker paddle', async () => {
    await mount([
      summary('p', '2026-10-11T07:00:00Z', { source: { type: 'device', deviceId: 'P0123456789ABCDEF' } }),
      summary('t', '2026-10-04T07:00:00Z', { source: { type: 'device', deviceId: 'A1B2C3D4' } }),
    ])
    const row = (id: string) => container.querySelector(`a[href="/paddles/${id}"]`)!.textContent
    expect(row('p')).toContain('· Phone')
    expect(row('p')).not.toContain('Tracker')
    expect(row('t')).toContain('· Tracker')
  })

  it('says the phone recorded the same outing too', async () => {
    const at = '2026-10-11T07:00:00Z'
    await mount([
      summary('t', at, { source: { type: 'device', deviceId: 'A1B2C3D4' } }),
      summary('p', at, { source: { type: 'device', deviceId: 'P0123456789ABCDEF' } }),
    ])
    expect(container.textContent).toContain('Also recorded by the phone')
  })
})

describe('Paddles list, a paddle without a map', () => {
  it('shows NO GPS instead of the route, "—" for distance, no pace, and no compare tick box', async () => {
    await mount([
      summary('m', '2026-10-11T07:00:00Z', { distanceKm: 0, cruiseSpeed: 0, durationS: 6060, route: [], noGps: true }),
      summary('a', '2026-10-04T07:00:00Z'),
    ])
    const [motion, withMap] = Array.from(container.querySelectorAll('a[href^="/paddles/"]')).filter(a => /^\/paddles\/[am]$/.test(a.getAttribute('href')!))
    expect(motion.textContent).toContain('NO GPS')
    expect(motion.textContent).toContain('— · 1:41:00')
    expect(motion.textContent).not.toMatch(/km|\/500/)
    expect(motion.querySelector('svg[aria-label="paddle route"]')).toBeNull()
    expect(withMap.querySelector('svg[aria-label="paddle route"]')).not.toBeNull()
    // Compare is a mode: its tick boxes show once it's on, and only on paddles with a map.
    expect(container.querySelectorAll('input[aria-label="Compare"]').length).toBe(0)
    const compare = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Compare')!
    await act(async () => { compare.click() })
    expect(container.querySelectorAll('input[aria-label="Compare"]').length).toBe(1)
    // Counted, with its time; its km is nothing.
    expect(container.textContent).toContain('In all: 2 paddles, 8.5 km, 2:41:00 on the water')
  })
})
