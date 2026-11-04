// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import BoatMotionSummary from './BoatMotionSummary'

vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href?: string }) => <a href={href}>{children}</a> }))

let container: HTMLDivElement
let root: Root
afterEach(async () => { if (root) await act(async () => { root.unmount() }); container?.remove(); vi.unstubAllGlobals() })

async function mount() {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<BoatMotionSummary paddleId="t-rec1" deviceId="435ac17c" deviceSessionId="rec1" />) })
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

describe('the boat-motion summary on a paddle detail page (#866)', () => {
  it('reads the recording and shows roll, pitch, evenness and a link to the charts', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      attitude: { available: true, rollRmsDeg: 4, pitchRmsDeg: 1.9, symmetry: { imbalancePct: 13.5 } },
    })))
    vi.stubGlobal('fetch', fetchMock)
    await mount()
    // Owner-gated recording read, device id upper-cased by the route either way.
    expect(fetchMock).toHaveBeenCalledWith('/api/account/devices/sessions/rec1?deviceId=435ac17c')
    expect(container.textContent).toContain('Boat motion')
    expect(container.textContent).toContain('4°')
    expect(container.textContent).toContain('1.9°')
    expect(container.textContent).toContain('14%')
    expect(container.querySelector('a[href="/paddles/t-rec1/motion"]')?.textContent).toContain('See the charts')
  })

  it('shows nothing when the motion data has not arrived or yielded nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ attitude: { available: false, reason: 'x' } }))))
    await mount()
    expect(container.querySelector('section')).toBeNull()
    expect(container.textContent).toBe('')
  })

  it('shows nothing, and never breaks the page, when the read fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    await mount()
    expect(container.querySelector('section')).toBeNull()
  })

  it('shows an em dash for evenness when the recording had no symmetry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      attitude: { available: true, rollRmsDeg: 4, pitchRmsDeg: 1.9, symmetry: null },
    }))))
    await mount()
    expect(container.textContent).toContain('—')
  })
})
