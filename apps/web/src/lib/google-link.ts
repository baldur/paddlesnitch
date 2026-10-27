import { createHash } from 'crypto'
import { putJson } from '@/lib/storage'

// Connect Google (Account). Google sign-in never matches an account by email
// (owner, #697), so a person who already has an account connects Google while
// signed in: we leave a note for the PreSignUp trigger
// (infra/lambdas/cognito-auth/pre-sign-up.mjs), keyed by the account's email,
// then send them to Google. If Google comes back with that same verified email,
// the trigger links the Google login to this account. The note names the
// account, works once and runs out after 10 minutes.

export const LINK_NOTE_TTL_MS = 10 * 60_000

/** The same key the trigger reads (its `linkKey`). */
export const linkNoteKey = (email: string) =>
  `auth/google-links/${createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}.json`

export async function leaveLinkNote(email: string, userId: string, now = Date.now()): Promise<void> {
  await putJson(linkNoteKey(email), { userId, expiresAt: now + LINK_NOTE_TTL_MS })
}
