import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getUserContact, putUserContactEmail, clearUserContact } from '@/lib/contact'

// GET /api/account/contact
// Returns the viewer's optional contact email, plus a flag indicating
// whether their account email is the synthesised Strava placeholder —
// the UI uses this to decide whether to show the "add an email" banner.
export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const contact = await getUserContact(user.id)
  return NextResponse.json({ contact: contact ?? null })
}

// POST /api/account/contact  { email }
// Saves a contact email. No verification round-trip yet (phase 1B) —
// we trust the user not to typo. Validation is just "looks like an
// email at all"; everything stricter belongs at the SES verify step.
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Please provide a valid email address.' }, { status: 400 })
  }
  const updated = await putUserContactEmail(user.id, email)
  return NextResponse.json({ contact: updated })
}

// DELETE /api/account/contact
// Removes the contact email entirely. Used by the "no, I don't want to
// add an email" follow-on in the banner — distinct from a one-session
// dismiss (which is just a cookie on the client).
export async function DELETE() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await clearUserContact(user.id)
  return NextResponse.json({ ok: true })
}
