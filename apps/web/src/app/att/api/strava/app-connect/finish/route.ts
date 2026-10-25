import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { hasRecentSignIn } from '@/lib/app-signin'
import { getStravaAutoImport } from '@/lib/strava-storage'
import { finishAppConnect, linkedElsewhere, saveStravaConnection } from '@/lib/strava-app-connect'
import { STRAVA_CONNECT_RESULTS } from '@/lib/strava-connect-results'

// POST /att/api/strava/app-connect/finish { code, verifier } — the app swaps
// the code from com.paddlesnitch.app:/account/strava?code= for the connection.
// Only now is anything saved, and only for the person who started it.
export async function POST(req: NextRequest) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Checked again: the sign-in may have aged past the window on Strava's page.
  if (!(await hasRecentSignIn(req, user.id))) {
    return NextResponse.json({ error: 'For your safety, connecting Strava needs a recent sign-in. Please sign in again.', reauth: true }, { status: 403 })
  }
  const { code, verifier } = await req.json().catch(() => ({}))
  const tokens = typeof code === 'string' && typeof verifier === 'string'
    ? await finishAppConnect(code, verifier, user.id)
    : null
  if (!tokens) return NextResponse.json({ error: STRAVA_CONNECT_RESULTS.state_mismatch.text }, { status: 400 })
  if (await linkedElsewhere(tokens.athleteId, user.id)) {
    return NextResponse.json({ error: STRAVA_CONNECT_RESULTS.linked_elsewhere.text }, { status: 409 })
  }
  await saveStravaConnection(user.id, tokens)
  return NextResponse.json({ connected: true, athlete: { id: tokens.athleteId, name: tokens.athleteName }, autoImport: await getStravaAutoImport(user.id) })
}
