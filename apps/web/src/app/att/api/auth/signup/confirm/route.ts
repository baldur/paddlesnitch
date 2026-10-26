import { NextRequest, NextResponse } from 'next/server'
import { confirmSignUp, signIn, verifyIdToken } from '@/lib/cognito'
import { signedInResponse } from '@/lib/auth'
import { recordAcceptance, hasAcceptedCurrent } from '@/lib/tos'
import { CURRENT_TOS_VERSION } from '@/lib/types'
import { applyPendingInvitations } from '@/lib/pending-invitations'
import { markEmailProven } from '@/lib/email-proven'
import { emitMetric } from '@/lib/metrics'

// The second half of sign-up (#702): the code from the email proves the
// address, then the account signs in with the password typed a moment ago.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const email = typeof body?.email === 'string' ? body.email.toLowerCase().trim() : ''
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!email || !code || !password) {
    return NextResponse.json({ error: 'Enter the code from the email.' }, { status: 400 })
  }
  // From Create account the Terms were just ticked: the version comes along and
  // is recorded. From Sign in (an older, never-confirmed sign-up) nothing was
  // ticked on this visit: no version, and needsTerms says whether to ask.
  const terms = body?.acceptedTosVersion
  if (terms !== undefined && terms !== CURRENT_TOS_VERSION) {
    return NextResponse.json({ error: 'Please accept the Terms of Service to create an account.' }, { status: 422 })
  }

  const confirmed = await confirmSignUp(email, code)
  if ('error' in confirmed) {
    if (confirmed.error === 'invalid_code') {
      return NextResponse.json({ error: 'That code is not valid. Check your email and try again.' }, { status: 400 })
    }
    if (confirmed.error === 'expired_code') {
      return NextResponse.json({ error: 'That code has expired. Send a new one.' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Couldn’t confirm your email. Please try again.' }, { status: 400 })
  }

  // The password was checked when the code was sent (sign-up) or asked for
  // (sign-in), but not since: a wrong one here signs nothing in.
  const tokens = await signIn(email, password)
  const user = 'error' in tokens ? null : await verifyIdToken(tokens.idToken)
  if ('error' in tokens || !user) {
    return NextResponse.json({ error: 'Your email is confirmed. Please sign in.' }, { status: 500 })
  }

  // Recorded before the cookie goes back, so the first signed-in request has
  // them. A failure is logged and doesn't block: the Terms gate would ask again
  // at the next sign-in, and an invitation can be sent again.
  if (terms) {
    try {
      await recordAcceptance(user.id, CURRENT_TOS_VERSION)
    } catch (err) {
      console.error('[signup] recordAcceptance failed', err)
    }
  }
  try {
    await markEmailProven(user.id, 'sign_up_code')
  } catch (err) {
    console.error('[signup] markEmailProven failed', err)
  }
  try {
    await applyPendingInvitations(email, user.id)
  } catch (err) {
    console.error('[signup] applyPendingInvitations failed', err)
  }

  emitMetric('signup')
  return signedInResponse(req,
    { id: user.id, email, displayName: user.displayName, ...(terms ? {} : { needsTerms: !(await hasAcceptedCurrent(user.id)) }) },
    tokens.idToken, tokens.refreshToken, { status: 201 },
  )
}
