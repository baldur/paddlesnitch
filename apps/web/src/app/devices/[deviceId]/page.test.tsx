// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('@/components/AppHeader', () => ({ default: () => <header>HEADER</header> }))
vi.mock('@/components/devices/RemoveTrackerButton', () => ({ default: (p: { phone?: boolean }) => <div data-remove={p.phone ? 'phone' : 'tracker'} /> }))
const route = vi.hoisted(() => ({ deviceId: '435AC17C' }))
vi.mock('next/navigation', () => ({ useParams: () => route }))
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
  it('links a recording that became a paddle to it, and keeps a desk test here, saying where to see why', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
      url.includes('/sessions') ? { sessions: SESSIONS } : { devices: [{ deviceId: '435AC17C', name: 'Number001' }] },
    ))))
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => { root.render(<DeviceDetailPage />) })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })

    const link = container.querySelector('a[href="/paddles/t-rec1"]')
    expect(link?.textContent).toContain('with boat motion')
    expect(container.textContent).toContain('not a paddle: open to see why')
    expect(container.querySelectorAll('a[href^="/paddles/"]').length).toBe(1)
  })
})

describe("a phone's page (C3)", () => {
  const PHONE = 'P0123456789ABCDEF'
  async function show(devices: unknown[], sessions: unknown[] = []) {
    route.deviceId = PHONE
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/sessions') ? { sessions } : { devices }))))
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => { root.render(<DeviceDetailPage />) })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  }
  afterEach(() => { route.deviceId = '435AC17C' })

  it('speaks of a phone: no Bluetooth, no model or last seen, the phone empty state, Remove phone', async () => {
    await show([{ deviceId: PHONE, name: 'iPhone', model: 'phone-ios', firmware: '', linkedAt: '2026-11-01T07:00:00Z', lastSeenAt: '2026-11-01T07:00:00Z' }])
    const text = container.textContent ?? ''
    expect(text).toContain('Everything this phone has recorded')
    expect(text).toContain('The app uploads each recording after you stop it.')
    expect(text).toContain('added 1 Nov 2026')
    expect(text).not.toContain('phone-ios')
    expect(text).not.toContain('last seen')
    expect(text).not.toContain('Bluetooth')
    expect(container.querySelector('[data-remove]')?.getAttribute('data-remove')).toBe('phone')
  })

  it('a removed phone says how it comes back, not how to add a tracker', async () => {
    await show([], [{ sessionId: 'r', deviceId: PHONE, filename: 'track_20261101_070000.csv', startedAt: '2026-11-01T07:00:00Z', distanceMetres: 0 }])
    const text = container.textContent ?? ''
    expect(text).toContain('Phone')
    expect(text).toContain('This phone is no longer on your account')
    expect(text).not.toContain('Add it again')
  })
})
