// Fetch one Strava activity and, if it's a water sport, analyse + save it as a
// paddle. Shared by the auto-import webhook (and available to any future
// server-side import path). The caller decides WHETHER to import (auth, the
// user's auto-import preference); this just does it, reusing the same pipeline
// as a manual import — including duplicate detection.
import { getValidStravaTokens } from '@paddlesnitch/core/strava-storage'
import { getActivitySport, getActivityStreams, streamsToTrack, isWaterSport, StravaRateLimited } from '@paddlesnitch/core/strava'
import { analyseAndSave } from './pipeline'
import { logAction, type Client } from '@paddlesnitch/core/observe'

export type ImportOutcome =
  | { status: 'imported' | 'duplicate'; sessionId: string }
  | { status: 'skipped'; reason: 'no_tokens' | 'not_water_sport' | 'no_track' | 'rate_limited' }

/**
 * `known`: the activity's sport and start, from the activity list (importing a
 * paddler's history), so it costs one Strava request instead of three. Only the
 * owner's own activity is ever fetched (their token), so a wrong hint can at
 * worst import one of their own non-paddling activities.
 */
export async function importStravaActivity(
  userId: string, activityId: number, known?: { sport: string; startDate: string }, client?: Client,
): Promise<ImportOutcome> {
  // One `strava_import` action line per activity. A skip (not a paddle, no
  // track, Strava's rate limit, no connection) is expected, not a failure.
  try {
    const outcome = await importOnce(userId, activityId, known)
    logAction('strava_import', outcome.status === 'skipped' ? 'rejected' : 'ok', {
      client, reason: outcome.status === 'skipped' ? outcome.reason : outcome.status,
    })
    return outcome
  } catch (e) {
    logAction('strava_import', 'fail', { client, reason: 'threw' })
    throw e
  }
}

async function importOnce(userId: string, activityId: number, known?: { sport: string; startDate: string }): Promise<ImportOutcome> {
  const tokens = await getValidStravaTokens(userId)
  if (!tokens) return { status: 'skipped', reason: 'no_tokens' }

  const sport = known ? known.sport : await getActivitySport(tokens.accessToken, activityId)
  if (!isWaterSport(sport)) return { status: 'skipped', reason: 'not_water_sport' }

  let streams: Awaited<ReturnType<typeof getActivityStreams>>
  try {
    streams = await getActivityStreams(tokens.accessToken, activityId, { startDate: known?.startDate, throwOnRateLimit: !!known })
  } catch (e) {
    if (e instanceof StravaRateLimited) return { status: 'skipped', reason: 'rate_limited' }
    throw e
  }
  if (!streams) return { status: 'skipped', reason: 'no_track' }
  const track = streamsToTrack(streams.latlng, streams.time, streams.startDate)
  if (track.length < 2) return { status: 'skipped', reason: 'no_track' }

  const { session, duplicate } = await analyseAndSave(
    userId, track,
    { type: 'strava', stravaActivityId: activityId, sport: sport ?? undefined },
  )
  return { status: duplicate ? 'duplicate' : 'imported', sessionId: session.id }
}
