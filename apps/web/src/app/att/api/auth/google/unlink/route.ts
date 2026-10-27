import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { canonicalBaseUrl } from '@/lib/url'
import { disconnectGoogle, findUserBySub } from '@/lib/cognito'

// POST /att/api/auth/google/unlink — Disconnect on Account: the connected
// Google login stops opening this account (lib/google-link.ts). Only for an
// email account; a Google account is its Google login. 303 back to Account.
export async function POST(req: NextRequest) {
  const base = canonicalBaseUrl(req)
  const go = (key: string) => NextResponse.redirect(new URL(`/account?google=${key}#google`, base), 303)
  const origin = req.headers.get('origin')
  if (origin && origin !== new URL(base).origin && origin !== req.nextUrl.origin) return go('google_failed')
  const user = await getAuthUser()
  if (!user) return NextResponse.redirect(new URL('/signin?next=/account', base), 303)
  const me = await findUserBySub(user.id)
  if (!me?.googleId) return go('disconnected')
  try {
    await disconnectGoogle(me.googleId)
  } catch (err) {
    console.error('[google unlink] couldn’t disconnect', err)
    return go('disconnect_failed')
  }
  return go('disconnected')
}
