import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { TRACKER_SERVICE, TRACKER_ABOUT, parseAbout, ownership } from './tracker-ble'

const header = readFileSync(path.resolve(__dirname, '../../../../firmware/include/ble_about.h'), 'utf8')

describe('tracker Bluetooth contract', () => {
  // A mismatch here means the page can't find a single tracker, silently.
  it('uses the same service and About ids as the firmware', () => {
    expect(header).toContain(`#define PS_BLE_SERVICE_UUID "${TRACKER_SERVICE}"`)
    expect(header).toContain(`#define PS_BLE_ABOUT_UUID   "${TRACKER_ABOUT}"`)
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

  it('says whose tracker it is from the signed-in account', () => {
    const mine = new Set(['435AC17C'])
    expect(ownership({ id: '435AC17C', linked: true }, mine)).toBe('yours')
    expect(ownership({ id: '435C09C8', linked: true }, mine)).toBe('elsewhere')
    expect(ownership({ id: '435C09C8', linked: false }, mine)).toBe('unlinked')
  })
})
