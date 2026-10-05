import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getUserDevice, touchDevice, uploadReceipt } from '@/lib/devices'
import { handleSessionUpload } from '@/lib/session-upload'
import { reportedFirmware, reportedModel } from '@/lib/device-route'

// POST /api/account/devices/[deviceId]/sessions — AUTHENTICATED (browser).
// The owner's browser relaying a recording it read off the tracker over
// Bluetooth (docs/features/tracker-bluetooth-sync.md). Uploads as the
// signed-in user, so the tracker's token never crosses Bluetooth; the handling
// is the tracker's own (lib/session-upload.ts): same pieces, compression,
// duplicate checks. The answer carries a receipt the tracker checks before it
// marks the recording sent.
export async function POST(req: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { deviceId } = await params
  const device = await getUserDevice(user.id, deviceId)
  // 404, not 403: don't reveal whether someone else's tracker exists.
  if (!device?.tokenHash) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // The page passes on what the tracker said it runs (its About record), so a
  // tracker that only ever syncs by phone still shows as seen and current.
  await touchDevice(deviceId, { firmware: reportedFirmware(req), model: reportedModel(req) })

  const res = await handleSessionUpload(req, { deviceId, userId: user.id })
  // Accepted (201) or already here (409 already_uploaded): either way the
  // tracker may mark it sent, so both carry the receipt.
  if (res.status !== 201 && res.status !== 409) return res
  const body = await res.json().catch(() => ({})) as Record<string, unknown>
  if (res.status === 409 && body.error !== 'already_uploaded') return NextResponse.json(body, { status: 409 })
  const filename = new URL(req.url).searchParams.get('filename') ?? ''
  return NextResponse.json({ ...body, receipt: uploadReceipt(device.tokenHash, deviceId, filename) }, { status: res.status })
}
