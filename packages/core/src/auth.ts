import type { AuthUser } from './types'
import { cookies } from 'next/headers'
import { refresh, verifyIdToken } from './cognito'
import { resolveDeviceToken, type DeviceAuth } from './devices'

// Authenticate a HARDWARE device from its `Authorization: Bearer <deviceToken>`
// header, or null. Deliberately SEPARATE from getAuthUser(): a device token must
// never satisfy a route that expects a human browser session, and a cookie must
// never satisfy a device route. Do not merge these into one "current principal".
export async function getDeviceAuth(req: Request): Promise<DeviceAuth | null> {
  const header = req.headers.get('authorization') ?? ''
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (!m) return null
  return resolveDeviceToken(m[1].trim())
}

export const ID_COOKIE = 'tt_id'
export const REFRESH_COOKIE = 'tt_refresh'

const ID_MAX_AGE = 60 * 60 * 24       // 24 h — matches Cognito ID token validity
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30 // 30 d

type CookieJar = {
  get: (name: string) => { value: string } | undefined
  set: (name: string, value: string, options: Record<string, unknown>) => void
  delete: (name: string) => void
}

export function setAuthCookies(jar: CookieJar, idToken: string, refreshToken?: string) {
  const base = { httpOnly: true, sameSite: 'lax' as const, path: '/', secure: process.env.NODE_ENV === 'production' }
  jar.set(ID_COOKIE, idToken, { ...base, maxAge: ID_MAX_AGE })
  if (refreshToken !== undefined) {
    jar.set(REFRESH_COOKIE, refreshToken, { ...base, maxAge: REFRESH_MAX_AGE })
  }
}

export function clearAuthCookies(jar: CookieJar) {
  jar.delete(ID_COOKIE)
  jar.delete(REFRESH_COOKIE)
}

// Returns the authenticated user from the ID-token cookie, or null.
// If the ID token is expired but the refresh token is valid, transparently refreshes
// (when called from a mutable context — Route Handlers and Server Actions).
// Server Components have read-only cookies; expired tokens there return null.
export async function getAuthUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies()
  const idToken = cookieStore.get(ID_COOKIE)?.value
  if (idToken) {
    const user = await verifyIdToken(idToken)
    if (user) return user
  }

  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value
  if (!refreshToken) return null

  const result = await refresh(refreshToken)
  if ('error' in result) return null

  const user = await verifyIdToken(result.idToken)
  if (!user) return null

  // Best-effort: set the refreshed ID token if cookies are mutable here.
  // In a Server Component this throws; we swallow and return the user anyway,
  // so the page renders with the live user. Next request will re-refresh.
  try {
    setAuthCookies(cookieStore as unknown as CookieJar, result.idToken)
  } catch {
    // Read-only context — fine.
  }

  return user
}
