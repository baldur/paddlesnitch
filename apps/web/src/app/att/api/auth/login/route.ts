import { NextRequest, NextResponse } from 'next/server'
import { signIn, verifyIdToken } from '@/lib/cognito'
import { setAuthCookies } from '@/lib/auth'
import { emitMetric } from '@/lib/metrics'

export async function POST(req: NextRequest) {
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
  const res = NextResponse.json({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
  })
  setAuthCookies(res.cookies, tokens.idToken, tokens.refreshToken)
  return res
}
