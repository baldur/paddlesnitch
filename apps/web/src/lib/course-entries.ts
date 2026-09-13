// Helpers for the geometry-lock rule on courses with entries.
//
// A course's geometry (lines, gates, type, distance) MUST NOT change once
// anyone has raced on it — historical results would otherwise become
// uninterpretable. Editing geometry on a course-with-entries is rejected (409);
// name/visibility/sport stay editable. Clone-and-recompute is tracked in #72.

import { listKeys, getJson } from './storage'
import type { TrialMetadata } from './types'

// True iff at least one trial on this course has at least one entry.
// O(trials) on listKeys plus a single listKeys per trial — fine at our
// scale, can be cached later if it becomes a hotspot.
export async function courseHasEntries(courseId: string): Promise<boolean> {
  const trialKeys = await listKeys('trials/')
  const trialMetaKeys = trialKeys.filter(
    k => k.endsWith('metadata.json') && !k.includes('/entries/')
  )
  for (const key of trialMetaKeys) {
    const trial = await getJson<TrialMetadata>(key)
    if (!trial || trial.courseId !== courseId) continue
    const entryKeys = await listKeys(`trials/${trial.id}/entries/`)
    // result.json is the canonical "this trial has an entry" marker;
    // raw trace files may or may not exist depending on source.
    if (entryKeys.some(k => k.endsWith('result.json'))) return true
  }
  return false
}

// Fields that, if changed on a course with entries, lock the edit (409).
// Anything else (name, visibility, sport) is fine to mutate in place.
//
// `gates` is left out of the array form deliberately — we compare it
// structurally in `geometryChanged` below since it's an array.
export const GEOMETRY_FIELDS = [
  'type',
  'startLine',
  'finishLine',
  'distanceMetres',
  'minValidSeconds',
  'gateDirection',
] as const

// Returns true if the patch would change any geometry field. Comparison
// is JSON-equality for the line/gate arrays — good enough since we
// never mutate the inner arrays in place.
export function geometryChanged(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
): boolean {
  for (const field of GEOMETRY_FIELDS) {
    if (!(field in patch)) continue
    if (JSON.stringify(patch[field]) !== JSON.stringify(before[field])) {
      return true
    }
  }
  if ('gates' in patch) {
    if (JSON.stringify(patch.gates) !== JSON.stringify(before.gates)) {
      return true
    }
  }
  return false
}
