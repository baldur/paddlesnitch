import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getAuthUser } from '@/lib/auth'
import { REFRESH_COOKIE } from '@paddlesnitch/core/auth'
import { accessTokenFrom, confirmEmailProof, sendEmailProofCode } from '@/lib/cognito'
import { markEmailProven } from '@/lib/email-proven'
import { mayEmailCode, TOO_MANY_CODES } from '@/lib/code-email-limit'

// POST /api/account/email-proof — prove the account's email from Account,
// for Connect Google (lib/google-link.ts): accounts made before sign-up codes
// (2026-10-26) never did. {} sends a code to the address (Cognito's own
// sender, like reset codes); {code} checks it and marks the email proven.
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  const refreshToken = (await cookies()).get(REFRESH_COOKIE)?.value
  if (!user || !refreshToken) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
  const accessToken = await accessTokenFrom(refreshToken)
  if (!accessToken) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { code?: unknown }

  if (body.code === undefined) {
    if (!(await mayEmailCode(req, user.email))) return NextResponse.json({ error: TOO_MANY_CODES }, { status: 429 })
    const sent = await sendEmailProofCode(accessToken)
    if ('error' in sent) {
      console.warn('[email-proof] could not send a code', sent.error)
      return NextResponse.json({ error: 'Couldn’t send a code. Please try again.' }, { status: 500 })
    }
    return NextResponse.json({ sent: true })
  }

  const code = typeof body.code === 'string' ? body.code.trim() : ''
  if (!/^\d{6}$/.test(code)) return NextResponse.json({ error: 'Enter the 6-digit code from the email.' }, { status: 400 })
  const done = await confirmEmailProof(accessToken, code)
  if ('error' in done) {
    const text = done.error === 'expired_code' ? 'That code has expired. Send a new one.' : 'That code is not valid. Check your email and try again.'
    return NextResponse.json({ error: text }, { status: 400 })
  }
  await markEmailProven(user.id, 'account_code')
  return NextResponse.json({ proven: true })
}
