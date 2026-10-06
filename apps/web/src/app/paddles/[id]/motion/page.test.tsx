// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('@/components/AppHeader', () => ({ default: ({ breadcrumb }: { breadcrumb: React.ReactNode }) => <header>{breadcrumb}</header> }))
vi.mock('@/components/devices/BoatMotion', () => ({ default: ({ strokeRate }: { strokeRate: number | null }) => <div>MOTION CHARTS sr={String(strokeRate)}</div> }))
vi.mock('@/components/devices/TechnicalDetails', () => ({ default: () => <div>TECHNICAL DETAILS</div> }))
const paddle = vi.hoisted(() => ({ data: null as unknown }))
vi.mock('@/lib/trpc', () => ({
  trpc: { paddles: { get: { useQuery: () => ({ isPending: false, isError: false, data: paddle.data }) } } },
}))

import PaddleMotionPage from './page'

let container: HTMLDivElement
let root: Root
afterEach(async () => { if (root) await act(async () => { root.unmount() }); container?.remove(); vi.unstubAllGlobals() })

async function mount() {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<PaddleMotionPage params={Promise.resolve({ id: 't-rec1' })} />) })
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

describe("a tracker paddle's BOAT MOTION page", () => {
  it("shows the recording's boat motion with the paddle's stroke rate, and its technical details", async () => {
    paddle.data = { id: 't-rec1', paddledAt: '2026-10-06T06:37:00Z', source: { type: 'device', deviceId: '435AC17C', deviceSessionId: 'rec1' }, result: { avgSR: 57.4 } }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ report: { rows: 1 }, cadence: null, attitude: { available: true } })))
    vi.stubGlobal('fetch', fetchMock)
    await mount()
    expect(fetchMock).toHaveBeenCalledWith('/api/account/devices/sessions/rec1?deviceId=435AC17C')
    expect(container.textContent).toContain('MOTION CHARTS sr=57.4')
    expect(container.textContent).toContain('TECHNICAL DETAILS')
    expect(container.querySelector('a[href="/paddles/t-rec1"]')?.textContent).toBe('← PADDLE')
  })

  it("says there's no boat motion for a paddle that didn't come from a tracker", async () => {
    paddle.data = { id: 'p1', paddledAt: '2026-10-06T06:37:00Z', source: { type: 'strava' }, result: { avgSR: null } }
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await mount()
    expect(container.textContent).toContain("didn't come from a paddlesnitch tracker")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
