import { NextRequest, NextResponse } from 'next/server'
import { signIn, verifyIdToken } from '@/lib/cognito'
import { signedInResponse } from '@/lib/auth'
import { hasAcceptedCurrent } from '@/lib/tos'
import { emitMetric } from '@/lib/metrics'
import { withAction } from '@/lib/action'

async function post(req: NextRequest) {
  const { email, password } = await req.json()

  if (!email || !password) {
    return NextResponse.json({ error: 'Enter your email and password.' }, { status: 400 })
  }

  const tokens = await signIn(String(email).toLowerCase().trim(), password)
  if ('error' in tokens) {
    return NextResponse.json({ error: 'That email and password don’t match.' }, { status: 401 })
  }

  const user = await verifyIdToken(tokens.idToken)
  if (!user) {
    return NextResponse.json({ error: 'Sign-in didn’t finish. Please try again.' }, { status: 500 })
  }

  emitMetric('login')
  return signedInResponse(req, {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    // Accounts from before the current Terms version accept them once.
    needsTerms: !(await hasAcceptedCurrent(user.id)),
  }, tokens.idToken, tokens.refreshToken)
}

export const POST = withAction('sign_in', post)
