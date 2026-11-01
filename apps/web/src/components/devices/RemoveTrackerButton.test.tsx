// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

import RemoveTrackerButton from './RemoveTrackerButton'

let container: HTMLDivElement
let root: Root
afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  vi.unstubAllGlobals()
  push.mockClear()
})

async function mount(phone = false) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<RemoveTrackerButton deviceId={phone ? 'P0123456789ABCDEF' : '5A43CA48'} phone={phone} />) })
}
const button = (label: string) => [...container.querySelectorAll('button')].find(b => b.textContent === label)!

describe('RemoveTrackerButton', () => {
  it('asks before removing, and Cancel removes nothing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await mount()
    await act(async () => { button('Remove tracker').click() })
    expect(container.textContent).toContain('Its recordings stay yours')
    await act(async () => { button('Cancel').click() })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(button('Remove tracker')).toBeTruthy()
  })

  it('removes the tracker and goes back to /devices', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true } as Response))
    vi.stubGlobal('fetch', fetchMock)
    await mount()
    await act(async () => { button('Remove tracker').click() })
    await act(async () => { button('Remove').click() })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/account/devices')
    expect(init.method).toBe('DELETE')
    expect(JSON.parse(init.body as string)).toEqual({ deviceId: '5A43CA48' })
    expect(push).toHaveBeenCalledWith('/devices')
  })

  it('says so if removing fails, and stays put', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false } as Response)))
    await mount()
    await act(async () => { button('Remove tracker').click() })
    await act(async () => { button('Remove').click() })
    expect(container.querySelector('[role=alert]')!.textContent).toMatch(/Couldn’t remove/)
    expect(push).not.toHaveBeenCalled()
  })
})

describe('RemoveTrackerButton for a phone', () => {
  it('says phone, and that the app brings it back until signed out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false } as Response)))
    await mount(true)
    await act(async () => { button('Remove phone').click() })
    expect(container.textContent).toContain('It comes back if you record on it with the app again')
    expect(container.textContent).toContain('sign out of the app on that phone')
    await act(async () => { button('Remove').click() })
    expect(container.textContent).toContain('Couldn’t remove the phone. Please try again.')
  })
})
