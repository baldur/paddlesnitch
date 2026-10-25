import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { customAuthSignIn, verifyIdToken } from '@/lib/cognito'
import { signedInResponse } from '@/lib/auth'
import { hasAcceptedCurrent } from '@/lib/tos'
import { emitMetric } from '@/lib/metrics'
import { redeemAppCode } from '@/lib/app-signin'

// A phone app swaps the one-time code from its Strava sign-in (see
// strava/callback and lib/app-signin.ts), with its PKCE verifier, for tokens.
export async function POST(req: NextRequest) {
  const { code, verifier } = await req.json().catch(() => ({}))
  if (typeof code !== 'string' || typeof verifier !== 'string') {
    return NextResponse.json({ error: 'Sign-in didn’t finish. Please try again.' }, { status: 400 })
  }
  const account = await redeemAppCode(code, verifier)
  if (!account) {
    return NextResponse.json({ error: 'That sign-in has expired. Please try again.' }, { status: 401 })
  }

  const tokens = await customAuthSignIn(account.email, randomBytes(32).toString('hex'))
  const user = 'error' in tokens ? null : await verifyIdToken(tokens.idToken)
  if ('error' in tokens || !user) {
    console.error('[strava app-token] sign-in failed', 'error' in tokens ? tokens.error : 'bad token')
    return NextResponse.json({ error: 'Sign-in didn’t finish. Please try again.' }, { status: 500 })
  }

  emitMetric('login')
  return signedInResponse(req, {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    needsTerms: !(await hasAcceptedCurrent(user.id)),
  }, tokens.idToken, tokens.refreshToken)
}
