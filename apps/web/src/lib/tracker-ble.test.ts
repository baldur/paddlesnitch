import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { TRACKER_SERVICE, TRACKER_ABOUT, TRACKER_PAIRED, TRACKER_LINK, TRACKER_WIFI, parseAbout, ownership, isPairedReply, readWhenPaired, PAIRING_WAIT, parseLinkStatus, parseWifiState, wifiMessage, linkErrorMessage, setupErrorMessage, TRACKER_SYNC, TRACKER_DATA, parseSyncStatus, parsePendingList, readPayload } from './tracker-ble'

const header = readFileSync(path.resolve(__dirname, '../../../../firmware/include/ble_about.h'), 'utf8')

describe('tracker Bluetooth contract', () => {
  // A mismatch here means the page can't find a single tracker, silently.
  it('uses the same service and About ids as the firmware', () => {
    expect(header).toContain(`#define PS_BLE_SERVICE_UUID "${TRACKER_SERVICE}"`)
    expect(header).toContain(`#define PS_BLE_ABOUT_UUID   "${TRACKER_ABOUT}"`)
    expect(header).toContain(`#define PS_BLE_PAIRED_UUID  "${TRACKER_PAIRED}"`)
  })

  it('reads the About record the firmware writes', () => {
    // Exactly the string firmware/test/test_ble_about expects bleAboutJson to produce.
    const a = parseAbout('{"v":1,"id":"435AC17C","fw":"0.18.0","model":"lilygo-tbeam-s3-supreme","waiting":2,"linked":true}')
    expect(a).toEqual({ id: '435AC17C', firmware: '0.18.0', model: 'lilygo-tbeam-s3-supreme', waiting: 2, linked: true })
  })

  it('keeps "not counted yet" apart from "nothing waiting"', () => {
    expect(parseAbout('{"v":1,"id":"435AC17C","fw":"x","model":"m","waiting":null,"linked":false}')!.waiting).toBeNull()
  })

  it('refuses a payload version it does not know, or anything that is not a tracker id', () => {
    expect(parseAbout('{"v":2,"id":"435AC17C","fw":"x","model":"m","waiting":0,"linked":true}')).toBeNull()
    expect(parseAbout('{"v":1,"id":"<script>","fw":"x","model":"m","waiting":0,"linked":true}')).toBeNull()
    expect(parseAbout('not json')).toBeNull()
  })

  it('recognises the reply a paired connection gets', () => {
    // Exactly PS_BLE_PAIRED_JSON in the firmware header.
    expect(header).toContain('#define PS_BLE_PAIRED_JSON  "{\\"v\\":1,\\"paired\\":true}"')
    expect(isPairedReply('{"v":1,"paired":true}')).toBe(true)
    expect(isPairedReply('{"v":1,"paired":false}')).toBe(false)
    expect(isPairedReply('nope')).toBe(false)
  })

  // Found on Android: the tracker sent the C string's terminating zero byte
  // too, JSON.parse refused it, and the page said "unexpected reply" for a
  // phone that had paired.
  it('accepts a reply with a trailing zero byte', () => {
    expect(isPairedReply('{"v":1,"paired":true}\u0000')).toBe(true)
    expect(parseAbout('{"v":1,"id":"435AC17C","fw":"x","model":"m","waiting":0,"linked":true}\u0000')).not.toBeNull()
  })

  it('says whose tracker it is from the signed-in account', () => {
    const mine = new Set(['435AC17C'])
    expect(ownership({ id: '435AC17C', linked: true }, mine)).toBe('yours')
    expect(ownership({ id: '435C09C8', linked: true }, mine)).toBe('elsewhere')
    expect(ownership({ id: '435C09C8', linked: false }, mine)).toBe('unlinked')
  })
})

describe('readWhenPaired', () => {
  // Android Chrome refuses the first protected read at once, while Android's
  // pairing carries on in the background and finishes a few seconds later. The
  // tracker log showed it paired ("2 pairings stored") while the page had
  // already said "Couldn't pair".
  const fast = { tries: 4, delayMs: 0 }

  it('keeps reading while pairing finishes, instead of failing on the first refusal', async () => {
    let n = 0
    const read = async () => { if (++n < 3) throw new Error('insufficient authentication'); return '{"v":1,"paired":true}' }
    expect((await readWhenPaired(read, fast)).paired).toBe(true)
    expect(n).toBe(3)
  })

  it('gives up after the last try (pairing refused or timed out)', async () => {
    let n = 0
    const read = async () => { n++; throw new Error('refused') }
    const r = await readWhenPaired(read, fast)
    expect(r.paired).toBe(false)
    expect(n).toBe(4)
    // What the browser said, for the test page to show.
    expect(r.lastError).toBe('Error: refused')
  })

  // Found on Android: a read that never answers (neither value nor error) left
  // the page on PAIRING… for ever. Each try now has its own time limit.
  it('moves on from a read that never answers, instead of hanging', async () => {
    let n = 0
    const read = () => { n++; return n < 3 ? new Promise<string>(() => {}) : Promise.resolve('{"v":1,"paired":true}') }
    expect((await readWhenPaired(read, { tries: 4, delayMs: 0, readTimeoutMs: 20 })).paired).toBe(true)
    expect(n).toBe(3)
  })

  it('waits about 30 s by default, the most Bluetooth allows for pairing', () => {
    expect(PAIRING_WAIT.tries * (PAIRING_WAIT.delayMs + PAIRING_WAIT.readTimeoutMs)).toBeGreaterThanOrEqual(30000)
  })
})

