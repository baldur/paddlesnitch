import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { linkByTokenHash } from '@/lib/devices'
import { limitLink } from '@/lib/device-limits'

// POST /api/account/devices/link-bluetooth — AUTHENTICATED (browser). Links a
// tracker set up over Bluetooth: the page read { deviceId, tokenHash } from the
// tracker over a paired connection. The tracker made the token itself and keeps
// it; only its hash comes here. Same limit as linking by code.
export async function POST(req: Request) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const limit = await limitLink(user.id)
  if (limit.limited) return limit.response

  const b = await req.json().catch(() => ({}))
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
  const r = await linkByTokenHash(user.id, {
    deviceId: str(b?.deviceId, 16).toUpperCase(),
    tokenHash: str(b?.tokenHash, 64).toLowerCase(),
    model: str(b?.model, 64) || 'unknown',
    firmware: str(b?.firmware, 32) || 'unknown',
    name: typeof b?.name === 'string' && b.name.trim() ? b.name.slice(0, 64) : undefined,
  })
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.error === 'bad_request' ? 400 : 409 })
  return NextResponse.json(r)
}
