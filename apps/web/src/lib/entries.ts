// Per-entry access for the entry permalink /att/entries/{entryId} (#105).
//
// Entries live at trials/{trialId}/entries/{userId}/{entryId}/result.json. The
// permalink carries only the entryId (so visibility can be managed per entry
// later), so we resolve it by locating that one result.json. The dataset is
// small; a listKeys + find is fine. If it ever grows, add an
// entry-index/{entryId}.json written at upload time and look that up first.

import { getJson, putJson, listKeys } from './storage'
import type { ProcessedResult, BoatClass, CrewMember, EntryConditions } from './types'

export type StoredEntry = {
  entryId: string
  userId: string
  displayName: string
  submittedAt: string
  filename: string
  raceDate: string
  boatClass: BoatClass
  crew: CrewMember[]
  result: ProcessedResult
  conditions?: EntryConditions
  // Paddler's private note about this entry (#105). Only the owner can read or
  // write it — never included in payloads sent to other viewers.
  note?: string
}

export type ResolvedEntry = {
  trialId: string
  key: string           // storage key of the result.json (for writes)
  entry: StoredEntry
}

export async function resolveEntry(entryId: string): Promise<ResolvedEntry | null> {
  // Guard against path tricks — entryIds are nanoids.
  if (!/^[\w-]+$/.test(entryId)) return null
  const keys = await listKeys('trials/')
  const key = keys.find(k => k.endsWith(`/${entryId}/result.json`) && k.includes('/entries/'))
  if (!key) return null
  const entry = await getJson<StoredEntry>(key)
  if (!entry) return null
  const trialId = key.split('/')[1] // trials/{trialId}/entries/...
  return { trialId, key, entry }
}

// Persists the note onto the entry's result.json, preserving everything else.
export async function setEntryNote(resolved: ResolvedEntry, note: string): Promise<StoredEntry> {
  const next: StoredEntry = { ...resolved.entry }
  if (note.trim()) next.note = note
  else delete next.note
  await putJson(resolved.key, next)
  return next
}
