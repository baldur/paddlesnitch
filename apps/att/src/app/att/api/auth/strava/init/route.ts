import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { authorizeUrl } from '@/lib/strava'
import { canonicalBaseUrl } from '@/lib/url'
import { getAuthUser } from '@/lib/auth'

// Sign in with Strava. Differs from /att/api/strava/connect (which requires
// an existing session) in two ways: this route is callable without auth, and
// the callback path is /att/api/auth/strava/callback so it can find-or-create
// a Cognito account and set auth cookies, rather than just persisting tokens.
export async function GET(req: NextRequest) {
  const base = canonicalBaseUrl(req)
  // Preserve the `next` query param so we can bounce the user back to where
  // they were trying to go after sign-in.
  const next = req.nextUrl.searchParams.get('next') ?? '/att'

  // If the visitor is already signed in, the Strava OAuth round-trip is
  // useless and prone to failure (an expired or single-use authorization
  // code at this point would surface as a token-exchange error even though
  // they're already authenticated — reported in #55). Just bounce them to
  // `next`. Users who want to LINK Strava to their account should use the
  // connect button on /profile/me/settings, which has its own flow.
  const existingUser = await getAuthUser()
  if (existingUser) {
    return NextResponse.redirect(new URL(next.startsWith('/') ? next : '/att', base))
  }

  const state = randomBytes(24).toString('hex')
  const redirectUri = new URL('/att/api/auth/strava/callback', base).toString()
  // `force` makes Strava show the consent screen even if the user has
  // previously authorized us. Without this, users who first authorized
  // before the profile:read_all scope was added get a new token issued
  // silently with their OLD scopes — and /api/v3/athlete returns no email.
  // The sign-in flow can't recover from that without re-consent.
  const url = await authorizeUrl(state, redirectUri, 'force')
  if (!url) {
    return NextResponse.redirect(new URL(`/att/auth?error=strava_not_configured`, base))
  }

  const res = NextResponse.redirect(url)
  // Two cookies: the CSRF state, and where to send the user after sign-in.
  // 10-min lifespan covers the OAuth round-trip with margin to spare.
  const cookieOpts = {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 600,
    secure: process.env.NODE_ENV === 'production',
  }
  res.cookies.set('strava_signin_state', state, cookieOpts)
  res.cookies.set('strava_signin_next', next, cookieOpts)
  return res
}
