// Storage + acceptance helpers for the Terms of Service.
//
// The current version is held in CURRENT_TOS_VERSION (src/lib/types.ts).
// Users' acceptance history lives at users/{userId}/tos-consent.json as
// a list of { version, acceptedAt }. Helpers below answer:
//
//   - has this user accepted CURRENT_TOS_VERSION?
//   - record an acceptance now
//   - read the raw markdown of a given version (server-side; the page
//     renders it)

import { readFile } from 'fs/promises'
import { join } from 'path'
import { getJson, putJson } from './storage'
import { CURRENT_TOS_VERSION } from './types'
import type { TosConsent } from './types'

const key = (userId: string) => `users/${userId}/tos-consent.json`

export async function getTosConsent(userId: string): Promise<TosConsent | null> {
  return getJson<TosConsent>(key(userId))
}

export async function hasAcceptedCurrent(userId: string): Promise<boolean> {
  const rec = await getTosConsent(userId)
  if (!rec) return false
  return rec.acceptances.some(a => a.version === CURRENT_TOS_VERSION)
}

// Records the acceptance. Idempotent — if the user has already accepted
// this version, we don't append a duplicate, but we also don't error.
export async function recordAcceptance(userId: string, version: string = CURRENT_TOS_VERSION): Promise<TosConsent> {
  const existing = (await getTosConsent(userId)) ?? { acceptances: [] }
  if (existing.acceptances.some(a => a.version === version)) {
    return existing
  }
  const updated: TosConsent = {
    acceptances: [...existing.acceptances, { version, acceptedAt: new Date().toISOString() }],
  }
  await putJson(key(userId), updated)
  return updated
}

// Reads the raw markdown for a given ToS version. Used by the /att/tos
// page and by the API GET endpoint. Returns null if the file is missing
// (a future audit can confirm we never deleted an old version users had
// accepted — see deploy checklist).
export async function readTosDoc(version: string = CURRENT_TOS_VERSION): Promise<string | null> {
  try {
    const path = join(process.cwd(), 'legal', `tos-${version}.md`)
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}
