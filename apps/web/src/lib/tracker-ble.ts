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
/** Recordings over Bluetooth, paired-only: SYNC takes commands and reports
 *  state; DATA serves what SYNC prepared, in offset-stamped pages. */
export const TRACKER_SYNC = '04dd0a06-9cd1-403e-a461-0b4af515a1b4'
export const TRACKER_DATA = '04dd0a07-9cd1-403e-a461-0b4af515a1b4'

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

export type SyncStatus = {
  state: 'idle' | 'working' | 'ready' | 'marked' | 'bad_receipt' | 'busy' | 'error'
  len: number; part: number; parts: number; compressed: boolean
}
const SYNC_STATES: SyncStatus['state'][] = ['idle', 'working', 'ready', 'marked', 'bad_receipt', 'busy', 'error']

/** The SYNC item (bleSyncJson). */
export function parseSyncStatus(raw: string): SyncStatus | null {
  try {
    const o = JSON.parse(trimValue(raw)) as Record<string, unknown>
    if (o.v !== 1 || !SYNC_STATES.includes(o.state as SyncStatus['state'])) return null
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
    return { state: o.state as SyncStatus['state'], len: num(o.len), part: num(o.part), parts: num(o.parts), compressed: o.compressed === true }
  } catch { return null }
}

export type PendingRecording = { name: string; upload: string; size: number }
const SAFE_NAME = /^[\w.-]{1,64}$/

/** The waiting recordings, as the tracker lists them: tracks before motion
 *  files. `upload` is the name the server knows a file by. Anything that isn't
 *  a plain file name is dropped. */
export function parsePendingList(raw: string): PendingRecording[] {
  try {
    const arr = JSON.parse(trimValue(raw)) as { n?: unknown; u?: unknown; s?: unknown }[]
    if (!Array.isArray(arr)) return []
    return arr
      .filter(e => typeof e.n === 'string' && SAFE_NAME.test(e.n) && !e.n.startsWith('.') && typeof e.u === 'string' && SAFE_NAME.test(e.u) && typeof e.s === 'number')
      .map(e => ({ name: e.n as string, upload: e.u as string, size: e.s as number }))
  } catch { return [] }
}

/**
 * Read `len` bytes off DATA. Each page is [u32 offset, little-endian][bytes];
 * a page that doesn't start where we are (a read lost or repeated) makes us
 * seek back rather than splice the wrong bytes into a recording.
 */
export async function readPayload(
  readPage: () => Promise<DataView>,
  seek: (offset: number) => Promise<void>,
  len: number,
  maxMisses = 20,
): Promise<Uint8Array> {
  const out = new Uint8Array(len)
  let at = 0, misses = 0
  while (at < len) {
    const p = await readPage()
    if (p.byteLength < 4) throw new Error('empty page')
    const offset = p.getUint32(0, true)
    const n = p.byteLength - 4
    if (offset !== at || n === 0) {
      if (++misses > maxMisses) throw new Error(`pages out of place at ${at}`)
      await seek(at)
      continue
    }
    out.set(new Uint8Array(p.buffer, p.byteOffset + 4, Math.min(n, len - at)), at)
    at += n
  }
  return out
}

/** The Bluetooth and network calls a sync needs; the page wires these to Web
 *  Bluetooth and fetch, and tests to a fake tracker. */
export type SyncIo = {
  command(body: Record<string, unknown>): Promise<void>           // write SYNC
  status(): Promise<SyncStatus | null>                           // read SYNC
  readPage(): Promise<DataView>                                  // read DATA
  seek(offset: number): Promise<void>                            // write DATA {op:seek}
  upload(r: PendingRecording, part: number, parts: number, bytes: Uint8Array, compressed: boolean):
    Promise<{ status: number; body: { error?: string; receipt?: string } }>
  // The pieces the server already has from a sync that broke off.
  staged?(r: PendingRecording): Promise<number[]>
}
export type SyncProgress = { index: number; total: number; name: string; part: number; parts: number }
export type SyncResult = { sent: number; failed: { name: string; reason: 'unusable' | 'receipt' | 'failed' }[] }

