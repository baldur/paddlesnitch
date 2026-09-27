import { NextResponse } from 'next/server'
import { getDeviceAuth } from '@/lib/auth'
import type { DeviceAuth } from '@paddlesnitch/core/devices'
import { getChannelVersion } from '@/lib/firmware'
import { touchDevice } from '@/lib/devices'

// The one place a device-authenticated route is defined.
//
// Two jobs, and the second is the reason this wrapper exists rather than each
// route calling getDeviceAuth itself:
//
//   1. 401 when the bearer token doesn't resolve.
//   2. Stamp `X-PS-Firmware` on EVERY response — including the error ones and
//      each of the ~48 chunk responses in a sync.
//
// (2) is the whole OTA signal (docs/features/device-ota-and-auth.md §1.3): the
// device learns a new version exists from a response it was already receiving,
// so in the steady state it never makes a firmware request at all. The upload
// route returns from fourteen different places; asking each to remember a header
// is how the signal silently stops working for the one path that matters.
//
// The header is omitted entirely when no version is promoted, which is the
// normal state until the first release. An absent header means "no opinion",
// not "you are current" — the device must not act on its absence.

export const FIRMWARE_HEADER = 'X-PS-Firmware'

/** The firmware version the device reports it is running, from the header the
 *  uplink already sends on every request. Null when absent or implausible. */
export function reportedFirmware(req: Request): string | null {
  const v = req.headers.get('x-device-firmware')?.trim()
  return v && v.length <= 32 ? v : null
}

/** The device model, for metric dimensions. Bounded, because it becomes a
 *  CloudWatch dimension value. */
export function reportedModel(req: Request): string {
  const m = req.headers.get('x-device-model')?.trim()
  return m && /^[\w.-]{1,40}$/.test(m) ? m : 'unknown'
}

export type DeviceHandler = (req: Request, auth: DeviceAuth) => Promise<Response> | Response

export function withDeviceAuth(handler: DeviceHandler) {
  return async (req: Request): Promise<Response> => {
    const auth = await getDeviceAuth(req)
    // Record what this device says it is running, on every authenticated
    // request. Here rather than in each route for the same reason the firmware
    // header is stamped here: the upload route alone returns from fourteen
    // places. Rate-limited internally, and it never throws.
    if (auth) await touchDevice(auth.deviceId, { firmware: reportedFirmware(req), model: reportedModel(req) })
    const res = auth
      ? await handler(req, auth)
      : NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    await stampFirmwareHeader(res)
    return res
  }
}

/** Add the channel version to a response, if there is one. Never throws: the
 *  OTA signal is strictly additive and must not be able to fail an upload. */
export async function stampFirmwareHeader(res: Response): Promise<void> {
  try {
    const version = await getChannelVersion('stable')
    if (version) res.headers.set(FIRMWARE_HEADER, version)
  } catch {
    // no signal this time; the device keeps running what it has
  }
}
