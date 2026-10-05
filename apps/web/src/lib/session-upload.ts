import { NextResponse } from 'next/server'
import { inflateSync } from 'zlib'
import type { DeviceAuth } from '@paddlesnitch/core/devices'
import { findUploadedSession, storeDeviceSession, storeDeviceMotion, storeUploadPart, clearUploadParts, motionSidecarTrackName } from '@/lib/devices'
import { parseTrace } from '@paddlesnitch/timing/parse'
import { movementDistanceM } from '@paddlesnitch/timing/device'
import { parseMotionCsv } from '@paddlesnitch/timing/cadence'

// The upload handling behind POST /api/devices/sessions (the tracker, with its
// own token) and POST /api/account/devices/[deviceId]/sessions (the owner's
// browser relaying recordings it read over Bluetooth). One implementation, so
// the two can never disagree about chunks, compression or duplicates.
//
// POST /api/devices/sessions?filename=track_0005.csv — device token (Bearer).
// Body is the raw CSV streamed from the SD card (not multipart — the device has
// no heap for that). Reuses parseTrace() UNCHANGED: the firmware emits the
// existing CSV columns, so there is no device-specific parser. See
// docs/features/device-uplink.md.
// A Lambda function URL request tops out around 6 MB, so this can be raised but
// not removed. 4 MB leaves room for a ~2.6-hour motion sidecar at the 10 Hz the
// device decimates to (1.51 MB/hour) while staying clear of that ceiling.
const MAX_BYTES = 4 * 1024 * 1024

export async function handleSessionUpload(req: Request, auth: DeviceAuth): Promise<Response> {
  const url = new URL(req.url)
  const filename = url.searchParams.get('filename') ?? ''
  if (!/^[\w.-]{1,128}$/.test(filename)) return NextResponse.json({ error: 'bad_filename' }, { status: 400 })

  // Idempotency by deviceId+filename — a retry after a dropped response is a no-op.
  const existing = await findUploadedSession(auth.deviceId, filename)
  if (existing) return NextResponse.json({ error: 'already_uploaded', sessionId: existing }, { status: 409 })

  const ab = await req.arrayBuffer()
  if (ab.byteLength > MAX_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 413 })

  // ?enc=zlib: this body (one part, or a whole small file) was compressed on
  // the tracker. Unpack it here, so what is stored and assembled is exactly
  // what an uncompressed upload would have stored — and the sha256 stays over
  // the uncompressed file. A query parameter, not Content-Encoding: proxies
  // and CDNs rewrite encoding headers. Unknown values are refused rather than
  // stored as if they were CSV. The size limit applies to the UNPACKED bytes,
  // so a small compressed body can't expand past it.
  // The device MUST send compressed bodies as application/octet-stream: a Lambda
  // function URL passes a text/* body through as a string, which mangles binary.
  const enc = url.searchParams.get('enc')
  let body: Buffer = Buffer.from(ab)
  if (enc !== null) {
    if (enc !== 'zlib') return NextResponse.json({ error: 'bad_encoding' }, { status: 400 })
    try {
      body = inflateSync(body, { maxOutputLength: MAX_BYTES })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
        return NextResponse.json({ error: 'too_large' }, { status: 413 })
      }
      return NextResponse.json({ error: 'bad_encoding' }, { status: 400 })
    }
  }

  // A motion sidecar (`track_<stamp>_imu.csv`) is not a paddle: it carries no
  // position, so parseTrace would correctly reject it. It attaches to the track
  // of the same name, which must already be uploaded.
  const trackName = motionSidecarTrackName(filename)

  // Chunked upload of ANY file: ?part=N&parts=M, optionally &sha256=<hex> over
  // the assembled whole. Purely transport — once the last part lands, the
  // assembled buffer falls through to exactly the same handling a single-shot
  // upload gets. Tracks need this as much as sidecars do: the device cannot read
  // a large file off its card while HTTP is in flight, and a sidecar cannot
  // attach until its track has been uploaded.
  const partRaw = url.searchParams.get('part')
  let assembledParts = 0
  if (partRaw !== null) {
    const part = Number(partRaw)
    const parts = Number(url.searchParams.get('parts'))
    const sha = url.searchParams.get('sha256') ?? undefined
    if (sha !== undefined && !/^[0-9a-f]{64}$/i.test(sha)) {
      return NextResponse.json({ error: 'bad_sha256' }, { status: 400 })
    }
    const r = await storeUploadPart(auth.deviceId, filename, part, parts, body, sha)
    switch (r.status) {
      case 'bad_request':
        return NextResponse.json({ error: 'bad_part' }, { status: 409 })
      case 'stored':
        return NextResponse.json({ part, parts, have: r.have }, { status: 202 })
      // 409 so the device fills the gap and re-sends the final part.
      case 'incomplete':
        return NextResponse.json({ error: 'parts_missing', missing: r.missing, parts: r.parts }, { status: 409 })
      case 'corrupt':
        return NextResponse.json({ error: 'sha256_mismatch', expected: r.expected, actual: r.actual }, { status: 422 })
      default:
        body = r.body
        assembledParts = parts
    }
  }

  if (trackName) {
    const rows = parseMotionCsv(body.toString('utf8')).length
    if (rows === 0) return NextResponse.json({ error: 'no_motion_rows' }, { status: 422 })
    const stored = await storeDeviceMotion(auth.deviceId, auth.userId, trackName, body, rows)
    // 409, not 404: the track may simply not have been sent yet, and the device
    // should retry this file rather than mark it done.
    if (stored === 'no_track') return NextResponse.json({ error: 'track_not_uploaded', trackFilename: trackName }, { status: 409 })
    if (assembledParts) await clearUploadParts(auth.deviceId, filename, assembledParts)
    return NextResponse.json({ sessionId: stored.sessionId, motionRows: rows, bytes: body.length }, { status: 201 })
  }

  // parseTrace takes an ArrayBuffer; `body` may be an assembled Buffer, so give
  // it exactly this Buffer's bytes rather than the whole backing store.
  const parsed = await parseTrace(
    filename,
    body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
  )
  // No usable points (e.g. an all-unfixed indoor session, whose empty lat/lon
  // rows the parser skips) → 422 so the device marks it uploaded and stops
  // retrying forever. Never invents 0,0 "Null Island" points.
  if (!parsed.ok || parsed.track.length === 0) return NextResponse.json({ error: 'no_points' }, { status: 422 })

  const track = parsed.track
  const startedAt = track[0].timestamp.toISOString()
  const endedAt = track[track.length - 1].timestamp.toISOString()
  // Movement-gated, never a raw sum of fixes: GPS scatter on a tracker sitting
  // still invents distance (~1.4 km in ten minutes on a jetty).
  const dist = movementDistanceM(track.map(p => ({ lat: p.lat, lng: p.lng, tMs: p.timestamp.getTime() })))

  const meta = await storeDeviceSession(
    { deviceId: auth.deviceId, userId: auth.userId, filename, startedAt, endedAt, distanceMetres: Math.round(dist), points: track.length },
    body,
  )
  if (assembledParts) await clearUploadParts(auth.deviceId, filename, assembledParts)
  return NextResponse.json(
    { sessionId: meta.sessionId, points: track.length, startedAt, endedAt, distanceMetres: meta.distanceMetres },
    { status: 201 },
  )
}
