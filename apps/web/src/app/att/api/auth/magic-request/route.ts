import { NextResponse } from 'next/server'

// Magic link is temporarily disabled. The Cognito migration ships email+password only;
// magic link will be re-added via Cognito Custom Auth Lambda triggers in a follow-up.
export async function POST() {
  return NextResponse.json(
    { error: 'Sign-in links aren’t available. Use an email code or your password.' },
    { status: 501 }
  )
}
