// Fetch one Strava activity and, if it's a water sport, analyse + save it as a
// paddle. Shared by the auto-import webhook (and available to any future
// server-side import path). The caller decides WHETHER to import (auth, the
// user's auto-import preference); this just does it, reusing the same pipeline
// as a manual import — including duplicate detection.
import { getValidStravaTokens } from '@paddlesnitch/core/strava-storage'
import { getActivitySport, getActivityStreams, streamsToTrack, isWaterSport } from '@paddlesnitch/core/strava'
import { analyseAndSave } from './pipeline'

export type ImportOutcome =
  | { status: 'imported' | 'duplicate'; sessionId: string }
  | { status: 'skipped'; reason: 'no_tokens' | 'not_water_sport' | 'no_track' }

export async function importStravaActivity(userId: string, activityId: number): Promise<ImportOutcome> {
  const tokens = await getValidStravaTokens(userId)
  if (!tokens) return { status: 'skipped', reason: 'no_tokens' }

  const sport = await getActivitySport(tokens.accessToken, activityId)
  if (!isWaterSport(sport)) return { status: 'skipped', reason: 'not_water_sport' }

  const streams = await getActivityStreams(tokens.accessToken, activityId)
  if (!streams) return { status: 'skipped', reason: 'no_track' }
  const track = streamsToTrack(streams.latlng, streams.time, streams.startDate)
  if (track.length < 2) return { status: 'skipped', reason: 'no_track' }

  const { session, duplicate } = await analyseAndSave(
    userId, track,
    { type: 'strava', stravaActivityId: activityId, sport: sport ?? undefined },
  )
  return { status: duplicate ? 'duplicate' : 'imported', sessionId: session.id }
}
