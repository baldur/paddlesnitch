import { NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { addPhone } from '@/lib/devices'

// POST /api/account/devices/phone — AUTHENTICATED (the apps' Bearer token).
// { installId, model: 'phone-android' | 'phone-ios' } → { deviceId, name, model }.
// Adds the phone the app runs on to the account so its recordings upload like a
// tracker's (C3, mobile/contract/README.md § Phone recording). Asking again
// with the same install ID returns the same phone.
export async function POST(req: Request) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const r = await addPhone(user.id, { installId: body?.installId, model: body?.model })
  if ('error' in r) {
    return r.error === 'too_many'
      ? NextResponse.json({ error: "Couldn't add this phone: your account has 10 already. Remove one on Devices, then try again." }, { status: 409 })
      : NextResponse.json({ error: "Couldn't add this phone. Please update the app." }, { status: 400 })
  }
  return NextResponse.json(r, { status: 201 })
}
