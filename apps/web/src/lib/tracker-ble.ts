// The tracker's Bluetooth service, from the browser's side
// (docs/features/tracker-bluetooth-sync.md, P4). The ids MUST match
// firmware/include/ble_about.h; tracker-ble.test.ts checks they do.

export const TRACKER_SERVICE = '04dd0a01-9cd1-403e-a461-0b4af515a1b4'
export const TRACKER_ABOUT = '04dd0a02-9cd1-403e-a461-0b4af515a1b4'
/** Readable only over a paired connection; reading it is what starts pairing. */
export const TRACKER_PAIRED = '04dd0a03-9cd1-403e-a461-0b4af515a1b4'
/** Setup items, paired-only: link the tracker to an account, and WiFi details. */
export const TRACKER_LINK = '04dd0a04-9cd1-403e-a461-0b4af515a1b4'
export const TRACKER_WIFI = '04dd0a05-9cd1-403e-a461-0b4af515a1b4'

export type TrackerAbout = {
  id: string
  firmware: string
  model: string
  /** Recordings not yet uploaded; null while the tracker hasn't counted its card. */
  waiting: number | null
  /** Whether the tracker is added to an account (any account). */
  linked: boolean
}

// A value set from a C string can carry its terminating zero byte, which
// JSON.parse refuses (it made a paired phone show "unexpected reply").
const trimValue = (raw: string) => raw.replace(/[\u0000\s]+$/, '')

/** About as the tracker sends it (bleAboutJson), or null if it isn't one. */
export function parseAbout(raw: string): TrackerAbout | null {
  let o: unknown
  try { o = JSON.parse(trimValue(raw)) } catch { return null }
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
    const o = JSON.parse(trimValue(raw)) as { v?: unknown; paired?: unknown }
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

export type LinkStatus = { id: string; state: 'idle' | 'pending' | 'committed'; tokenHash: string }

/** The LINK item (bleLinkJson): the tracker's id, where the link is, and the
 *  sha256 of the token it made -- never the token itself. */
export function parseLinkStatus(raw: string): LinkStatus | null {
  try {
    const o = JSON.parse(trimValue(raw)) as Record<string, unknown>
    if (o.v !== 1 || typeof o.id !== 'string' || !/^[0-9A-F]{8}$/.test(o.id)) return null
    if (o.state !== 'idle' && o.state !== 'pending' && o.state !== 'committed') return null
    if (typeof o.tokenHash !== 'string' || !/^([0-9a-f]{64})?$/.test(o.tokenHash)) return null
    return { id: o.id, state: o.state, tokenHash: o.tokenHash }
  } catch { return null }
}

export type WifiState = 'idle' | 'trying' | 'joined' | 'wrong_password' | 'not_found' | 'failed'
const WIFI_STATES: WifiState[] = ['idle', 'trying', 'joined', 'wrong_password', 'not_found', 'failed']

/** The WIFI item (bleWifiJson). */
export function parseWifiState(raw: string): WifiState | null {
  try {
    const st = (JSON.parse(trimValue(raw)) as { v?: unknown; state?: unknown })
    return st.v === 1 && WIFI_STATES.includes(st.state as WifiState) ? (st.state as WifiState) : null
  } catch { return null }
}

/** How long to wait for the tracker to try a network: it takes up to 15 s to
 *  join, plus a scan to tell a wrong password from a missing network. Read at
 *  call time, so tests can shorten it. */
export const WIFI_WAIT = { tries: 30, delayMs: 1500 }

/** What to tell the person once the tracker has tried the network. */
export function wifiMessage(s: Exclude<WifiState, 'idle' | 'trying'>): string {
  switch (s) {
    case 'joined': return 'The tracker joined your WiFi. It will upload over it from now on.'
    case 'wrong_password': return "Couldn't join: the tracker found the network, so the password is probably wrong. Check it and try again."
    case 'not_found': return "Couldn't find that network. Names are case-sensitive, and the tracker only uses 2.4 GHz WiFi."
    default: return "Couldn't join that network. Check the name and password, then try again."
  }
}

/**
 * What to say when talking to the tracker failed during setup. A phone that
 * paired before a firmware update can keep the tracker's old list of items, so
 * a newer item "isn't there" (Chrome: NotFoundError, "No Characteristics
 * matching UUID"). Forgetting the tracker in Bluetooth settings clears it.
 */
export function setupErrorMessage(e: unknown, trackerName: string): string {
  const err = e as { name?: string; message?: string }
  if (err?.name === 'NotFoundError' || /no characteristics matching/i.test(err?.message ?? '')) {
    return `This phone or computer has an out-of-date copy of the tracker's details. In its Bluetooth settings, forget ${trackerName}, then connect and pair again.`
  }
  return "Couldn't reach the tracker. Keep it close by and try again."
}

/** Why adding the tracker to the account failed, from the server's answer. */
export function linkErrorMessage(status: number, code?: string): string {
  if (code === 'owned_elsewhere') return 'This tracker is on another account. Its owner needs to remove it first.'
  if (status === 429) return 'Too many tries. Please wait a while, then try again.'
  return "Couldn't add the tracker. Please try again."
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
          getCharacteristic(uuid: string): Promise<{
            readValue(): Promise<DataView>
            writeValueWithResponse(value: BufferSource): Promise<void>
          }>
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
