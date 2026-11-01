// Accounts being deleted, or deleted in the last two days (C3, #761). An app's
// ID token stays valid for up to 24 h after the account is deleted, and a phone
// uploads by itself, so without this a phone could write recordings under an
// erased account after erasure finished.
//
// Two states, so a delete that fails half way never makes a phone throw away a
// live account's recordings:
// - `pending` (written before erasure starts): the phone calls answer 503, so
//   the app keeps its files and retries. Counts only for 5 minutes: a request
//   is cut off at 30 s, so a pending marker older than that is a delete that
//   died, and the account is live.
// - `done` (written once the sign-in account itself is gone): the phone calls
//   answer 410 and the app deletes that account's recordings.
// The marker holds only the state and a time, under a hash of the account ID
// (account-data-complete.test.ts checks no key mentions the ID). A lifecycle
// rule (infra att-stack.ts, auth/erased/) removes it after 2 days, and a
// marker older than that is ignored anyway. An upload already past the check
// when the marker lands can still finish in the same moment (accepted).
import { createHash } from 'crypto'
import { getJson, putJson } from './storage'

export const ERASED_PREFIX = 'auth/erased/'
const key = (userId: string) => `${ERASED_PREFIX}${createHash('sha256').update(userId).digest('hex')}.json`
const KEEP_MS = 2 * 24 * 60 * 60 * 1000
const PENDING_MS = 5 * 60 * 1000

type Marker = { state: 'pending' | 'done'; at: string }
export type ErasureState = 'none' | 'pending' | 'done'

/** Before erasure starts. */
export async function markAccountErasing(userId: string): Promise<void> {
  await putJson(key(userId), { state: 'pending', at: new Date().toISOString() } satisfies Marker)
}

/** Once the account can't sign in again. */
export async function markAccountErased(userId: string): Promise<void> {
  await putJson(key(userId), { state: 'done', at: new Date().toISOString() } satisfies Marker)
}

export async function erasureState(userId: string): Promise<ErasureState> {
  const m = await getJson<Marker>(key(userId))
  if (!m) return 'none'
  const age = Date.now() - Date.parse(m.at)
  if (m.state === 'done') return age < KEEP_MS ? 'done' : 'none'
  return age < PENDING_MS ? 'pending' : 'none'
}

/** True while a deleted account's tokens may still be valid. */
export async function isAccountErased(userId: string): Promise<boolean> {
  return (await erasureState(userId)) === 'done'
}
