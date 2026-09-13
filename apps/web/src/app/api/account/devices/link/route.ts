import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { linkClaim } from '@/lib/devices'

// POST /api/account/devices/link — AUTHENTICATED (browser). The signed-in user
// types the code shown on their device; this binds the pending claim to their
// account. The device collects the actual token on its next poll, so the secret
// never reaches the browser. See docs/features/device-uplink.md.
export async function POST(req: Request) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const claimCode = typeof body?.claimCode === 'string' ? body.claimCode.toUpperCase().trim() : ''
  const name = typeof body?.name === 'string' ? body.name.slice(0, 64) : undefined
  if (!claimCode) return NextResponse.json({ error: 'unknown_code' }, { status: 404 })

  const r = await linkClaim(claimCode, user.id, name)
  if ('error' in r) {
    const status = r.error === 'unknown_code' ? 404 : r.error === 'claim_expired' ? 410 : 409
    return NextResponse.json({ error: r.error }, { status })
  }
  return NextResponse.json({ deviceId: r.deviceId, model: r.model })
}
