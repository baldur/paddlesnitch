import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getDeviceSessionTrace, getDeviceSessionMotion } from '@/lib/devices'
import { describeDeviceData } from '@paddlesnitch/timing/device'
import { deriveCadence } from '@paddlesnitch/timing/cadence'

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
  try {
    const motion = await getDeviceSessionMotion(user.id, deviceId, sessionId)
    if (motion) cadence = deriveCadence(motion.toString('utf8'), { movingRanges: movingRangesFromTrack(csv) })
  } catch {
    cadence = null
  }

  return NextResponse.json({ report, cadence })
}

/**
 * Millisecond spans where the boat was actually moving, from the track CSV.
 *
 * Without this the cadence search runs over the parked minutes at the start of a
 * session too, where a stationary device produces a confident-looking periodicity
 * that has nothing to do with paddling.
 */
function movingRangesFromTrack(csv: string): [number, number][] {
  const lines = csv.split(/\r?\n/)
  if (lines.length < 2) return []
  const head = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[\s_]/g, ''))
  const msI = head.indexOf('ms')
  const spI = head.findIndex(h => h === 'speedkmh' || h === 'speed')
  if (msI < 0 || spI < 0) return []

  const ranges: [number, number][] = []
  let run: number[] = []
  for (const line of lines.slice(1)) {
    const p = line.split(',')
    if (p.length <= Math.max(msI, spI)) continue
    const ms = Number(p[msI]), sp = Number(p[spI])
    if (!Number.isFinite(ms) || !Number.isFinite(sp)) continue
    if (sp >= 4) run.push(ms)
    else {
      if (run.length >= 90) ranges.push([run[0], run[run.length - 1]])
      run = []
    }
  }
  if (run.length >= 90) ranges.push([run[0], run[run.length - 1]])
  return ranges
}
