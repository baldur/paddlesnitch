import { NextRequest, NextResponse } from 'next/server'
import { forgotPassword } from '@/lib/cognito'
import { looksLikeBot } from '@/lib/anti-bot'

// Triggers Cognito to email a 6-digit reset code. We deliberately return the
// same 200 response regardless of whether the email exists in the pool —
// don't leak account-existence to unauthenticated callers.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const email = typeof body?.email === 'string' ? body.email.toLowerCase().trim() : ''
  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }
  // Anti-bot gate before the SES send. On a bot signal we skip forgotPassword
  // entirely and return the same { ok: true } we'd return for a non-existent
  // account — no email goes out, and the bot gets no distinguishing signal.
  if (looksLikeBot(body)) {
    return NextResponse.json({ ok: true })
  }
  // Fire-and-forget at the API surface. Internal errors are swallowed for the
  // existence-leak reason above; the underlying call still logs to CloudWatch.
  await forgotPassword(email)
  return NextResponse.json({ ok: true })
}
