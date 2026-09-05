// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import DevicesSection from './DevicesSection'

let container: HTMLDivElement
let root: Root

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function mount(node: React.ReactNode) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(node) })
  await act(async () => { await Promise.resolve() }) // let the initial fetch resolve
}

function stubFetch(handler: (url: string, init?: RequestInit) => { status?: number; body?: unknown }) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const { status = 200, body = {} } = handler(url, init)
    return { ok: status < 400, status, json: async () => body } as Response
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('DevicesSection (account → devices)', () => {
  it('lists the linked devices from /api/account/devices', async () => {
    stubFetch(() => ({ body: { devices: [{ deviceId: '5A43CA48', name: "Baldur's tracker", model: 'lilygo-tbeam-s3-supreme', lastSeenAt: '2026-09-05T09:00:00Z' }] } }))
    await mount(<DevicesSection />)
    expect(container.textContent).toContain("Baldur's tracker")
    expect(container.textContent).toContain('5A43CA48')
  })

  it('posts the entered code to link, then refreshes the list', async () => {
    const calls: string[] = []
    const fetchMock = stubFetch((url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url === '/api/account/devices/link') return { status: 200, body: { deviceId: '5A43CA48' } }
      // first list empty, list after link has the device
      const linked = calls.some(c => c.startsWith('POST /api/account/devices/link'))
      return { body: { devices: linked ? [{ deviceId: '5A43CA48', name: 'Tracker 5A43CA48', model: 'm' }] : [] } }
    })
    await mount(<DevicesSection />)
    const codeInput = container.querySelector('input') as HTMLInputElement
    const form = container.querySelector('form') as HTMLFormElement

    // React tracks the value via a property descriptor, so set through the
    // native setter for onChange to fire on a controlled input.
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(codeInput, 'K7P2QM')
      codeInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await act(async () => { await Promise.resolve() })

    const linkCall = fetchMock.mock.calls.find(c => c[0] === '/api/account/devices/link')
    expect(linkCall).toBeTruthy()
    expect(JSON.parse((linkCall![1] as RequestInit).body as string).claimCode).toBe('K7P2QM')
  })
})
