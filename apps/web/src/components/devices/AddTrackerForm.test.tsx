// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import AddTrackerForm from './AddTrackerForm'

let container: HTMLDivElement
let root: Root

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

async function mount(node: React.ReactNode) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(node) })
}

function stubFetch(status: number, body: unknown) {
  const mock = vi.fn(async () => ({ ok: status < 400, status, json: async () => body } as Response))
  vi.stubGlobal('fetch', mock)
  return mock
}

const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
async function typeCode(code: string) {
  const input = container.querySelector('input') as HTMLInputElement
  await act(async () => { setValue.call(input, code); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function submit() {
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  await act(async () => { await Promise.resolve() })
}

describe('AddTrackerForm (on /devices)', () => {
  it('posts the entered code, says the tracker was added, and tells the page to reload', async () => {
    const fetchMock = stubFetch(200, { deviceId: '5A43CA48' })
    const onAdded = vi.fn()
    await mount(<AddTrackerForm onAdded={onAdded} />)
    await typeCode('k7p2qm')
    await submit()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/account/devices/link')
    expect(JSON.parse(init.body as string).claimCode).toBe('K7P2QM')
    expect(container.textContent).toContain('Tracker added')
    expect(onAdded).toHaveBeenCalledOnce()
  })

  it('explains a code it does not recognise in plain words', async () => {
    stubFetch(400, { error: 'unknown_code' })
    await mount(<AddTrackerForm />)
    await typeCode('ZZZZZZ')
    await submit()
    expect(container.querySelector('[role=alert]')!.textContent).toMatch(/don’t recognise that code/)
  })

  it('arrives prefilled from the tracker QR (?code=)', async () => {
    window.history.replaceState(null, '', '/devices?code=abc123#add')
    await mount(<AddTrackerForm />)
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('ABC123')
    expect(container.querySelector('section')!.id).toBe('add')
  })
})