/** How long to wait for the tracker to prepare something (it reads the card and
 *  compresses on its upload task). Read at call time, so tests can shorten it. */
export const SYNC_WAIT = { tries: 120, delayMs: 250 }

async function waitForTracker(io: SyncIo, want: SyncStatus['state'][]): Promise<SyncStatus> {
  for (let i = 0; i < SYNC_WAIT.tries; i++) {
    const st = await io.status()
    if (st?.state === 'busy') throw new Error('The tracker is recording. Stop the recording, then sync.')
    if (st && want.includes(st.state)) return st
    if (st?.state === 'error') throw new Error('tracker error')
    if (SYNC_WAIT.delayMs) await new Promise(r => setTimeout(r, SYNC_WAIT.delayMs))
  }
  throw new Error('The tracker took too long to answer.')
}

/**
 * Bring every waiting recording home over Bluetooth: list them, then for each,
 * read it piece by piece (64 KB, zlib when that helped), upload each piece as
 * the signed-in user, and hand the server's receipt back so the tracker marks
 * it sent. Tracks come before their motion files (the tracker lists them that
 * way). One recording failing doesn't stop the rest.
 */
export async function syncOverBluetooth(io: SyncIo, onProgress?: (p: SyncProgress) => void): Promise<SyncResult> {
  await io.command({ op: 'list' })
  const listed = await waitForTracker(io, ['ready'])
  const list = parsePendingList(new TextDecoder().decode(await readPayload(io.readPage, io.seek, listed.len)))
  const result: SyncResult = { sent: 0, failed: [] }
  for (let i = 0; i < list.length; i++) {
    const rec = list[i]
    try {
      // A sync that broke off leaves its pieces on the server: carry on from
      // there rather than reading them across Bluetooth again (the slow part).
      // Safe because every attempt, over Bluetooth or WiFi, cuts the file into
      // the same 64 KB pieces (UPLOAD_CHUNK in firmware/src/uplink.cpp).
      const have = new Set(io.staged ? await io.staged(rec).catch(() => []) : [])
      // Asking for piece 1 tells us how many there are; the tracker only
      // prepares it, nothing crosses Bluetooth until it's read.
      await io.command({ op: 'piece', name: rec.name, part: 1 })
      let st = await waitForTracker(io, ['ready'])
      const parts = Math.max(1, st.parts)
      // The last piece always goes: its arrival is what makes the server put
      // the file together.
      const todo = Array.from({ length: parts }, (_, k) => k + 1).filter(p => !have.has(p) || p === parts)
      let receipt: string | undefined
      for (const part of todo) {
        if (part !== 1) {
          await io.command({ op: 'piece', name: rec.name, part })
          st = await waitForTracker(io, ['ready'])
        }
        onProgress?.({ index: i + 1, total: list.length, name: rec.name, part, parts })
        const bytes = await readPayload(io.readPage, io.seek, st.len)
        const r = await io.upload(rec, part, parts, bytes, st.compressed)
        if (r.status === 202) continue
        if ((r.status === 201 || (r.status === 409 && r.body.error === 'already_uploaded')) && r.body.receipt) {
          receipt = r.body.receipt
          break
        }
        if (r.status === 400 || r.status === 413 || r.status === 422) {
          result.failed.push({ name: rec.name, reason: 'unusable' })
        } else {
          result.failed.push({ name: rec.name, reason: 'failed' })
        }
        break
      }
      if (!receipt) continue
      await io.command({ op: 'done', name: rec.name, receipt })
      const done = await waitForTracker(io, ['marked', 'bad_receipt'])
      if (done.state === 'marked') result.sent++
      else result.failed.push({ name: rec.name, reason: 'receipt' })
    } catch (e) {
      if (/recording/.test((e as Error).message)) throw e
      result.failed.push({ name: rec.name, reason: 'failed' })
    }
  }
  return result
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
