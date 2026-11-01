import type { AuthUser } from './types'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { refresh, verifyIdToken, idTokenSignIn, type SignInClaims } from './cognito'
import { resolveDeviceToken, type DeviceAuth } from './devices'
import { erasedForSignIn } from './erased'

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

// The apps mark their sign-in calls with this header (value: platform/version,
// e.g. "android/0.1.0") and get the tokens in the answer instead of cookies
// (docs/features/mobile-apps.md, C2). The website never sends it.
export const APP_HEADER = 'x-paddlesnitch-app'

export function isAppRequest(req: Request): boolean {
  return !!req.headers.get(APP_HEADER)
}

/**
 * The answer to a successful sign-in, for the website or an app: the website
 * gets the tokens as httpOnly cookies and never in the body; an app gets them
 * in the body (it keeps them itself) and no cookies.
 */
export function signedInResponse(req: Request, body: Record<string, unknown>, idToken: string, refreshToken: string, init?: ResponseInit): NextResponse {
  if (isAppRequest(req)) return NextResponse.json({ ...body, idToken, refreshToken }, init)
  const res = NextResponse.json(body, init)
  setAuthCookies(res.cookies, idToken, refreshToken)
  return res
}

export function clearAuthCookies(jar: CookieJar) {
  jar.delete(ID_COOKIE)
  jar.delete(REFRESH_COOKIE)
}

// The person behind a request from the website OR a mobile app: the apps send
// their Cognito ID token as `Authorization: Bearer <token>`
// (docs/features/mobile-apps.md), the website the tt_id cookie. A Bearer header
// that isn't a valid ID token (expired, or a tracker's device token) is null:
// it never falls back to a cookie, and a device token never signs in a person.
// A deleted account's token is still a valid JWT for up to 24 h, so an account
// whose delete has finished counts as signed out (#795, @paddlesnitch/core/erased).
export async function getRequestUser(req: Request): Promise<AuthUser | null> {
  return notErased(await getRequestUserEvenIfErased(req))
}

/**
 * getRequestUser without the deleted-account check. Only for the phone upload
 * calls, which answer a deleted account themselves (410, or 503 while the
 * delete runs: apps/web/src/lib/erased-answer.ts) so the app removes its files.
 */
export async function getRequestUserEvenIfErased(req: Request): Promise<AuthUser | null> {
  const m = /^Bearer\s+(.+)$/i.exec((req.headers.get('authorization') ?? '').trim())
  if (m) return verifyIdToken(m[1].trim())
  return signedInFromCookies()
}

/** Null for an account whose delete has finished; the user otherwise. */
async function notErased(user: AuthUser | null): Promise<AuthUser | null> {
  if (!user) return null
  return (await erasedForSignIn(user.id)) ? null : user
}

// The sign-in behind this request, from the same token getRequestUser reads:
// the app's Bearer, else the website cookie. Null when there's no valid token.
// For actions that need a recent, real sign-in (deleting the account).
export async function requestSignIn(req: Request): Promise<SignInClaims | null> {
  const m = /^Bearer\s+(.+)$/i.exec((req.headers.get('authorization') ?? '').trim())
  if (m) return idTokenSignIn(m[1].trim())
  const idToken = (await cookies()).get(ID_COOKIE)?.value
  return idToken ? idTokenSignIn(idToken) : null
}

/** The Bearer token's person only: never the website cookie. */
export async function bearerUser(req: Request): Promise<AuthUser | null> {
  const m = /^Bearer\s+(.+)$/i.exec((req.headers.get('authorization') ?? '').trim())
  return m ? notErased(await verifyIdToken(m[1].trim())) : null
}

// Returns the authenticated user from the ID-token cookie, or null.
// If the ID token is expired but the refresh token is valid, transparently refreshes
// (when called from a mutable context — Route Handlers and Server Actions).
// Server Components have read-only cookies; expired tokens there return null.
// A deleted account is signed out (see getRequestUser).
export async function getAuthUser(): Promise<AuthUser | null> {
  return notErased(await signedInFromCookies())
}

async function signedInFromCookies(): Promise<AuthUser | null> {
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
