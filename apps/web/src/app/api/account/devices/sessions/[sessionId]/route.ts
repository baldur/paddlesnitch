import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getDeviceSessionTrace, getDeviceSessionMotion } from '@/lib/devices'
import { describeDeviceData } from '@paddlesnitch/timing/device'
import { deriveCadence, movingRangesFromTrack } from '@paddlesnitch/timing/cadence'
import { deriveAttitude } from '@paddlesnitch/timing/attitude'

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
  const csv = buf.toString('utf8')
  const report = describeDeviceData(csv)

  // Real cadence, when the motion sidecar has been uploaded for this session.
  // Best-effort: a missing or unreadable sidecar leaves the existing honest
  // "not derivable from 1 Hz peaks" verdict in place rather than failing the page.
  let cadence = null
  let attitude = null
  try {
    const motion = await getDeviceSessionMotion(user.id, deviceId, sessionId)
    if (motion) {
      const text = motion.toString('utf8')
      const movingRanges = movingRangesFromTrack(csv)
      cadence = deriveCadence(text, { movingRanges })
      attitude = deriveAttitude(text, { movingRanges })
    }
  } catch {
    cadence = null
    attitude = null
  }

  return NextResponse.json({ report, cadence, attitude })
}
