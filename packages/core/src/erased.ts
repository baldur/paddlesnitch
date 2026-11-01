// Accounts deleted in the last two days (C3, #761). An app's ID token stays
// valid for up to 24 h after the account is deleted, and a phone uploads by
// itself, so without this a phone could write recordings under an erased
// account after erasure finished. The marker holds only the time; a lifecycle
// rule (infra att-stack.ts, auth/erased/) removes it after 2 days, and a
// marker older than that is ignored anyway.
import { createHash } from 'crypto'
import { getJson, putJson } from './storage'

// Named by a hash of the account ID, so nothing left after erasure names the
// account (account-data-complete.test.ts checks no key mentions it).
const key = (userId: string) => `auth/erased/${createHash('sha256').update(userId).digest('hex')}.json`
const KEEP_MS = 2 * 24 * 60 * 60 * 1000

/** Before erasure starts: refuse new writes from this account's tokens. */
export async function markAccountErased(userId: string): Promise<void> {
  await putJson(key(userId), { at: new Date().toISOString() })
}

/** True while a deleted account's tokens may still be valid. */
export async function isAccountErased(userId: string): Promise<boolean> {
  const m = await getJson<{ at: string }>(key(userId))
  return !!m && Date.now() - Date.parse(m.at) < KEEP_MS
}
