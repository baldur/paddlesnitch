import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { listUserDeviceSessions } from '@/lib/devices'

// GET /api/account/devices/sessions — AUTHENTICATED. Every session the signed-in
// user's trackers have uploaded (metadata only), newest first.
export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ sessions: await listUserDeviceSessions(user.id) })
}
