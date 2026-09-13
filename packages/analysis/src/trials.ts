// Bridge into the ATT time-trial data so a paddler can pick one of their own
// existing trial submissions and analyse it here — no re-upload (#159).
//
// Entries are shared storage: att writes them at
// trials/{trialId}/entries/{userId}/{entryId}/ (raw trace + result.json). We
// read the same keys through @paddlesnitch/core/storage. Only the signed-in
// user's OWN entries are ever listed or loaded (userId is in the key), so this
// exposes nothing another paddler couldn't already download themselves.
import { getJson, getObject, listKeys } from '@paddlesnitch/core/storage'
import { streamsToTrack } from '@paddlesnitch/core/strava'
import { parseTrace } from '@paddlesnitch/timing/parse'
import type { TrackPoint } from '@paddlesnitch/timing/types'

// Only the fields we read off the att-owned result.json / metadata.json — we
// deliberately don't import att's types (separate app).
type StoredEntry = {
  entryId: string
  filename: string
  raceDate?: string
  result: { startTimestamp?: string; totalElapsedSeconds?: number }
}
type TrialMeta = { name?: string; courseId?: string; date?: string }
type CourseMeta = { name?: string; distanceMetres?: number }

export type TrialEntrySummary = {
  entryId: string
  trialId: string
  trialName: string
  courseName: string
  paddledAt: string          // ISO — race date or the result's start timestamp
  filename: string
  distanceMetres?: number
  elapsedSeconds?: number
}

// nanoids only — guards the listKeys prefix/suffix matching against path tricks.
const ID = /^[\w-]+$/

// All of a user's time-trial entries, newest paddle first. Small scale → read
// each result.json (like the att entry + analysis-session listings do).
export async function listUserTrialEntries(userId: string): Promise<TrialEntrySummary[]> {
  if (!ID.test(userId)) return []
  const keys = (await listKeys('trials/')).filter(
    k => k.includes(`/entries/${userId}/`) && k.endsWith('/result.json'),
  )
  const trialMetaCache = new Map<string, TrialMeta | null>()
  const courseMetaCache = new Map<string, CourseMeta | null>()

  const summaries = await Promise.all(
    keys.map(async (k): Promise<TrialEntrySummary | null> => {
      const entry = await getJson<StoredEntry>(k)
      if (!entry) return null
      const trialId = k.split('/')[1] // trials/{trialId}/entries/...
      if (!trialMetaCache.has(trialId)) {
        trialMetaCache.set(trialId, await getJson<TrialMeta>(`trials/${trialId}/metadata.json`))
      }
      const trial = trialMetaCache.get(trialId) ?? null
      const courseId = trial?.courseId
      let course: CourseMeta | null = null
      if (courseId) {
        if (!courseMetaCache.has(courseId)) {
          courseMetaCache.set(courseId, await getJson<CourseMeta>(`courses/${courseId}/metadata.json`))
        }
        course = courseMetaCache.get(courseId) ?? null
      }
      const paddledAt = entry.raceDate || entry.result?.startTimestamp || trial?.date || ''
      return {
        entryId: entry.entryId,
        trialId,
        trialName: trial?.name ?? 'Time trial',
        courseName: course?.name ?? 'Course',
        paddledAt,
        filename: entry.filename,
        distanceMetres: course?.distanceMetres,
        elapsedSeconds: entry.result?.totalElapsedSeconds,
      }
    }),
  )
  return summaries
    .filter((s): s is TrialEntrySummary => !!s)
    .sort((a, b) => (b.paddledAt > a.paddledAt ? 1 : -1))
}

// The full parsed track for one of the user's entries, or null if the entry
// (or its raw trace) can't be found. Handles both raw uploads (parseTrace) and
// Strava-import snapshots (trace.json → streamsToTrack).
export async function loadTrialEntryTrack(
  userId: string,
  trialId: string,
  entryId: string,
): Promise<TrackPoint[] | null> {
  if (![userId, trialId, entryId].every(v => ID.test(v))) return null
  const prefix = `trials/${trialId}/entries/${userId}/${entryId}/`
  const traceKey = (await listKeys(prefix)).find(k => k.includes('/trace.'))
  if (!traceKey) return null
  const buf = await getObject(traceKey)
  if (!buf) return null

  if (traceKey.endsWith('.json')) {
    // Strava-import snapshot { latlng, time, startDate }.
    try {
      const snap = JSON.parse(buf.toString()) as {
        latlng?: [number, number][]; time?: number[]; startDate?: string
      }
      if (!snap.latlng || !snap.time || !snap.startDate) return null
      const track = streamsToTrack(snap.latlng, snap.time, snap.startDate)
      return track.length >= 2 ? track : null
    } catch {
      return null
    }
  }

  const filename = traceKey.split('/').pop() ?? 'trace'
  // Copy into a fresh ArrayBuffer (Buffer.buffer may be a shared pool slab).
  const ab = new Uint8Array(buf).buffer
  const parsed = await parseTrace(filename, ab)
  return parsed.ok && parsed.track.length >= 2 ? parsed.track : null
}
