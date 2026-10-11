// Per-entry access for the entry permalink /att/entries/{entryId} (#105).
//
// Entries live at trials/{trialId}/entries/{userId}/{entryId}/result.json. The
// permalink carries only the entryId (so visibility can be managed per entry
// later), so it is found through a small index, entry-ids/{entryId}.json →
// { trialId, userId }, written on upload (#409). An entry from before the index
// is found the old way (listing every trial) once, and indexed then.

import { getJson, putJson, listKeys, deleteObjects } from './storage'
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

type EntryIndex = { trialId: string; userId: string }
const indexKey = (entryId: string) => `entry-ids/${entryId}.json`
const resultKey = (i: EntryIndex, entryId: string) => `trials/${i.trialId}/entries/${i.userId}/${entryId}/result.json`

/** Records where an entry lives. Called on upload. */
export async function indexEntry(entryId: string, trialId: string, userId: string): Promise<void> {
  await putJson(indexKey(entryId), { trialId, userId } satisfies EntryIndex)
}

/** Drops the index of every entry among these storage keys (erasure). */
export async function unindexEntries(keys: string[]): Promise<void> {
  const ids = keys.map(k => /^trials\/[^/]+\/entries\/[^/]+\/([^/]+)\/result\.json$/.exec(k)?.[1]).filter((x): x is string => !!x)
  await deleteObjects(ids.map(indexKey))
}

export async function resolveEntry(entryId: string): Promise<ResolvedEntry | null> {
  // Guard against path tricks — entryIds are nanoids.
  if (!/^[\w-]+$/.test(entryId)) return null
  const indexed = await getJson<EntryIndex>(indexKey(entryId))
  if (indexed) {
    const key = resultKey(indexed, entryId)
    const entry = await getJson<StoredEntry>(key)
    return entry ? { trialId: indexed.trialId, key, entry } : null
  }
  // From before the index: find it the old way, once.
  const keys = await listKeys('trials/')
  const key = keys.find(k => k.endsWith(`/${entryId}/result.json`) && k.includes('/entries/'))
  if (!key) return null
  const entry = await getJson<StoredEntry>(key)
  if (!entry) return null
  const [, trialId, , userId] = key.split('/') // trials/{trialId}/entries/{userId}/...
  await indexEntry(entryId, trialId, userId)
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
