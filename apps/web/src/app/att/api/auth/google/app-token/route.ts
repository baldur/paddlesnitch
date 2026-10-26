import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken } from '@/lib/cognito'
import { signedInResponse } from '@/lib/auth'
import { hasAcceptedCurrent } from '@/lib/tos'
import { emitMetric } from '@/lib/metrics'
import { canonicalBaseUrl } from '@/lib/url'
import { emailVerified, exchangeCode } from '@/lib/google-signin'
import { clientOf, logAction } from '@paddlesnitch/core/observe'

// POST /att/api/auth/google/app-token {code, verifier} — a phone app finishes
// Sign in with Google. The code is Cognito's own, handed to the app by
// google/callback; Cognito made it against the app's PKCE challenge, so only
// the app's verifier swaps it. The swap is ours (the redirect address must
// match the one the code was made for), then the same steps as the website:
// pending invitations for a Google-verified email, and the Terms check.
export async function POST(req: NextRequest) {
  const client = clientOf(req.headers)
  const { code, verifier } = await req.json().catch(() => ({}))
  if (typeof code !== 'string' || typeof verifier !== 'string' || !code || !verifier) {
    return NextResponse.json({ error: 'Couldn’t finish signing in. Please try again.' }, { status: 400 })
  }
  const tokens = await exchangeCode(code, verifier, new URL('/att/api/auth/google/callback', canonicalBaseUrl(req)).toString())
  const user = tokens ? await verifyIdToken(tokens.idToken) : null
  if (!tokens || !user) {
    logAction('sign_in', 'rejected', { client, reason: 'google_app_code' })
    return NextResponse.json({ error: 'Couldn’t finish signing in. Please try again.' }, { status: 401 })
  }

  if (emailVerified(tokens.idToken)) try {
    const { applyPendingInvitations } = await import('@/lib/pending-invitations')
    await applyPendingInvitations(user.email, user.id)
  } catch (err) {
    console.warn('[google app-token] applyPendingInvitations failed', err)
  }

  emitMetric('login')
  logAction('sign_in', 'ok', { client, reason: 'google-app' })
  return signedInResponse(req, {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    needsTerms: !(await hasAcceptedCurrent(user.id)),
  }, tokens.idToken, tokens.refreshToken)
}
