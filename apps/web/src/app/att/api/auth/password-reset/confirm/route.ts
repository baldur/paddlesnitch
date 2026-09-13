import { NextRequest, NextResponse } from 'next/server'
import { confirmForgotPassword, signIn } from '@/lib/cognito'
import { setAuthCookies } from '@/lib/auth'

// Confirms the reset using the emailed code + new password, then signs the
// user in straight away so they don't have to re-enter credentials.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const email = typeof body?.email === 'string' ? body.email.toLowerCase().trim() : ''
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!email || !code || !password) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  const result = await confirmForgotPassword(email, code, password)
  if ('error' in result) {
    if (result.error === 'invalid_code') {
      return NextResponse.json({ error: 'That code is not valid. Check your email and try again.' }, { status: 400 })
    }
    if (result.error === 'expired_code') {
      return NextResponse.json({ error: 'That code has expired. Request a new one.' }, { status: 400 })
    }
    if (result.error === 'invalid_password') {
      return NextResponse.json({
        error: 'Password must contain an uppercase letter, a lowercase letter, and a number.',
      }, { status: 400 })
    }
    return NextResponse.json({ error: 'Could not reset password' }, { status: 400 })
  }

  // Auto-sign-in so the user lands on /att without an extra step.
  const tokens = await signIn(email, password)
  if ('error' in tokens) {
    return NextResponse.json({ ok: true, signedIn: false })
  }
  const res = NextResponse.json({ ok: true, signedIn: true })
  setAuthCookies(res.cookies, tokens.idToken, tokens.refreshToken)
  return res
}
