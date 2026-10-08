// Where trials and courses are, and a user's entries in them. Every page that
// listed trials or courses used to list the whole trials/ (or courses/)
// prefix, which holds every entry of every trial (result, trace, failed
// uploads, leaderboard), and filter it in place, each with its own filter.
// These list the trial and course folders only (S3's delimiter), so the cost
// follows the number of trials, not the number of races ever uploaded.
//
// Ids and keys only: the trial and course types belong to the app.
import { listKeys, listPrefixes, getJson } from './storage'

export const trialMetaKey = (trialId: string) => `trials/${trialId}/metadata.json`
export const courseMetaKey = (courseId: string) => `courses/${courseId}/metadata.json`

/** Every trial's metadata (unparsed type: the app's TrialMetadata). */
export async function listTrialRecords<T>(): Promise<T[]> {
  return readAll<T>((await listPrefixes('trials/')).map(trialMetaKey))
}

/** Every course's metadata (unparsed type: the app's CourseMetadata). */
export async function listCourseRecords<T>(): Promise<T[]> {
  return readAll<T>((await listPrefixes('courses/')).map(courseMetaKey))
}

// The records at these keys, in parallel; a missing one is left out.
async function readAll<T>(keys: string[]): Promise<T[]> {
  const out: T[] = []
  for (const r of await Promise.all(keys.map(k => getJson<T>(k)))) if (r !== null) out.push(r as T)
  return out
}

/** The result.json key of every entry `userId` has submitted, in any trial. */
export async function listUserEntryResultKeys(userId: string): Promise<string[]> {
  const ids = await listPrefixes('trials/')
  const perTrial = await Promise.all(ids.map(id => listKeys(`trials/${id}/entries/${userId}/`)))
  return perTrial.flat().filter(k => k.endsWith('/result.json'))
}

/** The diagnostic.json key of every failed upload `userId` left, in any trial. */
export async function listUserFailedUploadKeys(userId: string): Promise<string[]> {
  const ids = await listPrefixes('trials/')
  const perTrial = await Promise.all(ids.map(id => listKeys(`trials/${id}/failed-uploads/${userId}/`)))
  return perTrial.flat().filter(k => k.endsWith('/diagnostic.json'))
}
