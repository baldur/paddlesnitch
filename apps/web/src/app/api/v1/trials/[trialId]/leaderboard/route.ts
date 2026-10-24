// GET /api/v1/trials/{id}/leaderboard: a public trial's results, fastest
// first, as the trial page shows them (#511). Names and boats, no user ids.
import { NextRequest } from 'next/server'
import { getJson } from '@/lib/storage'
import { canViewTrial } from '@/lib/permissions'
import type { LeaderboardEntry, TrialMetadata } from '@/lib/types'
import { fail, leaderboardResponse, ok, options } from '@/lib/api-v1'

export const dynamic = 'force-dynamic'
export const OPTIONS = options

export async function GET(req: NextRequest, { params }: { params: Promise<{ trialId: string }> }) {
  const { trialId } = await params
  const trial = /^[A-Za-z0-9_-]{1,64}$/.test(trialId) ? await getJson<TrialMetadata>(`trials/${trialId}/metadata.json`) : null
  if (!trial || !canViewTrial(trial, null)) return fail(404, 'not_found', 'No such public trial.')
  const boat = req.nextUrl.searchParams.get('boat_class')
  const rows = (await getJson<LeaderboardEntry[]>(`trials/${trialId}/leaderboard.json`)) ?? []
  return ok({ trial_id: trial.id, results: leaderboardResponse(boat ? rows.filter(r => r.boatClass === boat) : rows) })
}
