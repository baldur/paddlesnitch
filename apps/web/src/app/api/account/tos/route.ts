import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getTosConsent, recordAcceptance, hasAcceptedCurrent } from '@/lib/tos'
import { CURRENT_TOS_VERSION } from '@/lib/types'

// GET /api/account/tos
// Whether the authenticated viewer has accepted the current ToS version.
// 401 for unauthenticated requests.
export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const accepted = await hasAcceptedCurrent(user.id)
  const rec = await getTosConsent(user.id)
  return NextResponse.json({
    currentVersion: CURRENT_TOS_VERSION,
    accepted,
    acceptances: rec?.acceptances ?? [],
  })
}

// POST /api/account/tos  { version }
// Records an acceptance of the supplied version (or the current one if
// omitted). 422 if the version doesn't match the current one — we don't
// let users pre-accept future versions.
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const version = typeof body.version === 'string' ? body.version : CURRENT_TOS_VERSION
  if (version !== CURRENT_TOS_VERSION) {
    return NextResponse.json(
      { error: `Only the current ToS version (${CURRENT_TOS_VERSION}) can be accepted` },
      { status: 422 }
    )
  }
  const updated = await recordAcceptance(user.id, version)
  return NextResponse.json({ acceptances: updated.acceptances })
}
