import { NextRequest, NextResponse } from 'next/server'
import { otpVerify, verifyIdToken } from '@/lib/cognito'
import { setAuthCookies } from '@/lib/auth'

// Step 2 of passwordless sign-in. Submit the 6-digit code from the user's
// email. On success, set tt_id + tt_refresh cookies and return the user.
// If the code was wrong but retries remain, return the new session so the
// client can resubmit.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const email = typeof body?.email === 'string' ? body.email.toLowerCase().trim() : ''
  const session = typeof body?.session === 'string' ? body.session : ''
  const code = typeof body?.code === 'string' ? body.code.trim() : ''

  if (!email || !session || !code) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const result = await otpVerify(email, session, code)
  if ('error' in result) {
    return NextResponse.json({ error: 'Could not verify code' }, { status: 400 })
  }
  if ('needsAnotherTry' in result) {
    return NextResponse.json(
      { error: 'That code is not valid. Check your email and try again.', session: result.session },
      { status: 400 },
    )
  }

  const user = await verifyIdToken(result.idToken)
  if (!user) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 500 })
  }
  const res = NextResponse.json({ id: user.id, email: user.email, displayName: user.displayName })
  setAuthCookies(res.cookies, result.idToken, result.refreshToken)
  return res
}
