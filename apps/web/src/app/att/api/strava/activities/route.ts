import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { listActivities } from '@/lib/strava'
import { getValidStravaTokens } from '@/lib/strava-storage'

// Returns the user's recent water-sport activities for the picker. Filtering
// happens inside listActivities — see strava.ts.
export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tokens = await getValidStravaTokens(user.id)
  if (!tokens) return NextResponse.json({ error: 'not_connected' }, { status: 409 })

  try {
    const { activities } = await listActivities(tokens.accessToken)
    return NextResponse.json({ activities })
  } catch (err) {
    console.error('[strava activities] failed', err)
    return NextResponse.json({ error: 'fetch_failed' }, { status: 502 })
  }
}
