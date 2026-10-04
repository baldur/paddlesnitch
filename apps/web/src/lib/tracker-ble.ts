// The tracker's Bluetooth service, from the browser's side
// (docs/features/tracker-bluetooth-sync.md, P4). The ids MUST match
// firmware/include/ble_about.h; tracker-ble.test.ts checks they do.

export const TRACKER_SERVICE = '04dd0a01-9cd1-403e-a461-0b4af515a1b4'
export const TRACKER_ABOUT = '04dd0a02-9cd1-403e-a461-0b4af515a1b4'
/** Readable only over a paired connection; reading it is what starts pairing. */
export const TRACKER_PAIRED = '04dd0a03-9cd1-403e-a461-0b4af515a1b4'

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

/** The reply to reading TRACKER_PAIRED, which only a paired connection gets. */
export function isPairedReply(raw: string): boolean {
  try {
    const o = JSON.parse(raw) as { v?: unknown; paired?: unknown }
    return o.v === 1 && o.paired === true
  } catch { return false }
}

/** How long to keep trying the protected read while pairing finishes: about
 *  Bluetooth's 30 s pairing limit (8 tries of up to 3 s + 1.5 s). Each read
 *  has its own limit: on Android a read sometimes never answers at all, and
 *  the page sat on PAIRING… for ever. Read at call time, so tests can shorten it. */
export const PAIRING_WAIT = { tries: 8, delayMs: 1500, readTimeoutMs: 3000 }

/**
 * Read the paired-only item until it answers, or the wait runs out.
 *
 * Chrome on Android refuses the first protected read straight away while
 * Android's pairing (the number prompt, the hold on the tracker) carries on in
 * the background; the link is encrypted a few seconds later. Giving up on that
 * first refusal reported "Couldn't pair" for a tracker that had just paired.
 */
export async function readWhenPaired(
  read: () => Promise<string>,
  wait: { tries: number; delayMs: number; readTimeoutMs?: number } = PAIRING_WAIT,
): Promise<{ paired: boolean; lastError?: string }> {
  const limit = wait.readTimeoutMs ?? 3000
  let lastError: string | undefined
  for (let i = 0; i < wait.tries; i++) {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const timedOut = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('no answer')), limit) })
      const reply = await Promise.race([read(), timedOut])
      if (isPairedReply(reply)) return { paired: true }
      lastError = `unexpected reply: ${reply.slice(0, 60)}`
    } catch (e) {
      // Not paired yet, or no answer: wait and try again. Kept so the test
      // page can show what the browser actually said.
      const err = e as { name?: string; message?: string }
      lastError = [err.name, err.message].filter(Boolean).join(': ')
    }
    finally { clearTimeout(timer) }
    if (i < wait.tries - 1 && wait.delayMs > 0) await new Promise(r => setTimeout(r, wait.delayMs))
  }
  return { paired: false, lastError }
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
