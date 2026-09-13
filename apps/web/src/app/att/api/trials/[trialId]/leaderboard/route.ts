import { NextRequest, NextResponse } from 'next/server'
import { getJson } from '@/lib/storage'
import { getAuthUser } from '@/lib/auth'
import { canViewTrial } from '@/lib/permissions'
import { getUserGroupIds } from '@/lib/groups'
import type { LeaderboardEntry, TrialMetadata } from '@/lib/types'

export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ trialId: string }> }
) {
  const { trialId } = await params
  const trial = await getJson<TrialMetadata>(`trials/${trialId}/metadata.json`)
  if (!trial) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const viewer = await getAuthUser()
  const viewerGroupIds = viewer ? new Set(await getUserGroupIds(viewer.id)) : undefined
  if (!canViewTrial(trial, viewer, viewerGroupIds)) {
    // Same not-found camouflage as the trial detail route: don't leak
    // existence of a private trial through its leaderboard endpoint.
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const leaderboard = await getJson<LeaderboardEntry[]>(
    `trials/${trialId}/leaderboard.json`
  )
  return NextResponse.json(leaderboard ?? [])
}
