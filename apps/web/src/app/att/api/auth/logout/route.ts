import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { revoke } from '@/lib/cognito'
import { REFRESH_COOKIE, clearAuthCookies, isAppRequest } from '@/lib/auth'

// Signs out: revokes the refresh token (the website's cookie, or the one an
// app sends in the body) so it can't be swapped for new ID tokens.
export async function POST(req: Request) {
  const cookieStore = await cookies()
  const fromApp = isAppRequest(req) ? await req.json().then(b => b?.refreshToken, () => undefined) : undefined
  const refreshToken = typeof fromApp === 'string' ? fromApp : cookieStore.get(REFRESH_COOKIE)?.value
  if (refreshToken) await revoke(refreshToken)

  const res = NextResponse.json({ ok: true })
  clearAuthCookies(res.cookies)
  return res
}
