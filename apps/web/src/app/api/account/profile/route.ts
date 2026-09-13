import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getProfileSettings, setProfilePublic } from '@/lib/profile'

// GET /api/account/profile — the viewer's profile visibility setting.
export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await getProfileSettings(user.id))
}

// PATCH /api/account/profile { public: boolean } — opt in/out of a public
// profile. Profiles are private by default; this is the only way to flip it.
export async function PATCH(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  if (typeof body.public !== 'boolean') {
    return NextResponse.json({ error: 'public must be a boolean' }, { status: 400 })
  }
  return NextResponse.json(await setProfilePublic(user.id, body.public))
}
