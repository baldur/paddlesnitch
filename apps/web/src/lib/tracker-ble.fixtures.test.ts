import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { uploadReceipt } from '@paddlesnitch/core/devices'
import {
  TRACKER_SERVICE, TRACKER_ABOUT, TRACKER_PAIRED, TRACKER_LINK, TRACKER_WIFI, TRACKER_SYNC, TRACKER_DATA,
  PAIRING_WAIT, WIFI_WAIT, SYNC_WAIT,
  parseAbout, isPairedReply, parseLinkStatus, parseWifiState, parseSyncStatus, parsePendingList,
} from './tracker-ble'

// The phone apps' copy of the tracker protocol (mobile/contract/fixtures/tracker)
// must say what the firmware and this website say, or an app built from it
// can't talk to a tracker.
const root = path.resolve(__dirname, '../../../..')
const fx = (name: string) => JSON.parse(readFileSync(path.join(root, 'mobile/contract/fixtures/tracker', name), 'utf8'))
const header = readFileSync(path.join(root, 'firmware/include/ble_about.h'), 'utf8')
const ble = readFileSync(path.join(root, 'firmware/src/ble.cpp'), 'utf8')
const uplink = readFileSync(path.join(root, 'firmware/src/uplink.cpp'), 'utf8')

describe('the apps’ tracker fixtures', () => {
  const gatt = fx('gatt.json')

  it('use the firmware’s ids, layout, page and piece sizes', () => {
    const c = gatt.characteristics
    expect([gatt.service, c.about, c.paired, c.link, c.wifi, c.sync, c.data])
      .toEqual([TRACKER_SERVICE, TRACKER_ABOUT, TRACKER_PAIRED, TRACKER_LINK, TRACKER_WIFI, TRACKER_SYNC, TRACKER_DATA])
    for (const [k, v] of Object.entries({ SERVICE: gatt.service, ABOUT: c.about, PAIRED: c.paired, LINK: c.link, WIFI: c.wifi, SYNC: c.sync, DATA: c.data })) {
      expect(header).toMatch(new RegExp(`#define PS_BLE_${k}_UUID\\s+"${v}"`))
    }
    expect(ble).toContain(`BLE_LAYOUT = "${gatt.layout}"`)
    expect(header).toMatch(new RegExp(`#define PS_BLE_PAGE_DATA\\s+${gatt.pageData}\\b`))
    expect(uplink).toContain(`UPLOAD_CHUNK = ${gatt.pieceBytes / 1024} * 1024`)
    expect(ble).toContain(`ssid.length() > ${gatt.wifi.ssidMaxBytes} || pass.length() > ${gatt.wifi.passMaxBytes}`)
  })

  it('wait as long as the website does', () => {
    expect(gatt.waits).toEqual({ pairing: PAIRING_WAIT, wifi: WIFI_WAIT, sync: SYNC_WAIT })
  })

  it('read every reply the way the website reads it', () => {
    const r = fx('replies.json')
    for (const c of r.about) expect(parseAbout(c.raw)).toEqual(c.out)
    for (const c of r.paired) expect(isPairedReply(c.raw)).toBe(c.out)
    for (const c of r.link) expect(parseLinkStatus(c.raw)).toEqual(c.out)
    for (const c of r.wifi) expect(parseWifiState(c.raw)).toBe(c.out)
    for (const c of r.sync) expect(parseSyncStatus(c.raw)).toEqual(c.out)
    for (const c of r.list) expect(parsePendingList(c.raw)).toEqual(c.out)
  })

  it('carry the receipt the server makes', () => {
    const r = fx('receipt.json')
    expect(createHash('sha256').update(r.token).digest('hex')).toBe(r.tokenHash)
    for (const c of r.cases) {
      expect(c.message).toBe(`ps-receipt:v1|${r.deviceId}|${c.upload}`)
      expect(uploadReceipt(r.tokenHash, r.deviceId, c.upload)).toBe(c.receipt)
    }
  })

  it('write a page the way the firmware does', () => {
    const { page } = fx('pages.json')
    const b = Buffer.from(page.hex, 'hex')
    expect(b.readUInt32LE(0)).toBe(page.offset)
    expect(b.subarray(4).toString()).toBe(page.data)
  })
})
