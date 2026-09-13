import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { revoke } from '@/lib/cognito'
import { REFRESH_COOKIE, clearAuthCookies } from '@/lib/auth'

export async function POST() {
  const cookieStore = await cookies()
  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value
  if (refreshToken) await revoke(refreshToken)

  const res = NextResponse.json({ ok: true })
  clearAuthCookies(res.cookies)
  return res
}
