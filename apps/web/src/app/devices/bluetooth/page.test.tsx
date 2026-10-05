// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('@/components/AppHeader', () => ({ default: () => <header>HEADER</header> }))

import BluetoothTestPage from './page'
import { PAIRING_WAIT, WIFI_WAIT, SYNC_WAIT } from '@/lib/tracker-ble'

// The real wait is ~30 s; tests don't sit through it.
PAIRING_WAIT.tries = 3
PAIRING_WAIT.delayMs = 0
WIFI_WAIT.delayMs = 0

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

  describe('setting the tracker up once paired', () => {
    const HASH = 'ab'.repeat(32)
    /** A paired tracker whose LINK and WIFI items behave like the firmware's. */
    function fakeSetupTracker(opts: { wifiResult?: string; serverStatus?: number; serverError?: string; staleWifi?: boolean } = {}) {
      const tracker = { link: 'idle', wifiReads: 0, committedWith: '' }
      const writes: { uuid: string; body: unknown }[] = []
      const requestDevice = vi.fn(async () => ({
        name: 'PT-17C',
        gatt: {
          connected: true, disconnect: vi.fn(),
          connect: async () => ({
            getPrimaryService: async () => ({
              getCharacteristic: async (uuid: string) => {
                // A phone holding the tracker's old list of items (paired before an update).
                if (uuid.startsWith('04dd0a05') && opts.staleWifi) {
                  throw Object.assign(new Error(`No Characteristics matching UUID ${uuid} found in Service.`), { name: 'NotFoundError' })
                }
                return {
                readValue: async () => {
                  if (uuid.startsWith('04dd0a02')) return enc(ABOUT_UNLINKED)
                  if (uuid.startsWith('04dd0a03')) return enc('{"v":1,"paired":true}')
                  if (uuid.startsWith('04dd0a04')) return enc(JSON.stringify({ v: 1, id: '435AC17C', state: tracker.link, tokenHash: tracker.link === 'idle' ? '' : HASH }))
                  // WIFI: "trying" twice, then the result.
                  tracker.wifiReads++
                  return enc(JSON.stringify({ v: 1, state: tracker.wifiReads < 3 ? 'trying' : (opts.wifiResult ?? 'joined') }))
                },
                writeValueWithResponse: async (buf: ArrayBuffer) => {
                  const body = JSON.parse(new TextDecoder().decode(buf))
                  writes.push({ uuid, body })
                  if (uuid.startsWith('04dd0a04') && body.op === 'begin') tracker.link = 'pending'
                  if (uuid.startsWith('04dd0a04') && body.op === 'commit' && body.tokenHash === HASH) { tracker.link = 'committed'; tracker.committedWith = body.tokenHash }
                },
                }
              },
            }),
          }),
        },
      }))
      vi.stubGlobal('navigator', { ...navigator, bluetooth: { requestDevice } })
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/account/devices/link-bluetooth') {
          return { ok: (opts.serverStatus ?? 200) === 200, status: opts.serverStatus ?? 200, json: async () => (opts.serverError ? { error: opts.serverError } : { deviceId: '435AC17C', model: 'm' }), init } as unknown as Response
        }
        return { ok: true, status: 200, json: async () => ({ devices: [] }) } as unknown as Response
      })
      vi.stubGlobal('fetch', fetchMock)
      return { tracker, writes, fetchMock }
    }
    const ABOUT_UNLINKED = '{"v":1,"id":"435AC17C","fw":"0.18.0","model":"lilygo-tbeam-s3-supreme","waiting":0,"linked":false}'
    const settle = async () => { for (let i = 0; i < 12; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
    const button = (label: string) => [...container.querySelectorAll('button')].find(b => b.textContent === label)

    async function pairedPage() {
      await connected()
      await act(async () => { pairButton()!.click() })
      await settle()
    }

    it('adds the tracker to the account: begin, register the hash, then commit', async () => {
      const { tracker, writes, fetchMock } = fakeSetupTracker()
      await pairedPage()
      await act(async () => { button('ADD TO MY ACCOUNT')!.click() })
      await settle()
      expect(writes.map(w => w.body)).toEqual([{ op: 'begin' }, { op: 'commit', tokenHash: HASH }])
      const call = fetchMock.mock.calls.find(c => c[0] === '/api/account/devices/link-bluetooth')!
      expect(JSON.parse(String(call[1]!.body))).toMatchObject({ deviceId: '435AC17C', tokenHash: HASH })
      expect(tracker.committedWith).toBe(HASH)
      expect(container.textContent).toContain('Added to your account')
      expect(container.textContent).toContain('On your account')
    })

    it("doesn't commit on the tracker when the server refused, and says why", async () => {
      const { writes } = fakeSetupTracker({ serverStatus: 409, serverError: 'owned_elsewhere' })
      await pairedPage()
      await act(async () => { button('ADD TO MY ACCOUNT')!.click() })
      await settle()
      expect(writes.map(w => (w.body as { op: string }).op)).toEqual(['begin'])
      expect(container.textContent).toContain('another account')
    })

    it('sends the WiFi details and reports when the tracker joined', async () => {
      const { writes } = fakeSetupTracker({ wifiResult: 'joined' })
      await pairedPage()
      const ssid = container.querySelector('input#bt-wifi-ssid') as HTMLInputElement
      const pass = container.querySelector('input#bt-wifi-pass') as HTMLInputElement
      await act(async () => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        set.call(ssid, 'kruttnet'); ssid.dispatchEvent(new Event('input', { bubbles: true }))
        set.call(pass, 'secret-pw'); pass.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => { button('SAVE WIFI')!.click() })
      await settle()
      expect(writes.find(w => w.uuid.startsWith('04dd0a05'))!.body).toEqual({ ssid: 'kruttnet', pass: 'secret-pw' })
      expect(container.textContent).toContain('joined your WiFi')
    })

    // Found on Android after a firmware update: "Couldn't send the WiFi
    // details", fixed only by forgetting the tracker and pairing again.
    it("tells the person to forget the tracker when the phone's copy of it is out of date", async () => {
      fakeSetupTracker({ staleWifi: true })
      await pairedPage()
      const ssid = container.querySelector('input#bt-wifi-ssid') as HTMLInputElement
      await act(async () => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        set.call(ssid, 'kruttnet'); ssid.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => { button('SAVE WIFI')!.click() })
      await settle()
      expect(container.textContent).toContain('forget PT-17C')
    })

    it('says the password is probably wrong when the tracker found the network', async () => {
      fakeSetupTracker({ wifiResult: 'wrong_password' })
      await pairedPage()
      const ssid = container.querySelector('input#bt-wifi-ssid') as HTMLInputElement
      await act(async () => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        set.call(ssid, 'kruttnet'); ssid.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => { button('SAVE WIFI')!.click() })
      await settle()
      expect(container.textContent).toContain('password is probably wrong')
    })
  })

  describe('SYNC OVER BLUETOOTH', () => {
    // One small recording on a fake tracker that speaks SYNC + DATA like the firmware.
    function fakeSyncTracker() {
      const csv = 'timestamp,lat,lon\n2026-10-05T06:10:02Z,51.46,-0.93'
      let state = 'idle', data = new Uint8Array(0), cursor = 0
      const done: unknown[] = []
      const enc8 = (t: string) => new TextEncoder().encode(t)
      const requestDevice = vi.fn(async () => ({
        name: 'PT-17C',
        gatt: {
          connected: true, disconnect: vi.fn(),
          connect: async () => ({
            getPrimaryService: async () => ({
              getCharacteristic: async (uuid: string) => ({
                readValue: async () => {
                  if (uuid.startsWith('04dd0a02')) return enc(ABOUT)
                  if (uuid.startsWith('04dd0a03')) return enc('{"v":1,"paired":true}')
                  if (uuid.startsWith('04dd0a06')) return enc(JSON.stringify({ v: 1, state, len: data.length, part: 1, parts: 1, compressed: false }))
                  if (uuid.startsWith('04dd0a07')) {
                    const n = Math.min(500, data.length - cursor)
                    const p = new Uint8Array(4 + n)
                    new DataView(p.buffer).setUint32(0, cursor, true)
                    p.set(data.subarray(cursor, cursor + n), 4); cursor += n
                    return new DataView(p.buffer)
                  }
                  return enc('{}')
                },
                writeValueWithResponse: async (buf: ArrayBuffer) => {
                  const b = JSON.parse(new TextDecoder().decode(buf))
                  if (!uuid.startsWith('04dd0a06')) return
                  cursor = 0
                  if (b.op === 'list') { data = enc8(JSON.stringify([{ n: 'track_z.csv', u: 'track_z.csv', s: csv.length }])); state = 'ready' }
                  if (b.op === 'piece') { data = enc8(csv); state = 'ready' }
                  if (b.op === 'done') { done.push(b); state = 'marked' }
                },
              }),
            }),
          }),
        },
      }))
      vi.stubGlobal('navigator', { ...navigator, bluetooth: { requestDevice } })
      const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => url.startsWith('/api/account/devices/435AC17C/sessions')
        ? ({ ok: true, status: 201, json: async () => ({ receipt: 'r'.repeat(64) }) } as unknown as Response)
        : ({ ok: true, status: 200, json: async () => ({ devices: [{ deviceId: '435AC17C' }] }) } as unknown as Response))
      vi.stubGlobal('fetch', fetchMock)
      return { done, fetchMock }
    }

    it('sends the recording through this browser and hands the receipt back to the tracker', async () => {
      SYNC_WAIT.delayMs = 0
      const { done, fetchMock } = fakeSyncTracker()
      await connected()
      await act(async () => { pairButton()!.click() })
      for (let i = 0; i < 12; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) })
      const btn = [...container.querySelectorAll('button')].find(b => b.textContent === 'SYNC OVER BLUETOOTH')!
      await act(async () => { btn.click() })
      for (let i = 0; i < 30; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) })
      const call = fetchMock.mock.calls.find(c => String(c[0]).startsWith('/api/account/devices/435AC17C/sessions'))!
      expect(String(call[0])).toContain('filename=track_z.csv')
      expect(String(call[0])).toContain('part=1&parts=1')
      expect((call[1] as RequestInit).headers).toMatchObject({ 'content-type': 'text/csv', 'x-device-firmware': '0.18.0' })
      expect(done).toEqual([{ op: 'done', name: 'track_z.csv', receipt: 'r'.repeat(64) }])
      expect(container.textContent).toContain('1 recording sent')
    })
  })
})
