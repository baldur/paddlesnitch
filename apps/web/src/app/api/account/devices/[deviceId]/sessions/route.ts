import { NextResponse } from 'next/server'
import { getRequestUser, getRequestUserEvenIfErased } from '@/lib/auth'
import { getUserDevice, touchDevice, uploadReceipt, stagedUploadParts, isPhone } from '@/lib/devices'
import { handleSessionUpload } from '@/lib/session-upload'
import { reportedFirmware, reportedModel } from '@/lib/device-route'
import { withAction } from '@/lib/action'
import { erasedAnswer } from '@/lib/erased-answer'

// POST /api/account/devices/[deviceId]/sessions — AUTHENTICATED (browser).
// The owner's browser relaying a recording it read off the tracker over
// Bluetooth (docs/features/tracker-bluetooth-sync.md). Uploads as the
// signed-in user, so the tracker's token never crosses Bluetooth; the handling
// is the tracker's own (lib/session-upload.ts): same pieces, compression,
// duplicate checks. The answer carries a receipt the tracker checks before it
// marks the recording sent.
//
// A phone's own recordings come here too (C3): the app adds the phone to the
// account (POST /api/account/devices/phone) and uploads as its owner. A phone
// has no tracker token, so its answers carry no receipt.
async function post(req: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  const user = await getRequestUserEvenIfErased(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // An account being deleted, or deleted with its token still valid (C3).
  const erased = await erasedAnswer(user.id)
  if (erased) return erased
  const { deviceId } = await params
  const device = await getUserDevice(user.id, deviceId)
  // 404, not 403: don't reveal whether someone else's tracker exists. A
  // removed phone is 404 too: the app adds itself again only when its owner
  // next records.
  const phone = !!device && isPhone(device)
  if (!device || (!phone && !device.tokenHash)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // The page passes on what the tracker said it runs (its About record), so a
  // tracker that only ever syncs by phone still shows as seen and current. A
  // phone is only marked seen: its model was set when it was added.
  await touchDevice(deviceId, phone ? {} : { firmware: reportedFirmware(req), model: reportedModel(req) })

  const res = await handleSessionUpload(req, { deviceId, userId: user.id })
  if (phone) return res
  // Accepted (201) or already here (409 already_uploaded): either way the
  // tracker may mark it sent, so both carry the receipt.
  if (res.status !== 201 && res.status !== 409) return res
  const body = await res.json().catch(() => ({})) as Record<string, unknown>
  if (res.status === 409 && body.error !== 'already_uploaded') return NextResponse.json(body, { status: 409 })
  const filename = new URL(req.url).searchParams.get('filename') ?? ''
  return NextResponse.json({ ...body, receipt: uploadReceipt(device.tokenHash, deviceId, filename) }, { status: res.status })
}

// GET /api/account/devices/[deviceId]/sessions?filename=X — AUTHENTICATED.
// The pieces of X the server already holds from a sync that broke off, so the
// page sends only the rest: { parts: [1, 2, …] }. Empty once the file has been
// put together (its pieces are cleared), and for a file never started.
// A tracker recording relayed by the owner's phone over Bluetooth is a tracker
// sync too; its client is the phone's browser or app.
export const POST = withAction('device_sync', post)

export async function GET(req: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { deviceId } = await params
  if (!(await getUserDevice(user.id, deviceId))) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const filename = new URL(req.url).searchParams.get('filename') ?? ''
  return NextResponse.json({ parts: await stagedUploadParts(deviceId, filename) })
}
