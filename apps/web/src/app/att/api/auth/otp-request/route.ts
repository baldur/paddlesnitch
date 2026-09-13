import { NextRequest, NextResponse } from 'next/server'
import { otpRequest, signUp } from '@/lib/cognito'
import { looksLikeBot } from '@/lib/anti-bot'

// Step 1 of passwordless sign-in. We ALWAYS return the same shape regardless
// of whether the email exists in the pool, to avoid leaking account existence
// to unauthenticated callers. If the user doesn't exist, we silently create
// them with a random unguessable password — they'll then proceed through OTP
// just like any returning user.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const email = typeof body?.email === 'string' ? body.email.toLowerCase().trim() : ''
  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }

  // Anti-bot gate runs BEFORE any Cognito work. This endpoint both sends an SES
  // email and, for unknown addresses, creates a Cognito user — so an unguarded
  // bot could email-bomb arbitrary inboxes and churn junk accounts. On a bot
  // signal we send nothing and create nothing, but hand back a normal-looking
  // session so the caller advances to the code step and gets no signal to adapt.
  // A rare false-positive human can hit "use a different email" to reset and
  // retry; by then the form's been on screen well past the time threshold.
  if (looksLikeBot(body)) {
    return NextResponse.json({ session: crypto.randomUUID() })
  }

  const result = await otpRequest(email)
  if ('error' in result) {
    if (result.error === 'invalid_credentials' || result.error === 'user_not_found') {
      // User doesn't exist — sign them up first, then retry OTP. The password
      // is throwaway: passwordless users never need to use it. 32-byte random
      // is plenty of entropy.
      const random = crypto.randomUUID().replace(/-/g, '') + 'A1'  // satisfy password policy
      const displayName = email.split('@')[0]
      const created = await signUp(email, displayName, random)
      if ('error' in created) {
        return NextResponse.json({ error: 'Could not start sign-in' }, { status: 500 })
      }
      const retry = await otpRequest(email)
      if ('error' in retry) {
        return NextResponse.json({ error: 'Could not start sign-in' }, { status: 500 })
      }
      return NextResponse.json({ session: retry.session })
    }
    return NextResponse.json({ error: 'Could not start sign-in' }, { status: 500 })
  }
  return NextResponse.json({ session: result.session })
}
