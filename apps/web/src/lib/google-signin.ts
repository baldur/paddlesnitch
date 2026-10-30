import { createHash, randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { APP_GOOGLE_URL } from '@/lib/app-signin'

// Sign in with Google (#697), through Cognito's hosted sign-in: we send the
// browser to Cognito's authorize page with identity_provider=Google, Cognito
// talks to Google, and comes back to our callback with a one-time code that we
// swap (with the PKCE verifier) for the pool's own ID and refresh tokens. Our
// server never talks to Google and never holds Google's client secret.
//
// COGNITO_DOMAIN is set on the server by the CDK. cognito-local has no hosted
// sign-in, so locally it's unset and Google sign-in is "not available": the
// routes are tested with Cognito's token endpoint mocked (google-signin.test.ts).

const domain = () => process.env.COGNITO_DOMAIN?.replace(/\/$/, '') || null
const clientId = () => process.env.COGNITO_CLIENT_ID ?? ''

export const googleConfigured = () => !!domain()

/** A PKCE pair: the verifier stays in an httpOnly cookie, the challenge goes to Cognito. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

export function authorizeUrl(state: string, challenge: string, redirectUri: string): string | null {
  const d = domain()
  if (!d) return null
  const q = new URLSearchParams({
    identity_provider: 'Google',
    response_type: 'code',
    client_id: clientId(),
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  return `${d}/oauth2/authorize?${q}`
}

export type GoogleTokens = { idToken: string; refreshToken: string }

/** Swaps the code for the pool's tokens; null when Cognito refuses (spent, expired, wrong verifier). */
export async function exchangeCode(code: string, verifier: string, redirectUri: string): Promise<GoogleTokens | null> {
  const d = domain()
  if (!d) return null
  const res = await fetch(`${d}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId(), code, redirect_uri: redirectUri, code_verifier: verifier }),
  })
  if (!res.ok) return null
  const body = await res.json().catch(() => null) as { id_token?: unknown; refresh_token?: unknown } | null
  if (typeof body?.id_token !== 'string' || typeof body.refresh_token !== 'string') return null
  return { idToken: body.id_token, refreshToken: body.refresh_token }
}

/**
 * What a Cognito error on the way back means. PreSignUp refuses a Google
 * sign-up whose email already has an account with "ACCOUNT_EXISTS"
 * (infra/lambdas/cognito-auth/pre-sign-up.mjs); Cognito puts it in
 * error_description.
 */
export function errorKey(error: string, description: string | null): string {
  // Connect Google: the trigger linked the Google login to the account (lib/google-link.ts).
  if (/LINKED/.test(description ?? '')) return 'google_linked'
  if (/ACCOUNT_EXISTS/.test(description ?? '')) return 'google_account_exists'
  if (/NO_EMAIL|EMAIL_UNVERIFIED/.test(description ?? '')) return 'google_no_email'
  if (error === 'access_denied') return 'google_denied'
  return 'google_failed'
}

/** Whether an ID token we have already verified says its email is verified. */
export function emailVerified(idToken: string): boolean {
  try {
    const v = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString()).email_verified
    return v === true || v === 'true'
  } catch {
    return false
  }
}

export const googleCookieOpts = () => ({ httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge: 600, secure: process.env.NODE_ENV === 'production' })

/**
 * Off to Cognito's hosted sign-in with Google, with the state, verifier,
 * `next` and the kind of trip in cookies for the callback (10 minutes):
 * the website's own sign-in, an app's (`appChallenge`, the app's PKCE
 * challenge) or connecting Google to the signed-in account (`link`).
 */
export function toGoogle(base: string, next: string, opts: { appChallenge?: string; link?: boolean } = {}): NextResponse {
  const { appChallenge, link = false } = opts
  const state = randomBytes(24).toString('hex')
  const { verifier, challenge } = appChallenge ? { verifier: '', challenge: appChallenge } : pkcePair()
  const url = authorizeUrl(state, challenge, new URL('/att/api/auth/google/callback', base).toString())
  if (!url) {
    if (appChallenge) return NextResponse.redirect(`${APP_GOOGLE_URL}?error=google_not_configured`)
    return NextResponse.redirect(new URL(link ? '/account?google=google_not_configured#google' : '/signin?error=google_not_configured', base), 303)
  }
  const res = NextResponse.redirect(url, 303)
  const c = googleCookieOpts()
  res.cookies.set('google_signin_state', state, c)
  res.cookies.set('google_signin_verifier', verifier, { ...c, maxAge: appChallenge ? 0 : 600 })
  res.cookies.set('google_signin_next', next, c)
  // Always set, so a stale app or connect trip never changes what this one is.
  res.cookies.set('google_signin_app', appChallenge ? '1' : '', { ...c, maxAge: appChallenge ? 600 : 0 })
  res.cookies.set('google_signin_link', link ? '1' : '', { ...c, maxAge: link ? 600 : 0 })
  return res
}
