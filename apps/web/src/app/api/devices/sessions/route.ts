import { NextResponse } from 'next/server'
import { getDeviceAuth } from '@/lib/auth'
import { findUploadedSession, storeDeviceSession } from '@/lib/devices'
import { parseTrace } from '@paddlesnitch/timing/parse'
import { haversine } from '@paddlesnitch/timing/geo'

// POST /api/devices/sessions?filename=track_0005.csv — device token (Bearer).
// Body is the raw CSV streamed from the SD card (not multipart — the device has
// no heap for that). Reuses parseTrace() UNCHANGED: the firmware emits the
// existing CSV columns, so there is no device-specific parser. See
// docs/features/device-uplink.md.
const MAX_BYTES = 2 * 1024 * 1024

export async function POST(req: Request) {
  const auth = await getDeviceAuth(req)
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const filename = new URL(req.url).searchParams.get('filename') ?? ''
  if (!/^[\w.-]{1,128}$/.test(filename)) return NextResponse.json({ error: 'bad_filename' }, { status: 400 })

  // Idempotency by deviceId+filename — a retry after a dropped response is a no-op.
  const existing = await findUploadedSession(auth.deviceId, filename)
  if (existing) return NextResponse.json({ error: 'already_uploaded', sessionId: existing }, { status: 409 })

  const ab = await req.arrayBuffer()
  if (ab.byteLength > MAX_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 413 })

  const parsed = await parseTrace(filename, ab)
  // No usable points (e.g. an all-unfixed indoor session, whose empty lat/lon
  // rows the parser skips) → 422 so the device marks it uploaded and stops
  // retrying forever. Never invents 0,0 "Null Island" points.
  if (!parsed.ok || parsed.track.length === 0) return NextResponse.json({ error: 'no_points' }, { status: 422 })

  const track = parsed.track
  const startedAt = track[0].timestamp.toISOString()
  const endedAt = track[track.length - 1].timestamp.toISOString()
  let dist = 0
  for (let i = 1; i < track.length; i++) dist += haversine([track[i - 1].lat, track[i - 1].lng], [track[i].lat, track[i].lng])

  const meta = await storeDeviceSession(
    { deviceId: auth.deviceId, userId: auth.userId, filename, startedAt, endedAt, distanceMetres: Math.round(dist), points: track.length },
    Buffer.from(ab),
  )
  return NextResponse.json(
    { sessionId: meta.sessionId, points: track.length, startedAt, endedAt, distanceMetres: meta.distanceMetres },
    { status: 201 },
  )
}
