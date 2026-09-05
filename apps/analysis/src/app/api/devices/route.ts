import { NextResponse } from 'next/server'
import { getAuthUser } from '@paddlesnitch/core/auth'
import { listUserDeviceSessions } from '@/lib/devices'

// The signed-in user's hardware-tracker uploads, offered as paddles to analyse
// (docs/features/device-uplink.md). Auth-gated: only ever your own sessions.
export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })
  const sessions = await listUserDeviceSessions(user.id)
  return NextResponse.json({ sessions })
}
