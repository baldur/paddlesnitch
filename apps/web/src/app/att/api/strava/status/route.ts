import { NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { getStravaTokens, getStravaAutoImport } from '@/lib/strava-storage'

// Cheap read for the UI: are we connected, and (if so) which athlete + is
// auto-import on? No token refresh here — we don't need a live access token just
// to render the badge + toggle.
export async function GET(req: Request) {
  const user = await getRequestUser(req)
  // The website's badge treats signed out as "not connected"; an app whose
  // Bearer token has expired must hear 401 instead, so it refreshes it.
  if (!user && req.headers.has('authorization')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user) return NextResponse.json({ connected: false }, { status: 200 })
  const tokens = await getStravaTokens(user.id)
  if (!tokens) return NextResponse.json({ connected: false })
  return NextResponse.json({
    connected: true,
    athlete: { id: tokens.athleteId, name: tokens.athleteName },
    autoImport: await getStravaAutoImport(user.id),
  })
}
