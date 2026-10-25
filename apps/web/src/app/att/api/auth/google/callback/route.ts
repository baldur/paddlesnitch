import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { setAuthCookies } from '@/lib/auth'
import { verifyIdToken } from '@/lib/cognito'
import { hasAcceptedCurrent, termsAcceptPath } from '@/lib/tos'
import { canonicalBaseUrl, safeNext } from '@/lib/url'
import { exchangeCode, errorKey, emailVerified } from '@/lib/google-signin'
import { clientOf, logAction } from '@paddlesnitch/core/observe'

// GET /att/api/auth/google/callback?code=&state= — back from Cognito's hosted
// sign-in with Google (#697). Checks the state, swaps the code with the PKCE
// verifier for the pool's tokens, and signs the website in like every other
// way in: the Terms check, pending group invitations, cookies.
export async function GET(req: NextRequest) {
  const base = canonicalBaseUrl(req)
  const client = clientOf(req.headers)
  const jar = await cookies()
  const next = safeNext(jar.get('google_signin_next')?.value)
  const clear = (res: NextResponse) => {
    for (const name of ['google_signin_state', 'google_signin_verifier', 'google_signin_next']) res.cookies.set(name, '', { path: '/', maxAge: 0 })
    return res
  }
  const fail = (key: string) => {
    logAction('sign_in', key === 'google_failed' ? 'fail' : 'rejected', { client, reason: key })
    return clear(NextResponse.redirect(new URL(`/signin?error=${key}&next=${encodeURIComponent(next)}`, base)))
  }

  const params = req.nextUrl.searchParams
  const error = params.get('error')
  if (error) return fail(errorKey(error, params.get('error_description')))
  const code = params.get('code')
  const state = params.get('state')
  const verifier = jar.get('google_signin_verifier')?.value
  if (!code || !state || !verifier || state !== jar.get('google_signin_state')?.value) return fail('google_failed')

  const tokens = await exchangeCode(code, verifier, new URL('/att/api/auth/google/callback', base).toString())
  const user = tokens ? await verifyIdToken(tokens.idToken) : null
  if (!tokens || !user) return fail('google_failed')

  // A first sign-in may be the account an invitation was waiting for, but
  // only an address Google has verified collects one.
  if (emailVerified(tokens.idToken)) try {
    const { applyPendingInvitations } = await import('@/lib/pending-invitations')
    await applyPendingInvitations(user.email, user.id)
  } catch (err) {
    console.warn('[google signin] applyPendingInvitations failed', err)
  }

  const accepted = await hasAcceptedCurrent(user.id)
  const res = NextResponse.redirect(new URL(accepted ? next : termsAcceptPath(next), base))
  setAuthCookies(res.cookies, tokens.idToken, tokens.refreshToken)
  logAction('sign_in', 'ok', { client, reason: 'google' })
  return clear(res)
}
