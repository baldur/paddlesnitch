import { NextResponse } from 'next/server'
import { withDeviceAuth } from '@/lib/device-route'
import { registerDeviceKeyByToken } from '@/lib/devices'

// POST /api/devices/identity — the tracker's own token. Registers the tracker's
// public key ({ publicKey: base64 SPKI DER, P-256 }) for the ID its token is
// bound to, so a tracker that was on an account before keys existed can be
// re-claimed later without a cable. First key wins: a different key is 409 and
// only a cable enrolment (firmware/tools/enroll.sh) replaces it -- otherwise a
// stolen token could swap the key and take the ID for good.
export const POST = withDeviceAuth(async (req, auth) => {
  const body = await req.json().catch(() => null)
  const r = await registerDeviceKeyByToken(auth.deviceId, body?.publicKey)
  if (r === 'bad_key') return NextResponse.json({ error: 'bad_key' }, { status: 400 })
  if (r === 'conflict') return NextResponse.json({ error: 'key_differs' }, { status: 409 })
  return NextResponse.json({ ok: true }, { status: r === 'registered' ? 201 : 200 })
})
