// The auto-sync spike (#416): can a phone browser reach an already-paired
// tracker WITHOUT a tap? Four checks, each reported, never thrown: the
// browser lists remembered trackers (getDevices), notices one nearby
// (watchAdvertisements), connects to it and reads it with no user gesture,
// and keeps the connection while the paddler moves to another page. The
// owner runs this on an Android phone; the answers decide whether quiet
// background sync is worth building (docs/features/tracker-bluetooth-sync.md).
import { TRACKER_ABOUT, TRACKER_SERVICE, parseAbout } from '@/lib/tracker-ble'

export type CheckState = 'pass' | 'fail' | 'skip'
export type Check = { id: 'getDevices' | 'advertisements' | 'connect' | 'navigation'; label: string; state: CheckState; detail: string }

type Characteristic = { readValue(): Promise<DataView> }
export type RememberedDevice = {
  id?: string
  name?: string
  watchAdvertisements?: (opts?: { signal?: AbortSignal }) => Promise<void>
  addEventListener?: (type: 'advertisementreceived', fn: (e: { rssi?: number }) => void) => void
  gatt?: {
    connected: boolean
    connect(): Promise<{ getPrimaryService(uuid: string): Promise<{ getCharacteristic(uuid: string): Promise<Characteristic> }> }>
    disconnect(): void
  }
}
export type AutoBluetooth = { getDevices?: () => Promise<RememberedDevice[]> }

export const AUTO_WAIT = { advertisementMs: 15_000 }

/** Kept at module level, so it outlives the page: coming back to it after a
 *  client-side navigation shows whether the connection survived. */
export const kept: { device: RememberedDevice | null; at: number } = { device: null, at: 0 }

const message = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e))

export async function runAutoChecks(bt: AutoBluetooth | null, onCheck: (c: Check) => void): Promise<Check[]> {
  const out: Check[] = []
  const report = (c: Check) => { out.push(c); onCheck(c) }

  if (!bt?.getDevices) {
    report({ id: 'getDevices', label: 'Lists remembered trackers', state: 'fail', detail: 'navigator.bluetooth.getDevices is missing. In Chrome on Android it may need chrome://flags/#enable-web-bluetooth-new-permissions-backend.' })
    return out
  }
  let devices: RememberedDevice[] = []
  try { devices = await bt.getDevices() } catch (e) {
    report({ id: 'getDevices', label: 'Lists remembered trackers', state: 'fail', detail: message(e) })
    return out
  }
  if (!devices.length) {
    report({ id: 'getDevices', label: 'Lists remembered trackers', state: 'fail', detail: 'No trackers remembered. Pair one on the Bluetooth page first, then come back.' })
    return out
  }
  report({ id: 'getDevices', label: 'Lists remembered trackers', state: 'pass', detail: devices.map(d => d.name || d.id || 'unnamed').join(', ') })
  const device = devices[0]

  if (!device.watchAdvertisements || !device.addEventListener) {
    report({ id: 'advertisements', label: 'Notices the tracker nearby', state: 'fail', detail: 'watchAdvertisements is missing in this browser.' })
  } else {
    const abort = new AbortController()
    const heard = new Promise<number | undefined>(resolve => {
      device.addEventListener!('advertisementreceived', e => resolve(e.rssi))
      setTimeout(() => resolve(NaN), AUTO_WAIT.advertisementMs)
    })
    try {
      await device.watchAdvertisements({ signal: abort.signal })
      const rssi = await heard
      report(Number.isNaN(rssi)
        ? { id: 'advertisements', label: 'Notices the tracker nearby', state: 'fail', detail: `Nothing heard in ${AUTO_WAIT.advertisementMs / 1000} s. Is the tracker on, with Bluetooth on, and not connected to another tab?` }
        : { id: 'advertisements', label: 'Notices the tracker nearby', state: 'pass', detail: rssi === undefined ? 'Heard it.' : `Heard it (signal ${rssi} dBm).` })
    } catch (e) {
      report({ id: 'advertisements', label: 'Notices the tracker nearby', state: 'fail', detail: message(e) })
    } finally { abort.abort() }
  }

  if (!device.gatt) {
    report({ id: 'connect', label: 'Connects and reads it without a tap', state: 'fail', detail: 'The remembered tracker has no GATT server.' })
    return out
  }
  try {
    const server = await device.gatt.connect()
    const about = parseAbout(new TextDecoder().decode(await (await (await server.getPrimaryService(TRACKER_SERVICE)).getCharacteristic(TRACKER_ABOUT)).readValue()))
    kept.device = device
    kept.at = Date.now()
    report({ id: 'connect', label: 'Connects and reads it without a tap', state: 'pass', detail: about ? `Tracker ${about.id}, firmware ${about.firmware}, ${about.waiting ?? "?"} recording(s) waiting.` : 'Connected, but its About reply was unreadable.' })
  } catch (e) {
    report({ id: 'connect', label: 'Connects and reads it without a tap', state: 'fail', detail: message(e) })
  }
  return out
}

/** On coming back to the page: did the connection from the last run survive? */
export function navigationCheck(now = Date.now()): Check | null {
  if (!kept.device?.gatt) return null
  const secs = Math.round((now - kept.at) / 1000)
  return kept.device.gatt.connected
    ? { id: 'navigation', label: 'Stays connected across pages', state: 'pass', detail: `Still connected after leaving the page (${secs} s).` }
    : { id: 'navigation', label: 'Stays connected across pages', state: 'fail', detail: `The connection dropped after leaving the page (${secs} s).` }
}
