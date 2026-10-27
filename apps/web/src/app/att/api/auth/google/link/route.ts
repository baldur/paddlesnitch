import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getAuthUser } from '@/lib/auth'
import { canonicalBaseUrl } from '@/lib/url'
import { FROM_LINK_COOKIE, hasRecentSignIn } from '@/lib/app-signin'
import { googleConfigured, toGoogle } from '@/lib/google-signin'
import { findUserBySub } from '@/lib/cognito'
import { leaveLinkNote } from '@/lib/google-link'

// POST /att/api/auth/google/link — Connect Google, from the button on Account
// (lib/google-link.ts). Like connecting Strava: POST only from our own page,
// never for a browser a web-code link signed in, and only after a recent real
// sign-in, because it adds a way into the account. Answers are 303.
export async function POST(req: NextRequest) {
  const base = canonicalBaseUrl(req)
  const go = (key: string) => NextResponse.redirect(new URL(`/account?google=${key}#google`, base), 303)
  const origin = req.headers.get('origin')
  if (origin && origin !== new URL(base).origin && origin !== req.nextUrl.origin) return go('google_failed')
  const user = await getAuthUser()
  if (!user) return NextResponse.redirect(new URL('/signin?next=/account', base), 303)
  if ((await cookies()).get(FROM_LINK_COOKIE)?.value === user.id) return go('use_website')
  if (!(await hasRecentSignIn(req, user.id))) return go('reauth')
  if (!googleConfigured()) return go('google_not_configured')
  const me = await findUserBySub(user.id)
  if (me?.google || me?.googleLinked) return go('connected')
  // The trigger matches Google's verified email to this account's: only an
  // address this account has proved.
  if (!me || !user.emailVerified) return go('google_failed')
  await leaveLinkNote(me.email, user.id)
  return toGoogle(base, '/account#google', { link: true })
}
