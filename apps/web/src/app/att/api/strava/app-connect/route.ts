import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { authorizeUrl } from '@/lib/strava'
import { canonicalBaseUrl } from '@/lib/url'
import { isChallenge, hasRecentSignIn } from '@/lib/app-signin'
import { startAppConnect } from '@/lib/strava-app-connect'
import { STRAVA_CONNECT_RESULTS } from '@/lib/strava-connect-results'

// POST /att/api/strava/app-connect { challenge } — a signed-in phone app asks
// for Strava's consent page (lib/strava-app-connect.ts). Answers { url } for
// the in-app browser; the callback ends on the app's own address with a code
// for /att/api/strava/app-connect/finish.
export async function POST(req: NextRequest) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Linking a Strava account makes "Sign in with Strava" a way into this
  // account, so it needs a recent real sign-in, as on the website (#694): a
  // stolen app session must not be able to link someone else's Strava.
  if (!(await hasRecentSignIn(req, user.id))) {
    return NextResponse.json({ error: 'For your safety, connecting Strava needs a recent sign-in. Please sign in again.', reauth: true }, { status: 403 })
  }
  const { challenge } = await req.json().catch(() => ({}))
  if (!isChallenge(challenge)) return NextResponse.json({ error: 'Couldn’t start connecting Strava. Please update the app.' }, { status: 400 })
  const state = await startAppConnect(user.id, challenge)
  // Must match the redirect URI registered with Strava: the same callback the website uses.
  // 'force': Strava always shows its consent screen, so a link someone else
  // started can't complete silently for a person who approved paddlesnitch before.
  const url = await authorizeUrl(state, new URL('/att/api/strava/callback', canonicalBaseUrl(req)).toString(), 'force')
  if (!url) return NextResponse.json({ error: STRAVA_CONNECT_RESULTS.not_configured.text }, { status: 503 })
  return NextResponse.json({ url })
}
