import { NextResponse } from 'next/server'
import { googleSignInOn } from '@/lib/sign-in-options'
import { googleConfigured } from '@/lib/google-signin'

// GET /att/api/auth/options — which sign-in buttons the apps show besides
// email: the same switches the website's sign-in page uses. `strava` is always
// false (removed 2026-11); kept so older app builds still decode the answer.
export async function GET() {
  return NextResponse.json({ google: googleSignInOn() && googleConfigured(), strava: false })
}
