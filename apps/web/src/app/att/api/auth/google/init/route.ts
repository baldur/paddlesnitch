import { NextRequest, NextResponse } from 'next/server'
import { randomBytes, timingSafeEqual } from 'crypto'
import { canonicalBaseUrl, safeNext } from '@/lib/url'
import { authorizeUrl, googleConfigured, pkcePair } from '@/lib/google-signin'
import { APP_GOOGLE_URL, isChallenge } from '@/lib/app-signin'

// GET /att/api/auth/google/init?next= — Sign in with Google (#697): to Cognito's
// hosted sign-in with Google, a CSRF state and a PKCE challenge. The state, the
// verifier and `next` wait in httpOnly cookies for the callback (10 minutes).
//
// A phone app sends ?challenge= instead (its own PKCE challenge, as for Strava
// sign-in). Cognito gets the app's challenge, so the code Cognito hands back
// can only be swapped with the verifier the app kept (google/app-token).
//
// But anyone can make a challenge, and a link could start this in a browser
// already signed in to Google, where Google asks nothing: the code would then
// go to whichever app on the phone answers com.paddlesnitch.app (security
// review, 2026-10-26). So an app sign-in first shows /signin/google-app, and
// only a tap there (a same-site POST with the nonce from its cookie) goes on
// to Google. A cross-site page can't send that POST: the Lax cookie stays home.

const NONCE_COOKIE = 'google_signin_app_nonce'
const cookieOpts = () => ({ httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge: 600, secure: process.env.NODE_ENV === 'production' })

function toGoogle(base: string, next: string, appChallenge: string | null): NextResponse {
  const state = randomBytes(24).toString('hex')
  const { verifier, challenge } = appChallenge ? { verifier: '', challenge: appChallenge } : pkcePair()
  const url = authorizeUrl(state, challenge, new URL('/att/api/auth/google/callback', base).toString())
  if (!url) {
    return NextResponse.redirect(appChallenge ? `${APP_GOOGLE_URL}?error=google_not_configured` : new URL('/signin?error=google_not_configured', base))
  }
  const res = NextResponse.redirect(url, 303)
  const opts = cookieOpts()
  res.cookies.set('google_signin_state', state, opts)
  res.cookies.set('google_signin_verifier', verifier, { ...opts, maxAge: appChallenge ? 0 : 600 })
  res.cookies.set('google_signin_next', next, opts)
  // Always set, so a stale app sign-in never turns a website one into an app one.
  res.cookies.set('google_signin_app', appChallenge ? '1' : '', { ...opts, maxAge: appChallenge ? 600 : 0 })
  return res
}

export async function GET(req: NextRequest) {
  const base = canonicalBaseUrl(req)
  const next = safeNext(req.nextUrl.searchParams.get('next'))
  const appChallenge = req.nextUrl.searchParams.get('challenge')
  if (appChallenge === null) return toGoogle(base, next, null)
  if (!isChallenge(appChallenge)) {
    return NextResponse.json({ error: 'Couldn’t start signing in with Google. Please try again.' }, { status: 400 })
  }
  if (!googleConfigured()) return NextResponse.redirect(`${APP_GOOGLE_URL}?error=google_not_configured`)
  const nonce = randomBytes(24).toString('base64url')
  const page = new URL('/signin/google-app', base)
  page.searchParams.set('challenge', appChallenge)
  page.searchParams.set('n', nonce)
  const res = NextResponse.redirect(page)
  res.cookies.set(NONCE_COOKIE, nonce, cookieOpts())
  return res
}

// POST, from the button on /signin/google-app: {challenge, n}.
export async function POST(req: NextRequest) {
  const base = canonicalBaseUrl(req)
  const form = await req.formData().catch(() => null)
  const challenge = form?.get('challenge')
  const n = form?.get('n')
  const cookie = req.cookies.get(NONCE_COOKIE)?.value ?? ''
  const same = typeof n === 'string' && n.length === cookie.length && cookie.length > 0 && timingSafeEqual(Buffer.from(n), Buffer.from(cookie))
  const res = same && typeof challenge === 'string' && isChallenge(challenge)
    ? toGoogle(base, '/', challenge)
    : NextResponse.redirect(`${APP_GOOGLE_URL}?error=google_failed`, 303)
  res.cookies.set(NONCE_COOKIE, '', { path: '/', maxAge: 0 })
  return res
}
