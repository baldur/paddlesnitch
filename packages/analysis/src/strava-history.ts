// A paddler's older Strava paddles (#415). Strava only tells us about
// activities created after we subscribed, so connecting Strava brings in about
// the last month, and IMPORT OLDER PADDLES (Account) goes further back.
//
// The paddler's open page works through the list one paddle at a time
// (`importStravaActivity` with what the list already says, one Strava request
// each), so there's no background job and the page can show progress. Strava
// allows about 100 requests per 15 minutes across the app; when it says stop,
// the page waits for the next quarter hour and carries on.
import { listActivities, StravaRateLimited } from '@paddlesnitch/core/strava'
import { getValidStravaTokens } from '@paddlesnitch/core/strava-storage'
import { listSessionSummaries } from './analysis-store'

/** How far back connecting Strava reaches by itself. */
export const FIRST_IMPORT_DAYS = 31
/** Pages of 200 activities read at most (Strava's largest page): 2,000 activities. */
const MAX_PAGES = 10

export type HistoryPaddle = { id: number; name: string; sport: string; startDate: string; distanceMetres: number }
export type StravaHistory =
  | { status: 'not_connected' }
  | { status: 'rate_limited' }
  | { status: 'ok'; toImport: HistoryPaddle[]; alreadyIn: number }

/** The paddler's Strava paddles since `sinceDays` ago (null = all), oldest first, and which are already in. */
export async function stravaHistory(userId: string, sinceDays: number | null, now = Date.now()): Promise<StravaHistory> {
  const tokens = await getValidStravaTokens(userId)
  if (!tokens) return { status: 'not_connected' }
  const after = sinceDays == null ? undefined : (now - sinceDays * 86_400_000) / 1000
  const found: HistoryPaddle[] = []
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { activities, hasMore } = await listActivities(tokens.accessToken, page, 200, { after })
      for (const a of activities) found.push({ id: a.id, name: a.name, sport: a.sportType, startDate: a.startDate, distanceMetres: a.distanceMetres })
      if (!hasMore) break
    }
  } catch (e) {
    if (e instanceof StravaRateLimited) return { status: 'rate_limited' }
    throw e
  }
  const have = new Set((await listSessionSummaries(userId))
    .map(s => (s.source as { stravaActivityId?: number }).stravaActivityId).filter((x): x is number => x != null))
  const toImport = found.filter(a => !have.has(a.id)).sort((x, y) => x.startDate.localeCompare(y.startDate))
  return { status: 'ok', toImport, alreadyIn: found.length - toImport.length }
}
