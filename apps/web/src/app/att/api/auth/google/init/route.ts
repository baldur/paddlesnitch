import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { canonicalBaseUrl, safeNext } from '@/lib/url'
import { authorizeUrl, pkcePair } from '@/lib/google-signin'
import { APP_GOOGLE_URL, isChallenge } from '@/lib/app-signin'

// GET /att/api/auth/google/init?next= — Sign in with Google (#697): to Cognito's
// hosted sign-in with Google, a CSRF state and a PKCE challenge. The state, the
// verifier and `next` wait in httpOnly cookies for the callback (10 minutes).
//
// A phone app sends ?challenge= instead (its own PKCE challenge, as for Strava
// sign-in). Cognito gets the app's challenge, so the code Cognito hands back
// can only be swapped with the verifier the app kept (google/app-token): no
// verifier cookie, and nothing about the sign-in is stored on our side.
export async function GET(req: NextRequest) {
  const base = canonicalBaseUrl(req)
  const next = safeNext(req.nextUrl.searchParams.get('next'))
  const appChallenge = req.nextUrl.searchParams.get('challenge')
  if (appChallenge !== null && !isChallenge(appChallenge)) {
    return NextResponse.json({ error: 'Bad challenge.' }, { status: 400 })
  }
  const state = randomBytes(24).toString('hex')
  const { verifier, challenge } = appChallenge ? { verifier: '', challenge: appChallenge } : pkcePair()
  const url = authorizeUrl(state, challenge, new URL('/att/api/auth/google/callback', base).toString())
  if (!url) {
    return NextResponse.redirect(appChallenge ? `${APP_GOOGLE_URL}?error=google_not_configured` : new URL('/signin?error=google_not_configured', base))
  }
  const res = NextResponse.redirect(url)
  const opts = { httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge: 600, secure: process.env.NODE_ENV === 'production' }
  res.cookies.set('google_signin_state', state, opts)
  res.cookies.set('google_signin_verifier', verifier, { ...opts, maxAge: appChallenge ? 0 : 600 })
  res.cookies.set('google_signin_next', next, opts)
  // Always set, so a stale app sign-in never turns a website one into an app one.
  res.cookies.set('google_signin_app', appChallenge ? '1' : '', { ...opts, maxAge: appChallenge ? 600 : 0 })
  return res
}
