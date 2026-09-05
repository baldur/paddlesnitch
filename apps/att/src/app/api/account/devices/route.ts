import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { listUserDevices, revokeDevice } from '@/lib/devices'

// GET /api/account/devices — AUTHENTICATED. The signed-in user's linked devices.
export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ devices: await listUserDevices(user.id) })
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
