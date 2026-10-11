// What a Strava webhook event does (docs/features/strava-auto-import.md). Run
// as a job (lib/jobs.ts, #413), not inside Strava's request. Throws on a
// failure worth retrying (the job runner retries with backoff).
import {
  getUserIdByAthleteId, getStravaAutoImport,
  deleteStravaTokens, deleteAthleteIndex, stravaAccessRevoked,
} from '@paddlesnitch/core/strava-storage'
import { importStravaActivity } from '@paddlesnitch/analysis/strava-import'

export type StravaEvent = {
  object_type?: 'activity' | 'athlete'
  aspect_type?: 'create' | 'update' | 'delete'
  object_id?: number
  owner_id?: number
  updates?: Record<string, string>
}

export async function processStravaEvent(ev: StravaEvent): Promise<void> {
  const ownerId = ev.owner_id!

  // Athlete deauthorised the app → treat like Disconnect: drop tokens + index
  // so we hold no credentials and make no further calls for them. (Strava
  // guideline compliance.)
  if (ev.object_type === 'athlete' && ev.updates?.authorized === 'false') {
    const userId = await getUserIdByAthleteId(ownerId)
    // Anyone can POST here and athlete ids are public, so confirm with
    // Strava before disconnecting (security audit 2026-09).
    const revoked = userId ? await stravaAccessRevoked(userId) : false
    if (userId && revoked !== true) {
      console.warn(`[strava webhook] deauthorization for athlete ${ownerId} not confirmed by Strava (${revoked}); ignored`)
      return
    }
    if (userId) {
      await deleteStravaTokens(userId)
      await deleteAthleteIndex(ownerId)
      console.log(`[strava webhook] deauthorized athlete ${ownerId} → disconnected user`)
    }
    return
  }

  // A new activity → auto-import it as a paddle if the owner is a connected
  // user who has auto-import enabled. importStravaActivity filters to water
  // sports and de-dupes, so non-paddles / re-sends are no-ops.
  if (ev.object_type === 'activity' && ev.aspect_type === 'create' && ev.object_id) {
    const userId = await getUserIdByAthleteId(ownerId)
    if (!userId) return                                   // not one of our users
    if (!(await getStravaAutoImport(userId))) return      // opted out
    const outcome = await importStravaActivity(userId, ev.object_id)
    console.log(`[strava webhook] activity ${ev.object_id} for user → ${outcome.status}`)
  }
  // activity update/delete and other events are intentionally ignored (v1).
}
