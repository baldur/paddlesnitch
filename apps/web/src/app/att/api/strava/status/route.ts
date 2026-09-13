import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getStravaTokens } from '@/lib/strava-storage'

// Cheap read for the UI: are we connected, and (if so) which athlete? No token
// refresh here — we don't need a live access token just to render the badge.
export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ connected: false }, { status: 200 })
  const tokens = await getStravaTokens(user.id)
  if (!tokens) return NextResponse.json({ connected: false })
  return NextResponse.json({
    connected: true,
    athlete: { id: tokens.athleteId, name: tokens.athleteName },
  })
}
