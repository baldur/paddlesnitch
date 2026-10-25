import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { customAuthSignIn, sessionOfFreshToken } from '@/lib/cognito'
import { bearerUser, setAuthCookies } from '@/lib/auth'
import { canonicalBaseUrl, safeNext } from '@/lib/url'
import { createWebCode, redeemWebCode, markLinkSession } from '@/lib/app-signin'

// A signed-in app opens a website page already signed in (lib/app-signin.ts, C4).

/**
 * The app asks, with its Bearer token, for a link to `next` carrying a
 * one-minute, one-use code. Bearer only: a website session must not be able
 * to mint itself a new sign-in.
 */
export async function POST(req: NextRequest) {
  const user = await bearerUser(req)
  if (!user) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
  const { next } = await req.json().catch(() => ({}))
  const url = new URL('/att/api/auth/web-code', canonicalBaseUrl(req))
  url.searchParams.set('code', await createWebCode(user.email, user.id))
  url.searchParams.set('next', safeNext(typeof next === 'string' ? next : null))
  return NextResponse.json({ url: url.toString() })
}

/** The in-app browser swaps it for the website's cookies and goes on to `next`. */
export async function GET(req: NextRequest) {
  const base = canonicalBaseUrl(req)
  const next = safeNext(req.nextUrl.searchParams.get('next'))
  const account = await redeemWebCode(req.nextUrl.searchParams.get('code') ?? '')
  const tokens = account ? await customAuthSignIn(account.email, randomBytes(32).toString('hex'), account.userId) : null
  if (!account || !tokens || 'error' in tokens) {
    // Signing in by hand still gets them there.
    return NextResponse.redirect(new URL(`/signin?error=app_link_expired&next=${encodeURIComponent(next)}`, base))
  }
  // This sign-in proved nothing new, so it never counts as a recent one. A
  // session we can't name can't be marked, so it isn't handed out at all.
  const session = sessionOfFreshToken(tokens.idToken)
  if (!session) return NextResponse.redirect(new URL(`/signin?error=app_link_expired&next=${encodeURIComponent(next)}`, base))
  await markLinkSession(account.userId, session)
  const res = NextResponse.redirect(new URL(next, base))
  setAuthCookies(res.cookies, tokens.idToken, tokens.refreshToken)
  return res
}
