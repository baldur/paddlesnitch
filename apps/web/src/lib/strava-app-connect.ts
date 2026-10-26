import { createHash, randomBytes } from 'crypto'
import { deleteObject, getJson, putJson } from '@paddlesnitch/core/storage'
import { getUserIdByAthleteId, getStravaTokens, putStravaTokens, putAthleteIndex, deleteAthleteIndex } from '@paddlesnitch/core/strava-storage'
import type { StravaTokens } from '@paddlesnitch/core/types'

// Connecting Strava from a signed-in phone app (docs/features/mobile-apps.md,
// C5), shaped like the app's Strava sign-in (lib/app-signin.ts):
//
//  1. The app asks, with its Bearer token and a PKCE challenge, for Strava's
//     address. The `state` in it names a server-side record of who asked.
//  2. The callback finds that record, swaps Strava's code for tokens, and
//     stores NOTHING on the account: it parks the tokens under a one-use code
//     sent to the app's own address.
//  3. The app swaps that code + its verifier, with its Bearer token, and only
//     then are the tokens saved, and only if it is the same person.
//
// So a link someone else made can never connect a stranger's Strava to their
// account: they never see the code the stranger's browser gets, and the
// stranger's app can't spend it (wrong person, wrong verifier). The website's
// web-code route is not used here for that reason (security review, C5).
//
// Everything sits under auth/app-codes/, which a lifecycle rule empties daily,
// so tokens parked and never collected don't linger.

const STATE_PREFIX = 'auth/app-codes/strava-state/'
const CODE_PREFIX = 'auth/app-codes/strava-connect/'
const STATE_TTL_MS = 10 * 60_000
const CODE_TTL_MS = 5 * 60_000

type Started = { userId: string; challenge: string; expiresAt: number }
type Parked = Started & { tokens: StravaTokens }

const b64url = (b: Buffer) => b.toString('base64url')
const sha256 = (s: string) => createHash('sha256').update(s).digest()
const keyFor = (prefix: string, secret: string) => `${prefix}${sha256(secret).toString('hex')}.json`
const isSecret = (s: string | null | undefined): s is string => !!s && /^[A-Za-z0-9_-]{43}$/.test(s)

/** An app's state is 43 base64url characters; the website's is 48 hex. Tells where an unknown or late one belongs. */
export const looksLikeAppState = isSecret

/** Step 1: the `state` to send to Strava, remembering who asked. */
export async function startAppConnect(userId: string, challenge: string, now = Date.now()): Promise<string> {
  const state = b64url(randomBytes(32))
  await putJson(keyFor(STATE_PREFIX, state), { userId, challenge, expiresAt: now + STATE_TTL_MS } satisfies Started)
  return state
}

/** Step 2a: who started this, if it is an app's connect; spent on reading. */
export async function takeAppConnectState(state: string | null, now = Date.now()): Promise<Omit<Started, 'expiresAt'> | null> {
  if (!isSecret(state)) return null
  const key = keyFor(STATE_PREFIX, state)
  const started = await getJson<Started>(key)
  if (!started) return null
  await deleteObject(key)
  return started.expiresAt < now ? null : { userId: started.userId, challenge: started.challenge }
}

/** Step 2b: park the tokens for that person; the code goes to the app. */
export async function parkAppConnect(started: Omit<Started, 'expiresAt'>, tokens: StravaTokens, now = Date.now()): Promise<string> {
  const code = b64url(randomBytes(32))
  await putJson(keyFor(CODE_PREFIX, code), { ...started, tokens, expiresAt: now + CODE_TTL_MS } satisfies Parked)
  return code
}

/** Step 3: the tokens, once, for the person who started it with this verifier. The code is spent either way. */
export async function finishAppConnect(code: string, verifier: string, userId: string, now = Date.now()): Promise<StravaTokens | null> {
  if (!isSecret(code)) return null
  const key = keyFor(CODE_PREFIX, code)
  const parked = await getJson<Parked>(key)
  if (!parked) return null
  await deleteObject(key)
  if (parked.expiresAt < now || parked.userId !== userId || b64url(sha256(verifier)) !== parked.challenge) return null
  return parked.tokens
}

/**
 * True when this Strava athlete is connected to a different account: never move
 * it silently. Deliberately no "does that account still exist?" lookup: a
 * failed lookup would read as "gone" and let the link move (security review,
 * C5). Erasure, disconnect and saveStravaConnection drop an index that points
 * at their own account, so only links left from before then can be stale.
 */
export async function linkedElsewhere(athleteId: number | undefined, userId: string): Promise<boolean> {
  if (!athleteId) return false
  const owner = await getUserIdByAthleteId(athleteId)
  return !!owner && owner !== userId
}

/**
 * Save a Strava connection on this account (website callback and app finish).
 * If the account was connected to a different athlete before, that athlete's
 * index is dropped when it still points here, so it doesn't linger.
 */
export async function saveStravaConnection(userId: string, tokens: StravaTokens): Promise<void> {
  const before = await getStravaTokens(userId)
  if (before?.athleteId && before.athleteId !== tokens.athleteId && (await getUserIdByAthleteId(before.athleteId)) === userId) {
    await deleteAthleteIndex(before.athleteId)
  }
  await putStravaTokens(userId, tokens)
  if (tokens.athleteId) await putAthleteIndex(tokens.athleteId, userId)
}
