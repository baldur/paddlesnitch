import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomBytes } from 'crypto'
import { getAuthUser } from '@/lib/auth'
import { authorizeUrl } from '@/lib/strava'
import { canonicalBaseUrl } from '@/lib/url'
import { FROM_LINK_COOKIE, hasRecentSignIn } from '@/lib/app-signin'

// Kick off the OAuth dance: mint a CSRF state, set it as an httpOnly cookie,
// redirect to Strava's authorize page. The callback verifies the cookie matches
// the `state` Strava echoes back.
//
// POST only, from the Connect button's form on our own pages (security review,
// C5). A link, a redirect chain or a page that forwards `next` can only make a
// GET, so none of them can start a connect in a browser signed in as someone
// else (a web-code link signs the opener in as the link's maker). A cross-site
// form POST carries no session (the cookie is sameSite=lax) and its Origin is
// refused. Answers are 303, so the browser follows with a GET.
export async function POST(req: NextRequest) {
  const base = canonicalBaseUrl(req)
  const go = (to: string | URL) => NextResponse.redirect(to, 303)
  const origin = req.headers.get('origin')
  if (origin && origin !== new URL(base).origin && origin !== req.nextUrl.origin) {
    return go(new URL('/account?strava=state_mismatch', base))
  }
  const user = await getAuthUser()
  if (!user) return go(new URL('/signin?next=/account', base))
  // Signed in by a web-code link (lib/app-signin.ts): the person at this
  // browser may not own the account, so Strava is connected in the app instead.
  if ((await cookies()).get(FROM_LINK_COOKIE)?.value === user.id) return go(new URL('/account?strava=use_app', base))
  // Linking a Strava account makes "Sign in with Strava" a way into this
  // account, so it needs a recent real sign-in, like deleting: a left-open
  // browser must not be able to link someone else's Strava (security review).
  if (!(await hasRecentSignIn(req, user.id))) return go(new URL('/account?strava=reauth#strava', base))

  const state = randomBytes(24).toString('hex')
  // redirect_uri MUST match what's registered in the Strava API app exactly,
  // so we always build it off the canonical base URL — never req.url, which
  // resolves to the Lambda function URL behind CloudFront.
  const redirectUri = new URL('/att/api/strava/callback', base).toString()
  const url = await authorizeUrl(state, redirectUri)
  if (!url) return go(new URL('/account?strava=not_configured', base))

  const res = go(url)
  res.cookies.set('strava_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
    secure: process.env.NODE_ENV === 'production',
  })
  return res
}

/** An old link or bookmark: starts nothing, shows the account page with its Connect button. */
export async function GET(req: NextRequest) {
  return NextResponse.redirect(new URL('/account#strava', canonicalBaseUrl(req)))
}
