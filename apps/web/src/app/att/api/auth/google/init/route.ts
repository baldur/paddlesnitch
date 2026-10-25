import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { canonicalBaseUrl, safeNext } from '@/lib/url'
import { authorizeUrl, pkcePair } from '@/lib/google-signin'

// GET /att/api/auth/google/init?next= — Sign in with Google (#697): to Cognito's
// hosted sign-in with Google, a CSRF state and a PKCE challenge. The state, the
// verifier and `next` wait in httpOnly cookies for the callback (10 minutes).
export async function GET(req: NextRequest) {
  const base = canonicalBaseUrl(req)
  const next = safeNext(req.nextUrl.searchParams.get('next'))
  const state = randomBytes(24).toString('hex')
  const { verifier, challenge } = pkcePair()
  const url = authorizeUrl(state, challenge, new URL('/att/api/auth/google/callback', base).toString())
  if (!url) return NextResponse.redirect(new URL('/signin?error=google_not_configured', base))
  const res = NextResponse.redirect(url)
  const opts = { httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge: 600, secure: process.env.NODE_ENV === 'production' }
  res.cookies.set('google_signin_state', state, opts)
  res.cookies.set('google_signin_verifier', verifier, opts)
  res.cookies.set('google_signin_next', next, opts)
  return res
}
