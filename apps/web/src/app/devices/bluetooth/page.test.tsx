// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('@/components/AppHeader', () => ({ default: () => <header>HEADER</header> }))

import BluetoothTestPage from './page'
import { PAIRING_WAIT } from '@/lib/tracker-ble'

// The real wait is ~30 s; tests don't sit through it.
PAIRING_WAIT.tries = 3
PAIRING_WAIT.delayMs = 0

let container: HTMLDivElement
let root: Root

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  vi.unstubAllGlobals()
})

async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<BluetoothTestPage />) })
  await act(async () => { await Promise.resolve() })
}

const ABOUT = '{"v":1,"id":"435AC17C","fw":"0.18.0","model":"lilygo-tbeam-s3-supreme","waiting":2,"linked":true}'

const enc = (s: string) => new DataView(new TextEncoder().encode(s).buffer)

/** A browser Bluetooth that "finds" one tracker sending `about`. Reading the
 *  paired item gives `pairedRead()` (throw to mimic a refused pairing). */
function fakeBluetooth(about: string, pairedRead: () => string = () => '{"v":1,"paired":true}') {
  const disconnect = vi.fn()
  const requestDevice = vi.fn(async () => ({
    name: 'PT-17C',
    gatt: {
      connected: true,
      disconnect,
      connect: async () => ({
        getPrimaryService: async () => ({
          getCharacteristic: async (uuid: string) => ({
            readValue: async () => enc(uuid.startsWith('04dd0a03') ? pairedRead() : about),
          }),
        }),
      }),
    },
  }))
  vi.stubGlobal('navigator', { ...navigator, bluetooth: { requestDevice } })
  return { requestDevice, disconnect }
}

describe('Bluetooth test page', () => {
  it('tells Safari, Firefox and iPhone users to use Chrome or Edge, instead of a button that fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ devices: [] }) })))
    await mount()
    expect(container.textContent).toContain('Chrome or Edge')
    expect([...container.querySelectorAll('button')].some(b => b.textContent === 'CONNECT')).toBe(false)
  })

  it('connects, reads the tracker and says it is yours', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ devices: [{ deviceId: '435AC17C' }] }) })))
    const bt = fakeBluetooth(ABOUT)
    await mount()
    const connect = [...container.querySelectorAll('button')].find(b => b.textContent === 'CONNECT')!
    await act(async () => { connect.click() })
    await act(async () => { await Promise.resolve() })
    // Asks the browser for paddlesnitch trackers only.
    expect(bt.requestDevice).toHaveBeenCalledWith({ filters: [{ services: ['04dd0a01-9cd1-403e-a461-0b4af515a1b4'] }] })
    expect(container.textContent).toContain('PT-17C')
    expect(container.textContent).toContain('435AC17C')
    expect(container.textContent).toContain('0.18.0')
    expect(container.textContent).toContain('2 waiting to upload')
    expect(container.textContent).toContain('On your account')
  })

  async function connected() {
    await mount()
    const connect = [...container.querySelectorAll('button')].find(b => b.textContent === 'CONNECT')!
    await act(async () => { connect.click() })
    await act(async () => { await Promise.resolve() })
  }
  const pairButton = () => [...container.querySelectorAll('button')].find(b => b.textContent === 'PAIR')

  it('pairs by reading the item only a paired connection may read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ devices: [{ deviceId: '435AC17C' }] }) })))
    fakeBluetooth(ABOUT)
    await connected()
    expect(container.textContent).toContain('the same 6-digit number')
    await act(async () => { pairButton()!.click() })
    await act(async () => { await Promise.resolve() })
    expect(container.textContent).toContain('Paired')
    expect(pairButton()).toBeUndefined()
  })

  it('waits for pairing to finish instead of failing on the first refused read (Android Chrome)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ devices: [] }) })))
    let n = 0
    fakeBluetooth(ABOUT, () => { if (++n < 2) throw Object.assign(new Error('auth'), { name: 'NetworkError' }); return '{"v":1,"paired":true}' })
    await connected()
    await act(async () => { pairButton()!.click() })
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(container.textContent).toContain('Paired')
    expect(container.textContent).not.toContain("Couldn't pair")
  })

  it('drops the connection when the page is left, so the tracker advertises again', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ devices: [] }) })))
    const bt = fakeBluetooth(ABOUT)
    await connected()
    await act(async () => { root.unmount() })
    root = undefined as unknown as Root
    expect(bt.disconnect).toHaveBeenCalled()
  })

  it('explains what to do when pairing is refused or times out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ devices: [] }) })))
    fakeBluetooth(ABOUT, () => { throw Object.assign(new Error('auth'), { name: 'NetworkError' }) })
    await connected()
    await act(async () => { pairButton()!.click() })
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(container.textContent).toContain("Couldn't pair")
    // This is a test page: show what the browser said, to diagnose from.
    expect(container.textContent).toContain('NetworkError: auth')
    expect(pairButton()).toBeDefined()   // can try again
  })

  it('says plainly when what it found is not a tracker it understands', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ devices: [] }) })))
    fakeBluetooth('garbage')
    await mount()
    const connect = [...container.querySelectorAll('button')].find(b => b.textContent === 'CONNECT')!
    await act(async () => { connect.click() })
    await act(async () => { await Promise.resolve() })
    expect(container.textContent).toContain("Couldn't read this tracker")
  })
})
