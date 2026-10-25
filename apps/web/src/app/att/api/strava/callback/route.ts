import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getAuthUser } from '@/lib/auth'
import { hasRecentSignIn } from '@/lib/app-signin'
import { exchangeCode } from '@/lib/strava'
import { canonicalBaseUrl } from '@/lib/url'
import { APP_STRAVA_URL } from '@/lib/app-signin'
import { takeAppConnectState, parkAppConnect, linkedElsewhere, looksLikeAppState, saveStravaConnection } from '@/lib/strava-app-connect'
import type { StravaConnectResult } from '@/lib/strava-connect-results'

// Strava redirects here after the user approves (or denies). Verify the state
// cookie, exchange the code, persist the tokens, redirect back to the account
// page with a status flag the UI can render.
export async function GET(req: NextRequest) {
  // Always redirect to the canonical base so the user lands on
  // paddlesnitch.com, not the raw Lambda function URL.
  const base = canonicalBaseUrl(req)
  const params = req.nextUrl.searchParams
  const code = params.get('code')
  const stateFromStrava = params.get('state')
  const error = params.get('error')

  // A phone app's connect (lib/strava-app-connect.ts): its state names a
  // server-side record, not a cookie. Nothing is saved here; the app collects.
  const appConnect = await takeAppConnectState(stateFromStrava)
  const toApp = (query: string) => NextResponse.redirect(`${APP_STRAVA_URL}?${query}`)
  // An app's state that has expired (10 minutes) or was already used: back to
  // the app, not the website's sign-in page (the in-app browser has no cookies).
  if (!appConnect && looksLikeAppState(stateFromStrava)) return toApp('strava=state_mismatch')
  if (appConnect) {
    if (error || !code) return toApp('strava=denied')
    try {
      const tokens = await exchangeCode(code)
      if (await linkedElsewhere(tokens.athleteId, appConnect.userId)) return toApp('strava=linked_elsewhere')
      return toApp(`code=${await parkAppConnect(appConnect, tokens)}`)
    } catch (err) {
      console.error('[strava callback] app exchange failed', err)
      return toApp('strava=exchange_failed')
    }
  }

  const cookieStore = await cookies()
  const done = (result: StravaConnectResult) => {
    const res = NextResponse.redirect(new URL(`/account?strava=${result}`, base))
    res.cookies.set('strava_state', '', { path: '/', maxAge: 0 })
    return res
  }
  const user = await getAuthUser()
  // No session = we've lost context. Send them back to sign in; once they
  // re-auth they can hit Connect again.
  if (!user) return NextResponse.redirect(new URL('/signin?next=/account', base))

  const stateCookie = cookieStore.get('strava_state')?.value

  // User clicked deny, or Strava reported an error.
  if (error) return done('denied')

  // State must match what we set on /connect, else this is CSRF.
  if (!code || !stateFromStrava || !stateCookie || stateFromStrava !== stateCookie) return done('state_mismatch')

  // Checked again here: the sign-in may have aged past the window on Strava's page.
  if (!(await hasRecentSignIn(req, user.id))) {
    const res = NextResponse.redirect(new URL('/account?strava=reauth#strava', base))
    res.cookies.set('strava_state', '', { path: '/', maxAge: 0 })
    return res
  }

  try {
    const tokens = await exchangeCode(code)
    // Never move a Strava account that is connected to someone else (a link
    // someone else made could otherwise attach a stranger's Strava here).
    if (await linkedElsewhere(tokens.athleteId, user.id)) return done('linked_elsewhere')
    // Tokens, plus the athlete id -> user index so future "Sign in with
    // Strava" round-trips land on this account instead of creating a duplicate.
    await saveStravaConnection(user.id, tokens)
  } catch (err) {
    console.error('[strava callback] exchange failed', err)
    return done('exchange_failed')
  }

  return done('connected')
}
