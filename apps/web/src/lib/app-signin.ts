import { createHash, randomBytes } from 'crypto'
import { deleteObject, getJson, putJson } from '@paddlesnitch/core/storage'
import { requestSignIn } from '@paddlesnitch/core/auth'

// Sign in with Google from a phone app (docs/features/mobile-apps.md, C2): the
// app opens the website's Google flow in an in-app browser with a PKCE
// challenge (RFC 7636, S256), and the code comes back to the app's own URL
// scheme (RFC 8252). Anyone can make a challenge, so a flow must not finish
// from a link alone: Google from an app goes through a tap on
// /signin/google-app (security review, 2026-10-26).

/** Where Sign in with Google from an app ends: `?code=` (Cognito's own, to swap at google/app-token) or `?error=<key>`. */
export const APP_GOOGLE_URL = 'com.paddlesnitch.app:/signin/google'

const b64url = (b: Buffer) => b.toString('base64url')
const sha256 = (s: string) => createHash('sha256').update(s).digest()
const keyFor = (code: string, prefix: string) => `${prefix}${sha256(code).toString('hex')}.json`
const isCode = (s: string) => /^[A-Za-z0-9_-]{43}$/.test(s)

/** A PKCE S256 challenge: 32 bytes, base64url without padding. */
export const isChallenge = (s: string | null | undefined): s is string => !!s && /^[A-Za-z0-9_-]{43}$/.test(s)

// Website pages from a signed-in app (C4): the app asks for a code with its
// Bearer token and opens /att/api/auth/web-code?code=…&next=… in the in-app
// browser, which turns it into the website's cookies. It sits in a URL, so it
// lasts a minute and works once.
/** Set by web-code on the browser it signs in: the account it was signed in as. */
export const FROM_LINK_COOKIE = 'tt_from_link'
const WEB_PREFIX = 'auth/web-codes/'
const WEB_CODE_TTL_MS = 60_000

type WebPending = { email: string; userId: string; expiresAt: number }

export async function createWebCode(email: string, userId: string, now = Date.now()): Promise<string> {
  const code = b64url(randomBytes(32))
  await putJson(keyFor(code, WEB_PREFIX), { email, userId, expiresAt: now + WEB_CODE_TTL_MS } satisfies WebPending)
  return code
}

export async function redeemWebCode(code: string, now = Date.now()): Promise<{ email: string; userId: string } | null> {
  if (!isCode(code)) return null
  const key = keyFor(code, WEB_PREFIX)
  const pending = await getJson<WebPending>(key)
  if (!pending) return null
  await deleteObject(key)
  return pending.expiresAt < now ? null : { email: pending.email, userId: pending.userId }
}

// A web-code link signs a browser in with a NEW Cognito sign-in, whose
// auth_time is "now" even though nobody proved who they are just then. So the
// session it makes is recorded, and never counts as a recent sign-in
// (security review, 2026-10-25). Kept under users/{id}/, so erasure removes it.
const linkSessionKey = (userId: string, session: string) => `users/${userId}/link-sessions/${sha256(session).toString('hex')}.json`

export async function markLinkSession(userId: string, session: string, now = Date.now()): Promise<void> {
  await putJson(linkSessionKey(userId, session), { at: new Date(now).toISOString() })
}

/** Deleting the account needs a real sign-in from the last 10 minutes. */
export const RECENT_SIGN_IN_S = 10 * 60

/**
 * Whether this request's sign-in is recent enough to delete the account: a
 * real sign-in (not one a web-code link made) by this same person, within
 * RECENT_SIGN_IN_S. Fails closed on anything missing.
 */
export async function hasRecentSignIn(req: Request, userId: string, now = Date.now()): Promise<boolean> {
  const signIn = await requestSignIn(req)
  if (!signIn || signIn.sub !== userId || !signIn.signedInAt || !signIn.session) return false
  if (now / 1000 - signIn.signedInAt > RECENT_SIGN_IN_S) return false
  return !(await getJson(linkSessionKey(userId, signIn.session)))
}
