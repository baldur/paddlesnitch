import { getJson, putJson } from '@/lib/storage'

// When an account last showed it owns its email address (#702): the sign-up
// code, the email-code sign-in or a password reset. Accounts made before
// sign-up codes existed (2026-10-26) have none (a code from Account proves it
// too: api/account/email-proof, needed for Connect Google), so their first password reset
// treats the account as possibly someone else's (lib/password-reset.ts).
const key = (userId: string) => `users/${userId}/email-proven.json`

export async function markEmailProven(userId: string, how: 'sign_up_code' | 'email_code' | 'password_reset' | 'account_code'): Promise<void> {
  await putJson(key(userId), { provenAt: new Date().toISOString(), how })
}

export async function isEmailProven(userId: string): Promise<boolean> {
  return (await getJson(key(userId))) !== null
}
