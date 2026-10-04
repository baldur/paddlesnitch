// The tracker's Bluetooth service, from the browser's side
// (docs/features/tracker-bluetooth-sync.md, P4). The ids MUST match
// firmware/include/ble_about.h; tracker-ble.test.ts checks they do.

export const TRACKER_SERVICE = '04dd0a01-9cd1-403e-a461-0b4af515a1b4'
export const TRACKER_ABOUT = '04dd0a02-9cd1-403e-a461-0b4af515a1b4'

export type TrackerAbout = {
  id: string
  firmware: string
  model: string
  /** Recordings not yet uploaded; null while the tracker hasn't counted its card. */
  waiting: number | null
  /** Whether the tracker is added to an account (any account). */
  linked: boolean
}

/** About as the tracker sends it (bleAboutJson), or null if it isn't one. */
export function parseAbout(raw: string): TrackerAbout | null {
  let o: unknown
  try { o = JSON.parse(raw) } catch { return null }
  if (!o || typeof o !== 'object') return null
  const a = o as Record<string, unknown>
  if (a.v !== 1) return null
  if (typeof a.id !== 'string' || !/^[0-9A-F]{8}$/.test(a.id)) return null
  if (typeof a.fw !== 'string' || typeof a.model !== 'string' || typeof a.linked !== 'boolean') return null
  if (a.waiting !== null && typeof a.waiting !== 'number') return null
  return { id: a.id, firmware: a.fw, model: a.model, waiting: a.waiting as number | null, linked: a.linked }
}

/** Whose tracker this is, as far as the signed-in person can tell. */
export function ownership(a: Pick<TrackerAbout, 'id' | 'linked'>, myTrackerIds: Set<string>): 'yours' | 'elsewhere' | 'unlinked' {
  if (myTrackerIds.has(a.id)) return 'yours'
  return a.linked ? 'elsewhere' : 'unlinked'
}

// The slice of Web Bluetooth the page uses. TypeScript's DOM types don't
// include it (it isn't on every browser), so it is declared here.
export type BluetoothLike = {
  requestDevice(options: { filters: { services: string[] }[] }): Promise<{
    name?: string
    gatt?: {
      connected: boolean
      connect(): Promise<{
        getPrimaryService(uuid: string): Promise<{
          getCharacteristic(uuid: string): Promise<{ readValue(): Promise<DataView> }>
        }>
      }>
      disconnect(): void
    }
  }>
}

/** The browser's Bluetooth, or null where there isn't any (Safari, Firefox, iPhone). */
export function browserBluetooth(nav: unknown = typeof navigator === 'undefined' ? undefined : navigator): BluetoothLike | null {
  const b = (nav as { bluetooth?: BluetoothLike } | undefined)?.bluetooth
  return b && typeof b.requestDevice === 'function' ? b : null
}
