import { NextResponse } from 'next/server'
import { getAuthUser } from '@paddlesnitch/core/auth'
import { listActivities } from '@paddlesnitch/core/strava'
import { getValidStravaTokens } from '@paddlesnitch/core/strava-storage'

// Returns the user's recent water-sport activities for the picker. Filtering
// happens inside listActivities — see strava.ts.
export async function GET(req: Request) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tokens = await getValidStravaTokens(user.id)
  if (!tokens) return NextResponse.json({ error: 'not_connected' }, { status: 409 })

  const page = Math.max(1, Math.floor(Number(new URL(req.url).searchParams.get('page')) || 1))
  try {
    const { activities, hasMore } = await listActivities(tokens.accessToken, page)
    return NextResponse.json({ activities, page, hasMore })
  } catch (err) {
    console.error('[strava activities] failed', err)
    return NextResponse.json({ error: 'fetch_failed' }, { status: 502 })
  }
}
