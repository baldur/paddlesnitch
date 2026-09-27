import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { listUserDevices, revokeDevice } from '@/lib/devices'
import { getChannelVersion } from '@/lib/firmware'

// GET /api/account/devices — AUTHENTICATED. The signed-in user's linked devices.
//
// `tokenHash` is stripped rather than shipped: it is sha256 of the device's
// bearer token, it authenticates nothing on the browser side, and it has no
// business in a client bundle. Serialise the fields explicitly so a field added
// to DeviceRecord later isn't published by accident.
export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const devices = (await listUserDevices(user.id)).map(d => ({
    deviceId: d.deviceId, name: d.name, model: d.model, firmware: d.firmware,
    linkedAt: d.linkedAt, lastSeenAt: d.lastSeenAt,
  }))
  // What the stable channel currently offers, so the page can say whether a
  // device is BEHIND rather than just printing a version nobody can calibrate.
  // Never fails the request: a device list is useful without it.
  let stableVersion: string | null = null
  try { stableVersion = await getChannelVersion('stable') } catch { /* non-fatal */ }
  return NextResponse.json({ devices, stableVersion })
}

// DELETE /api/account/devices — AUTHENTICATED. Revoke one device ({ deviceId }):
// deletes its token record, so the device gets 401 on its next sync and falls
// back to claiming. Returns 404 if the caller doesn't own that device.
export async function DELETE(req: Request) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.toUpperCase() : ''
  const ok = await revokeDevice(user.id, deviceId)
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
