import { NextResponse } from 'next/server'
import { redeemToken, isDeviceId } from '@/lib/devices'
import { limitTokenPoll } from '@/lib/device-limits'

// POST /api/devices/token — UNAUTHENTICATED, polled by the device every ~5s with
// { deviceId, claimSecret } until the user enters the code. A wrong secret is
// indistinguishable from "not entered yet" (both → 202 pending), so this never
// reveals whether a device/secret exists. On success the claim is consumed; a
// second call returns 410. See docs/features/device-uplink.md.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.toUpperCase() : ''
  const claimSecret = typeof body?.claimSecret === 'string' ? body.claimSecret : ''
  if (!deviceId || !claimSecret) return NextResponse.json({ status: 'pending' }, { status: 202 })
  // Validate before the limiter, so the key is always a clean 8-hex string and a
  // malformed id cannot spend a real device's allowance. A bad id still answers
  // `pending` rather than a distinct error — the endpoint deliberately never
  // reveals whether a device exists.
  if (!isDeviceId(deviceId)) return NextResponse.json({ status: 'pending' }, { status: 202 })

  const limit = await limitTokenPoll(deviceId)
  if (limit.limited) return limit.response

  const r = await redeemToken(deviceId, claimSecret)
  if (r.status === 'bound') {
    return NextResponse.json({ deviceToken: r.deviceToken, userId: r.userId, deviceName: r.deviceName }, { status: 200 })
  }
  if (r.status === 'expired') return NextResponse.json({ error: 'claim_expired' }, { status: 410 })
  return NextResponse.json({ status: 'pending' }, { status: 202 })
}
