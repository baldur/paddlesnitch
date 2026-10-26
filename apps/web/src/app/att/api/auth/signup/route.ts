import { NextRequest, NextResponse } from 'next/server'
import { startSignUp } from '@/lib/cognito'
import { CURRENT_TOS_VERSION } from '@/lib/types'
import { mayEmailCode, TOO_MANY_CODES } from '@/lib/code-email-limit'

const WEAK_PASSWORD = 'Use at least 8 characters, with an uppercase letter, a lowercase letter and a number.'

// Starts an email + password account (#702): Cognito emails a 6-digit code and
// nothing is signed in until POST signup/confirm proves the address.
export async function POST(req: NextRequest) {
  const { email, displayName, password, acceptedTosVersion } = await req.json()

  if (!email || !displayName || !password) {
    return NextResponse.json({ error: 'Enter your email, name and password.' }, { status: 400 })
  }
  if (password.length < 8) return NextResponse.json({ error: WEAK_PASSWORD }, { status: 400 })
  // ToS acceptance is mandatory on signup. The client must echo the
  // current version it rendered so we don't accidentally accept a stale
  // version the user never saw.
  if (acceptedTosVersion !== CURRENT_TOS_VERSION) {
    return NextResponse.json(
      { error: 'Please accept the Terms of Service to create an account.' },
      { status: 422 }
    )
  }

  const normalised = String(email).toLowerCase().trim()
  if (!(await mayEmailCode(req, normalised))) return NextResponse.json({ error: TOO_MANY_CODES }, { status: 429 })
  const created = await startSignUp(normalised, String(displayName).trim(), password)
  if ('error' in created) {
    if (created.error === 'email_exists') {
      return NextResponse.json({ error: 'There’s already an account with that email. Sign in instead.' }, { status: 409 })
    }
    if (created.error === 'invalid_password') return NextResponse.json({ error: WEAK_PASSWORD }, { status: 400 })
    return NextResponse.json({ error: 'Couldn’t sign you up. Please try again.' }, { status: 500 })
  }
  return NextResponse.json({ needsCode: true, email: normalised }, { status: 202 })
}
