import { NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { findUserBySub } from '@/lib/cognito'
import { isSyntheticStravaEmail } from '@/lib/strava-account'
import { isEmailProven } from '@/lib/email-proven'

// GET /api/account/google — whether Google signs in to this account (a Google
// account, or Google connected to it: lib/google-link.ts), and whether it can
// be connected: only to an email the account has proved, which Google matches.
export async function GET(req: Request) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
  const me = await findUserBySub(user.id)
  const connected = !!(me?.google || me?.googleLinked)
  return NextResponse.json({
    signsInWithGoogle: !!me?.google,
    connected,
    email: user.email,
    canConnect: !connected && !!me && !!user.emailVerified && !isSyntheticStravaEmail(user.email),
    // Connect Google needs a proved email: Account sends a code first (api/account/email-proof).
    emailProven: await isEmailProven(user.id),
    // Only a connected Google login can be disconnected; a Google account is Google.
    canDisconnect: !!me?.googleLinked,
  })
}
