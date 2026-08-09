import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getAuthUser } from '@/lib/auth'
import { exchangeCode } from '@/lib/strava'
import { putStravaTokens, putAthleteIndex } from '@/lib/strava-storage'
import { canonicalBaseUrl } from '@/lib/url'

// Strava redirects here after the user approves (or denies). Verify the state
// cookie, exchange the code, persist the tokens, redirect back to the account
// page with a status flag the UI can render.
export async function GET(req: NextRequest) {
  // Always redirect to the canonical base so the user lands on
  // paddlesnitch.com, not the raw Lambda function URL.
  const base = canonicalBaseUrl(req)
  const user = await getAuthUser()
  // No session = we've lost context. Send them back to sign in; once they
  // re-auth they can hit Connect again.
  if (!user) return NextResponse.redirect(new URL('/att/auth?next=/profile/me/settings', base))

  const params = req.nextUrl.searchParams
  const code = params.get('code')
  const stateFromStrava = params.get('state')
  const error = params.get('error')

  const cookieStore = await cookies()
  const stateCookie = cookieStore.get('strava_state')?.value
  const clearStateCookie = (res: NextResponse) => {
    res.cookies.set('strava_state', '', { path: '/', maxAge: 0 })
    return res
  }

  // User clicked deny, or Strava reported an error.
  if (error) return clearStateCookie(NextResponse.redirect(new URL(`/profile/me/settings?strava=denied`, base)))

  // State must match what we set on /connect, else this is CSRF.
  if (!code || !stateFromStrava || !stateCookie || stateFromStrava !== stateCookie) {
    return clearStateCookie(NextResponse.redirect(new URL('/profile/me/settings?strava=state_mismatch', base)))
  }

  try {
    const tokens = await exchangeCode(code)
    await putStravaTokens(user.id, tokens)
    // Index the athlete id -> user mapping so future "Sign in with Strava"
    // round-trips for this user land on this account instead of creating
    // a duplicate.
    if (tokens.athleteId) await putAthleteIndex(tokens.athleteId, user.id)
  } catch (err) {
    console.error('[strava callback] exchange failed', err)
    return clearStateCookie(NextResponse.redirect(new URL('/profile/me/settings?strava=exchange_failed', base)))
  }

  return clearStateCookie(NextResponse.redirect(new URL('/profile/me/settings?strava=connected', base)))
}