describe('setup over Bluetooth', () => {
  it('uses the firmware ids for the link and WiFi items', () => {
    expect(header).toContain(`#define PS_BLE_LINK_UUID    "${TRACKER_LINK}"`)
    expect(header).toContain(`#define PS_BLE_WIFI_UUID    "${TRACKER_WIFI}"`)
  })

  it('reads the link status the tracker writes (bleLinkJson)', () => {
    const h = '0123456789abcdef'.repeat(4)
    expect(parseLinkStatus(`{"v":1,"id":"435AC17C","state":"pending","tokenHash":"${h}"}\u0000`))
      .toEqual({ id: '435AC17C', state: 'pending', tokenHash: h })
    expect(parseLinkStatus('{"v":1,"id":"435AC17C","state":"idle","tokenHash":""}')!.tokenHash).toBe('')
    expect(parseLinkStatus('{"v":1,"id":"435AC17C","state":"weird","tokenHash":""}')).toBeNull()
  })

  it('reads the WiFi state and says it in plain words', () => {
    expect(parseWifiState('{"v":1,"state":"wrong_password"}')).toBe('wrong_password')
    expect(parseWifiState('{"v":1,"state":"bogus"}')).toBeNull()
    expect(wifiMessage('joined')).toMatch(/joined/i)
    expect(wifiMessage('wrong_password')).toMatch(/password/i)
    expect(wifiMessage('not_found')).toMatch(/2\.4 GHz/)
    // Never vendor words or codes on screen.
    for (const s of ['joined', 'wrong_password', 'not_found', 'failed'] as const) expect(wifiMessage(s)).not.toMatch(/_|ssid/i)
  })

  // Found on Android: the phone kept the tracker's old list of items after a
  // firmware update, so the WIFI item "didn't exist" and the page could only
  // say "Couldn't send". Forgetting the tracker in Bluetooth settings fixed it.
  it('spots an out-of-date copy of the tracker on the phone and says how to fix it', () => {
    const stale = Object.assign(new Error("No Characteristics matching UUID 04dd0a05-9cd1-403e-a461-0b4af515a1b4 found in Service."), { name: 'NotFoundError' })
    expect(setupErrorMessage(stale, 'PT-17C')).toMatch(/forget PT-17C/i)
    expect(setupErrorMessage(new Error('GATT Server is disconnected.'), 'PT-17C')).toMatch(/close by/)
  })

  it('explains each way adding the tracker can fail', () => {
    expect(linkErrorMessage(409, 'owned_elsewhere')).toMatch(/another account/)
    expect(linkErrorMessage(429)).toMatch(/wait/i)
    expect(linkErrorMessage(500)).toMatch(/^Couldn't/)
  })
})

describe('recordings over Bluetooth', () => {
  it('uses the firmware ids and page size', () => {
    expect(header).toContain(`#define PS_BLE_SYNC_UUID    "${TRACKER_SYNC}"`)
    expect(header).toContain(`#define PS_BLE_DATA_UUID    "${TRACKER_DATA}"`)
    expect(header).toContain('#define PS_BLE_PAGE_DATA    500')
  })

  it('reads the SYNC status the tracker writes (bleSyncJson)', () => {
    expect(parseSyncStatus('{"v":1,"state":"ready","len":18234,"part":2,"parts":10,"compressed":true}'))
      .toEqual({ state: 'ready', len: 18234, part: 2, parts: 10, compressed: true })
    expect(parseSyncStatus('{"v":1,"state":"nonsense","len":0,"part":0,"parts":0,"compressed":false}')).toBeNull()
  })

  it('reads the list of waiting recordings', () => {
    expect(parsePendingList('[{"n":"track_x.csv","u":"track_x.csv","s":626441},{"n":"track_x_i10.csv","u":"track_x_imu.csv","s":2231416}]'))
      .toEqual([{ name: 'track_x.csv', upload: 'track_x.csv', size: 626441 }, { name: 'track_x_i10.csv', upload: 'track_x_imu.csv', size: 2231416 }])
    expect(parsePendingList('[{"n":"../etc","u":"x","s":1}]')).toEqual([])   // never a path
  })

  // Pages are [u32 offset LE][bytes]; the offset catches a lost or repeated read.
  const page = (offset: number, bytes: number[]) => {
    const b = new Uint8Array(4 + bytes.length)
    new DataView(b.buffer).setUint32(0, offset, true)
    b.set(bytes, 4)
    return new DataView(b.buffer)
  }

  it('reassembles a payload from offset-stamped pages', async () => {
    const pages = [page(0, [1, 2, 3]), page(3, [4, 5])]
    let i = 0
    const out = await readPayload(async () => pages[i++], async () => {}, 5)
    expect([...out]).toEqual([1, 2, 3, 4, 5])
  })

  it('seeks back when a page arrives out of place, instead of corrupting the recording', async () => {
    // First read returns offset 3 (a page went missing): seek to 0, then good pages.
    const pages = [page(3, [9, 9]), page(0, [1, 2, 3]), page(3, [4, 5])]
    const seeks: number[] = []
    let i = 0
    const out = await readPayload(async () => pages[i++], async (o: number) => { seeks.push(o) }, 5)
    expect([...out]).toEqual([1, 2, 3, 4, 5])
    expect(seeks).toEqual([0])
  })
})
