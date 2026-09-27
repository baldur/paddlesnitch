import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { isPlatformAdmin } from '@/lib/admin'
import { isDeviceId } from '@/lib/devices'
import { listDeviceFirmwareEvents } from '@/lib/firmware'

// GET /api/admin/devices/:deviceId/firmware-events — HUMAN platform admin only.
// docs/features/device-ota-and-auth.md §1.6.
//
// One device's rollout history: which versions it was offered, and how each one
// booted. This is the thing you read when someone says "my tracker has been
// weird since last week".
//
// Deliberately no UI in this phase. A route an administrator can curl is enough,
// and the audit line below is the part that actually matters — looking across
// accounts at which physical device belongs to whom is exactly the access that
// should leave a trace, including when it is me doing it.
//
// `getAuthUser`, never `getDeviceAuth`: a device token must not reach this, or a
// stolen tracker becomes a fleet-wide read. The two auth paths stay separate.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ deviceId: string }> },
) {
  const user = await getAuthUser()
  // 401 vs 403 is a real distinction here and worth keeping: signed out is
  // fixable by signing in, not-an-admin never is.
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isPlatformAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const { deviceId } = await params
  if (!isDeviceId(deviceId)) return NextResponse.json({ error: 'bad_device_id' }, { status: 400 })

  // Written BEFORE the read, so an access is recorded even if the read throws.
  console.log(JSON.stringify({
    audit: 'admin.firmware_events.read',
    actorId: user.id,
    actorEmail: user.email,
    deviceId,
    at: new Date().toISOString(),
  }))

  return NextResponse.json({ deviceId, events: await listDeviceFirmwareEvents(deviceId) })
}
