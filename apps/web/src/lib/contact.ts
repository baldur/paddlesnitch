// Per-user contact preferences for Strava-only accounts that don't have
// a real email on file. Stored at users/{userId}/contact.json so they
// survive across sessions (the dismiss-banner cookie is a separate,
// less-durable signal).
//
// `email` is the address the user wants us to send important comms to
// (ToS updates, account changes). It is NOT verified yet — phase 1B
// will add an SES round-trip + token confirmation. For now we just
// store what they typed.

import { getJson, putJson, deleteObject } from './storage'

export type UserContact = {
  email?: string
  addedAt?: string  // ISO; set when an email is first added
}

const key = (userId: string) => `users/${userId}/contact.json`

export async function getUserContact(userId: string): Promise<UserContact | null> {
  return getJson<UserContact>(key(userId))
}

export async function putUserContactEmail(userId: string, email: string): Promise<UserContact> {
  const existing = (await getUserContact(userId)) ?? {}
  const next: UserContact = {
    ...existing,
    email: email.trim().toLowerCase(),
    addedAt: existing.addedAt ?? new Date().toISOString(),
  }
  await putJson(key(userId), next)
  return next
}

export async function clearUserContact(userId: string): Promise<void> {
  await deleteObject(key(userId))
}
