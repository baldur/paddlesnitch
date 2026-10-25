import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getAuthUser } from '@/lib/auth'
import { hasRecentSignIn } from '@/lib/app-signin'
import { authorizeUrl } from '@/lib/strava'
import { canonicalBaseUrl } from '@/lib/url'

// Kick off the OAuth dance: mint a CSRF state, set it as an httpOnly cookie,
// redirect to Strava's authorize page. The callback verifies the cookie matches
// the `state` Strava echoes back.
export async function GET(req: NextRequest) {
  const base = canonicalBaseUrl(req)
  const user = await getAuthUser()
  if (!user) return NextResponse.redirect(new URL('/signin?next=/account', base))
  // Linking a Strava account makes "Sign in with Strava" a way into this
  // account, so it needs a recent real sign-in, like deleting: a left-open
  // browser must not be able to link someone else's Strava (security review).
  if (!(await hasRecentSignIn(req, user.id))) return NextResponse.redirect(new URL('/account?strava=reauth#strava', base))

  const state = randomBytes(24).toString('hex')
  // redirect_uri MUST match what's registered in the Strava API app exactly,
  // so we always build it off the canonical base URL — never req.url, which
  // resolves to the Lambda function URL behind CloudFront.
  const redirectUri = new URL('/att/api/strava/callback', base).toString()
  const url = await authorizeUrl(state, redirectUri)
  if (!url) {
    return NextResponse.redirect(new URL('/account?strava=not_configured', base))
  }

  const res = NextResponse.redirect(url)
  res.cookies.set('strava_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
    secure: process.env.NODE_ENV === 'production',
  })
  return res
}
