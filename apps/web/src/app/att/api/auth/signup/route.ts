import { NextRequest, NextResponse } from 'next/server'
import { signUp, signIn } from '@/lib/cognito'
import { setAuthCookies } from '@/lib/auth'
import { recordAcceptance } from '@/lib/tos'
import { CURRENT_TOS_VERSION } from '@/lib/types'
import { applyPendingInvitations } from '@/lib/pending-invitations'
import { emitMetric } from '@/lib/metrics'

export async function POST(req: NextRequest) {
  const { email, displayName, password, acceptedTosVersion } = await req.json()

  if (!email || !displayName || !password) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters' },
      { status: 400 }
    )
  }
  // ToS acceptance is mandatory on signup. The client must echo the
  // current version it rendered so we don't accidentally accept a stale
  // version the user never saw.
  if (acceptedTosVersion !== CURRENT_TOS_VERSION) {
    return NextResponse.json(
      { error: `You must accept the Terms of Service (version ${CURRENT_TOS_VERSION}) to create an account.` },
      { status: 422 }
    )
  }

  const normalised = String(email).toLowerCase().trim()

  const created = await signUp(normalised, String(displayName).trim(), password)
  if ('error' in created) {
    if (created.error === 'email_exists') {
      return NextResponse.json({ error: 'Email already in use' }, { status: 409 })
    }
    if (created.error === 'invalid_password') {
      return NextResponse.json({
        error: 'Password must contain at least one uppercase letter, one lowercase letter, and one number',
      }, { status: 400 })
    }
    return NextResponse.json({ error: 'Sign-up failed' }, { status: 500 })
  }

  const tokens = await signIn(normalised, password)
  if ('error' in tokens) {
    return NextResponse.json({ error: 'Signed up but auto-login failed — please sign in.' }, { status: 500 })
  }

  // Record acceptance before we hand back the cookie so the user lands on
  // an authenticated request with the consent in place. Failure here is
  // logged but doesn't block signup — the re-accept gate would fire on
  // the next request.
  try {
    await recordAcceptance(created.sub, CURRENT_TOS_VERSION)
  } catch (err) {
    console.error('[signup] recordAcceptance failed', err)
  }

  // Pull in any group invitations queued for this email before signup. Done
  // before we return the cookie so the next request the user makes already
  // shows the groups they were invited to.
  try {
    await applyPendingInvitations(normalised, created.sub)
  } catch (err) {
    // Don't fail the signup over a pending-invite hiccup — the user can
    // still be re-invited later. Log so we notice in CloudWatch.
    console.error('[signup] applyPendingInvitations failed', err)
  }

  emitMetric('signup')
  const res = NextResponse.json(
    { id: created.sub, email: normalised, displayName: String(displayName).trim() },
    { status: 201 }
  )
  setAuthCookies(res.cookies, tokens.idToken, tokens.refreshToken)
  return res
}
