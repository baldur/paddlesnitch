import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getAuthUser } from '@/lib/auth'
import { authorizeUrl } from '@/lib/strava'
import { canonicalBaseUrl } from '@/lib/url'

// Kick off the OAuth dance: mint a CSRF state, set it as an httpOnly cookie,
// redirect to Strava's authorize page. The callback verifies the cookie matches
// the `state` Strava echoes back.
export async function GET(req: NextRequest) {
  const base = canonicalBaseUrl(req)
  const user = await getAuthUser()
  if (!user) return NextResponse.redirect(new URL('/att/auth?next=/profile/me/settings', base))

  const state = randomBytes(24).toString('hex')
  // redirect_uri MUST match what's registered in the Strava API app exactly,
  // so we always build it off the canonical base URL — never req.url, which
  // resolves to the Lambda function URL behind CloudFront.
  const redirectUri = new URL('/att/api/strava/callback', base).toString()
  const url = await authorizeUrl(state, redirectUri)
  if (!url) {
    return NextResponse.redirect(new URL('/profile/me/settings?strava=not_configured', base))
  }

  const res = NextResponse.redirect(url)
  res.cookies.set('strava_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
    secure: process.env.NODE_ENV === 'production',
  })
  return res
}
