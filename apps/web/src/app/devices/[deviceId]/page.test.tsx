// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('@/components/AppHeader', () => ({ default: () => <header>HEADER</header> }))
vi.mock('@/components/devices/RemoveTrackerButton', () => ({ default: () => null }))
vi.mock('next/navigation', () => ({ useParams: () => ({ deviceId: '435AC17C' }) }))
vi.mock('@/lib/trpc', () => ({
  trpc: { paddles: { byRecording: { useQuery: () => ({ data: { rec1: 't-rec1' } }) } } },
}))

import DeviceDetailPage from './page'

let container: HTMLDivElement
let root: Root
afterEach(async () => { if (root) await act(async () => { root.unmount() }); container?.remove(); vi.unstubAllGlobals() })

const SESSIONS = [
  { sessionId: 'rec1', deviceId: '435AC17C', filename: 'track_20261006_063728.csv', startedAt: '2026-10-06T06:37:28Z', distanceMetres: 1677, motion: { rows: 1 } },
  { sessionId: 'desk', deviceId: '435AC17C', filename: 'track_20261005_192245.csv', startedAt: '2026-10-05T19:22:45Z', distanceMetres: 0 },
]

describe("a tracker's page (one paddle)", () => {
  it('links a recording that became a paddle to it, and keeps a desk test here with the reason', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
      url.includes('/sessions') ? { sessions: SESSIONS } : { devices: [{ deviceId: '435AC17C', name: 'Number001' }] },
    ))))
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => { root.render(<DeviceDetailPage />) })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })

    const link = container.querySelector('a[href="/paddles/t-rec1"]')
    expect(link?.textContent).toContain('with boat motion')
    expect(container.textContent).toContain('not a paddle: the boat barely moved')
    expect(container.querySelectorAll('a[href^="/paddles/"]').length).toBe(1)
  })
})
