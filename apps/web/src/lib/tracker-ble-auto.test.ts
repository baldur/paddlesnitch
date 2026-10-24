// The auto-sync spike's checks (#416), against fake browsers: each answer is
// reported, nothing throws, and the connection is kept for the navigation check.
import { describe, it, expect, beforeEach } from 'vitest'
import { AUTO_WAIT, kept, navigationCheck, runAutoChecks, type RememberedDevice } from './tracker-ble-auto'

const ABOUT = '{"v":1,"id":"435AC17C","fw":"0.19.3","model":"lilygo-tbeam-s3-supreme","waiting":2,"linked":true}'
const enc = (s: string) => new DataView(new TextEncoder().encode(s).buffer)

function tracker(opts: { advertise?: boolean; watch?: boolean; connectFails?: boolean } = {}): RememberedDevice {
  let listener: ((e: { rssi?: number }) => void) | null = null
  const gatt = {
    connected: false,
    connect: async () => {
      if (opts.connectFails) throw Object.assign(new Error('User gesture required'), { name: 'SecurityError' })
      gatt.connected = true
      return { getPrimaryService: async () => ({ getCharacteristic: async () => ({ readValue: async () => enc(ABOUT) }) }) }
    },
    disconnect: () => { gatt.connected = false },
  }
  return {
    id: 'x', name: 'Paddlesnitch 7C',
    ...(opts.watch === false ? {} : {
      watchAdvertisements: async () => { if (opts.advertise !== false) setTimeout(() => listener?.({ rssi: -61 }), 0) },
      addEventListener: (_t: 'advertisementreceived', fn: (e: { rssi?: number }) => void) => { listener = fn },
    }),
    gatt,
  }
}

const run = (devices: RememberedDevice[] | null) => runAutoChecks(devices ? { getDevices: async () => devices } : {}, () => {})

beforeEach(() => { kept.device = null; AUTO_WAIT.advertisementMs = 30 })

describe('auto-sync spike', () => {
  it('passes all three checks on a browser that can do it, and keeps the connection', async () => {
    const checks = await run([tracker()])
    expect(checks.map(c => [c.id, c.state])).toEqual([['getDevices', 'pass'], ['advertisements', 'pass'], ['connect', 'pass']])
    expect(checks[1].detail).toMatch(/-61 dBm/)
    expect(checks[2].detail).toMatch(/435AC17C.*0\.19\.3.*2 recording/)
    expect(navigationCheck()).toMatchObject({ id: 'navigation', state: 'pass' })
    kept.device!.gatt!.disconnect()
    expect(navigationCheck()).toMatchObject({ state: 'fail' })
  })

  it('says getDevices is missing (Chrome behind a flag) and stops', async () => {
    const checks = await run(null)
    expect(checks).toHaveLength(1)
    expect(checks[0]).toMatchObject({ id: 'getDevices', state: 'fail', detail: expect.stringMatching(/chrome:\/\/flags/) })
  })

  it('asks for a pairing first when nothing is remembered', async () => {
    expect((await run([]))[0].detail).toMatch(/Pair one/)
  })

  it('reports silence and a refused connect without throwing', async () => {
    const checks = await run([tracker({ advertise: false, connectFails: true })])
    expect(checks.map(c => c.state)).toEqual(['pass', 'fail', 'fail'])
    expect(checks[2].detail).toBe('SecurityError: User gesture required')
    expect(navigationCheck()).toBeNull()
  })

  it('reports a browser without watchAdvertisements and still tries to connect', async () => {
    const checks = await run([tracker({ watch: false })])
    expect(checks.map(c => [c.id, c.state])).toEqual([['getDevices', 'pass'], ['advertisements', 'fail'], ['connect', 'pass']])
  })
})
