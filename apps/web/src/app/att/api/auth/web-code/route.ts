import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { customAuthSignIn } from '@/lib/cognito'
import { getRequestUser, setAuthCookies } from '@/lib/auth'
import { canonicalBaseUrl, safeNext } from '@/lib/url'
import { createWebCode, redeemWebCode } from '@/lib/app-signin'

// A signed-in app opens a website page already signed in (lib/app-signin.ts, C4).

/** The app asks, with its Bearer token, for a link to `next` carrying a one-minute, one-use code. */
export async function POST(req: NextRequest) {
  const user = await getRequestUser(req)
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
  const tokens = account ? await customAuthSignIn(account.email, randomBytes(32).toString('hex')) : null
  if (!tokens || 'error' in tokens) {
    // Signing in by hand still gets them there.
    return NextResponse.redirect(new URL(`/signin?error=app_link_expired&next=${encodeURIComponent(next)}`, base))
  }
  const res = NextResponse.redirect(new URL(next, base))
  setAuthCookies(res.cookies, tokens.idToken, tokens.refreshToken)
  return res
}
