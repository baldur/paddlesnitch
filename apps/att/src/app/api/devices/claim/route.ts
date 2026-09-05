import { NextResponse } from 'next/server'
import { createClaim, isDeviceId } from '@/lib/devices'

// POST /api/devices/claim — UNAUTHENTICATED. Called by the device to start a
// pairing claim; it then shows the returned claimCode on its OLED. The
// claimSecret is returned once and held only by the device. See
// docs/features/device-uplink.md. (Rate limiting is a follow-up — see the PR.)
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.toUpperCase() : ''
  if (!isDeviceId(deviceId)) return NextResponse.json({ error: 'bad_device_id' }, { status: 400 })
  const model = typeof body?.model === 'string' ? body.model.slice(0, 64) : ''
  const firmware = typeof body?.firmware === 'string' ? body.firmware.slice(0, 32) : ''

  const claim = await createClaim(deviceId, model, firmware)
  return NextResponse.json({ claimCode: claim.claimCode, claimSecret: claim.claimSecret, expiresAt: claim.expiresAt })
}
