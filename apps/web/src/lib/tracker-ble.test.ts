import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { TRACKER_SERVICE, TRACKER_ABOUT, TRACKER_PAIRED, parseAbout, ownership, isPairedReply, readWhenPaired, PAIRING_WAIT } from './tracker-ble'

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
