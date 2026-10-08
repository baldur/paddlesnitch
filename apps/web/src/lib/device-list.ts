import { listUserDevices, listUserDeviceSessions, getDeviceHealth, getLastCrash } from '@/lib/devices'
import { getChannelVersion } from '@/lib/firmware'

// The signed-in user's trackers as DEVICES shows them: GET /api/account/devices
// answers with this, and the page puts it in its first HTML.
//
// `tokenHash` is stripped rather than shipped: it is sha256 of the device's
// bearer token, it authenticates nothing on the browser side, and it has no
// business in a client bundle. Serialise the fields explicitly so a field added
// to DeviceRecord later isn't published by accident.
export async function deviceList(userId: string) {
  const devices = await Promise.all((await listUserDevices(userId)).map(async d => {
    // The last start-up or heartbeat report, reduced to what the page shows.
    const h = await getDeviceHealth(d.deviceId)
    const crash = await getLastCrash(d.deviceId)
    return {
      deviceId: d.deviceId, name: d.name, model: d.model, firmware: d.firmware,
      linkedAt: d.linkedAt, lastSeenAt: d.lastSeenAt,
      ...(h ? { health: { at: h.at, kind: h.kind, resetReason: h.resetReason, crashTask: h.crash?.task } } : {}),
      ...(crash?.crash ? { lastCrash: { at: crash.at, task: crash.crash.task } } : {}),
    }
  }))
  // What the stable channel currently offers, so the page can say whether a
  // device is BEHIND rather than just printing a version nobody can calibrate.
  // Never fails the request: a device list is useful without it.
  let stableVersion: string | null = null
  try { stableVersion = await getChannelVersion('stable') } catch { /* non-fatal */ }
  return { devices, stableVersion }
}

// Everything DEVICES needs, in one go, for its first HTML.
export async function devicesPageData(userId: string) {
  const [list, sessions] = await Promise.all([deviceList(userId), listUserDeviceSessions(userId)])
  return { ...list, sessions }
}
