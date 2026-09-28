// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// AppHeader mounts AttAccountNav (useRouter + fetch on mount) — out of scope here.
vi.mock('@/components/AppHeader', () => ({ default: () => <header>HEADER</header> }))

import DevicesPage from './page'

let container: HTMLDivElement
let root: Root

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  vi.unstubAllGlobals()
})

function stubFetch(routes: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true, status: 200, json: async () => routes[url] ?? {},
  } as Response)))
}

async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<DevicesPage />) })
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

const DEVICES = '/api/account/devices'
const SESSIONS = '/api/account/devices/sessions'

describe('DEVICES page', () => {
  it('renders one card per tracker, linking into that tracker', async () => {
    stubFetch({
      [DEVICES]: { devices: [{ deviceId: '5A43CA48', name: "Baldur's tracker", model: 'lilygo-tbeam-s3-supreme', firmware: '0.9.0', lastSeenAt: '2026-09-18T09:00:00Z' }] },
      [SESSIONS]: { sessions: [
        { sessionId: 's1', deviceId: '5A43CA48', userId: 'u1', filename: 'track_0001.csv', uploadedAt: '2026-09-19T10:00:00Z', points: 3600, distanceMetres: 10790 },
      ] },
    })
    await mount()
    expect(container.textContent).toContain("Baldur's tracker")
    expect(container.textContent).toContain('5A43CA48')
    expect(container.textContent).toContain('1 recording')
    expect(container.textContent).toContain('10.79 km')
    const card = [...container.querySelectorAll('a')].find(a => a.textContent?.includes("Baldur's tracker"))
    expect(card?.getAttribute('href')).toBe('/devices/5A43CA48')
  })

  it('still shows a revoked tracker, because its uploads are still the user\'s', async () => {
    stubFetch({
      [DEVICES]: { devices: [] },
      [SESSIONS]: { sessions: [
        { sessionId: 's1', deviceId: 'DEADBEEF', userId: 'u1', filename: 'track_0001.csv', uploadedAt: '2026-09-01T10:00:00Z', points: 10 },
      ] },
    })
    await mount()
    expect(container.textContent).toContain('DEADBEEF')
    expect(container.textContent).toContain('not linked')
  })

  it('lets a user with no tracker add one right here, instead of sending them to another page', async () => {
    stubFetch({ [DEVICES]: { devices: [] }, [SESSIONS]: { sessions: [] } })
    await mount()
    expect(container.textContent).toContain('No trackers yet')
    expect(container.querySelector('#add form')).not.toBeNull()
    expect([...container.querySelectorAll('a')].some(a => a.getAttribute('href') === '/account')).toBe(false)
  })

  it('has the add-a-tracker box when trackers already exist too', async () => {
    stubFetch({ [DEVICES]: { devices: [{ deviceId: '5A43CA48', name: 't', model: 'm' }] }, [SESSIONS]: { sessions: [] } })
    await mount()
    expect(container.querySelector('#add form')).not.toBeNull()
  })
})
