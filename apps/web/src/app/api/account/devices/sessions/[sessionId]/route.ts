import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { recordingReport, recordingReportVersion } from '@/lib/recording-report'
import { etagMatches } from '@/lib/etag'

// GET /api/account/devices/sessions/[sessionId]?deviceId=X — AUTHENTICATED.
// The raw-data diagnostic for one of the user's device sessions: every column,
// fix/no-fix counts, movement-gated distance, an honest stroke-rate verdict and
// the boat motion (docs/features/device-data.md). Owner-gated: someone else's
// recording is 404.
//
// Worked out once per recording version (lib/recording-report.ts), and sent
// with that version as its ETag: a repeat view the browser already has is a
// 304 with no body, before anything but the recording's metadata is read.
export async function GET(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { sessionId } = await params
  const deviceId = (new URL(req.url).searchParams.get('deviceId') ?? '').toUpperCase()

  const version = await recordingReportVersion(user.id, deviceId, sessionId)
  if (!version) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const etag = `"${version}"`
  // Private: only this signed-in user's browser keeps it, and checks back each time.
  const headers = { ETag: etag, 'Cache-Control': 'private, no-cache' }
  if (etagMatches(req.headers.get('if-none-match'), etag)) return new NextResponse(null, { status: 304, headers })

  const r = await recordingReport(user.id, deviceId, sessionId)
  if (!r) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json(r, { headers })
}
