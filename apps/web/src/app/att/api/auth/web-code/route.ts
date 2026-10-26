import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { customAuthSignIn, sessionOfFreshToken } from '@/lib/cognito'
import { bearerUser, setAuthCookies } from '@/lib/auth'
import { canonicalBaseUrl, safeNext } from '@/lib/url'
import { createWebCode, redeemWebCode, markLinkSession, FROM_LINK_COOKIE } from '@/lib/app-signin'

// A signed-in app opens a website page already signed in (lib/app-signin.ts, C4).
//
// Pages only, never a server route: a link anyone can make (from their own
// app) signs the browser that opens it in as THEM, so it must not be able to
// start anything by itself, such as connecting the opener's Strava to their
// account (security review, C5). A route as `next` goes to the home page.
// Checked on the path as the browser will resolve it (`/att/./api`, `%2e`,
// `/x/../att/api` and backslashes all normalise), and that resolved path is
// what we send on.
function pageOnly(next: string): string {
  const u = new URL(next, 'http://x')
  if (u.host !== 'x') return '/'
  return /^\/(att\/)?api(\/|$)/i.test(u.pathname) ? '/' : u.pathname + u.search + u.hash
}

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
  url.searchParams.set('next', pageOnly(safeNext(typeof next === 'string' ? next : null)))
  return NextResponse.json({ url: url.toString() })
}

/** The in-app browser swaps it for the website's cookies and goes on to `next`. */
export async function GET(req: NextRequest) {
  const base = canonicalBaseUrl(req)
  const next = pageOnly(safeNext(req.nextUrl.searchParams.get('next')))
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
  // Marks this browser as signed in by a link: whoever opened it may not be the
  // account's owner, so connecting Strava refuses here (it's done in the app).
  res.cookies.set(FROM_LINK_COOKIE, account.userId, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: 24 * 60 * 60, secure: process.env.NODE_ENV === 'production',
  })
  return res
}
