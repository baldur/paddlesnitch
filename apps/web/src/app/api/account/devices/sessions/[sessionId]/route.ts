import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getDeviceSessionTrace } from '@/lib/devices'
import { describeDeviceData } from '@paddlesnitch/timing/device'

// GET /api/account/devices/sessions/[sessionId]?deviceId=X — AUTHENTICATED.
// The raw-data diagnostic for one of the user's device sessions: every column,
// fix/no-fix counts, movement-gated distance, and an honest stroke-rate verdict
// (see docs/features/device-data.md). Owner-gated via getDeviceSessionTrace.
export async function GET(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { sessionId } = await params
  const deviceId = (new URL(req.url).searchParams.get('deviceId') ?? '').toUpperCase()

  const buf = await getDeviceSessionTrace(user.id, deviceId, sessionId)
  if (!buf) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ report: describeDeviceData(buf.toString('utf8')) })
}
