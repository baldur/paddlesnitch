import { createHash, randomBytes } from 'crypto'
import { deleteObject, getJson, putJson } from '@paddlesnitch/core/storage'

// Strava sign-in from a phone app (docs/features/mobile-apps.md, C2). The app
// opens the website's Strava flow in an in-app browser with a PKCE challenge
// (RFC 7636, S256). The callback sends a one-time code to the app's own URL
// scheme (RFC 8252: a Custom Tab or ASWebAuthenticationSession hands it back
// reliably, and debug builds and an iPhone without the Apple team ID can use
// it); the app swaps code + verifier for tokens. Tokens never appear in a URL,
// and a code caught by another app on the phone is useless without the verifier.

export const APP_RETURN_URL = 'com.paddlesnitch.app:/signin/strava'
const CODE_TTL_MS = 5 * 60_000

type Pending = { email: string; userId: string; challenge: string; expiresAt: number }

const b64url = (b: Buffer) => b.toString('base64url')
const sha256 = (s: string) => createHash('sha256').update(s).digest()
const keyFor = (code: string, prefix = 'auth/app-codes/') => `${prefix}${sha256(code).toString('hex')}.json`
const isCode = (s: string) => /^[A-Za-z0-9_-]{43}$/.test(s)

/** A PKCE S256 challenge: 32 bytes, base64url without padding. */
export const isChallenge = (s: string | null | undefined): s is string => !!s && /^[A-Za-z0-9_-]{43}$/.test(s)

export async function createAppCode(email: string, userId: string, challenge: string, now = Date.now()): Promise<string> {
  const code = b64url(randomBytes(32))
  await putJson(keyFor(code), { email, userId, challenge, expiresAt: now + CODE_TTL_MS } satisfies Pending)
  return code
}

/** The account a code was made for, once: the code is spent whether or not the verifier matches. */
export async function redeemAppCode(code: string, verifier: string, now = Date.now()): Promise<{ email: string; userId: string } | null> {
  if (!isCode(code)) return null
  const key = keyFor(code)
  const pending = await getJson<Pending>(key)
  if (!pending) return null
  await deleteObject(key)
  if (pending.expiresAt < now || b64url(sha256(verifier)) !== pending.challenge) return null
  return { email: pending.email, userId: pending.userId }
}

// Website pages from a signed-in app (C4): the app asks for a code with its
// Bearer token and opens /att/api/auth/web-code?code=…&next=… in the in-app
// browser, which turns it into the website's cookies. It sits in a URL, so it
// lasts a minute and works once.
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
