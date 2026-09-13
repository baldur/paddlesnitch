import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { setStravaAutoImport } from '@/lib/strava-storage'

// Turn auto-import of new Strava paddles on/off for the signed-in user.
// Default is ON (see getStravaAutoImport); this persists an explicit choice.
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
  }
  await setStravaAutoImport(user.id, body.enabled)
  return NextResponse.json({ autoImport: body.enabled })
}
