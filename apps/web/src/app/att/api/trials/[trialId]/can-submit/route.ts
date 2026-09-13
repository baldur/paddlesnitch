import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getJson } from '@/lib/storage'
import { canViewTrial, canSubmitToTrial } from '@/lib/permissions'
import { getGroup, getUserGroupIds } from '@/lib/groups'
import type { TrialMetadata } from '@/lib/types'

type Params = { params: Promise<{ trialId: string }> }

// GET /att/api/trials/[trialId]/can-submit
// Tells the upload page whether the signed-in viewer may submit, and if not,
// WHY — so it can render a "join {group} to submit" / "invite-only" CTA instead
// of a form that would 404 on POST. Returns 404 when the viewer can't even view
// the trial (no existence leak), matching the upload route's own gate.
//
//   { canSubmit: true }
//   { canSubmit: false, reason: 'members', group?: { id, name } }   // not a member
//   { canSubmit: false, reason: 'invitational' }                    // not invited
export async function GET(req: NextRequest, { params }: Params) {
  const { trialId } = await params
  const viewer = await getAuthUser()
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const trial = await getJson<TrialMetadata>(`trials/${trialId}/metadata.json`)
  if (!trial) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const viewerGroupIds = new Set(await getUserGroupIds(viewer.id))
  if (!canViewTrial(trial, viewer, viewerGroupIds)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // A valid shareable submit token lets a signed-in viewer submit even on a
  // members/invitational trial (they still had to be able to view it).
  const invite = new URL(req.url).searchParams.get('invite')
  const tokenOk = !!trial.submitToken && invite === trial.submitToken

  if (tokenOk || canSubmitToTrial(trial, viewer, viewerGroupIds)) {
    return NextResponse.json({ canSubmit: true })
  }

  // Can view but can't submit — surface the actionable reason.
  const participation = (trial.participation as string) === 'open' ? 'public' : trial.participation
  if (participation === 'members' && trial.groupId) {
    const group = await getGroup(trial.groupId)
    return NextResponse.json({
      canSubmit: false,
      reason: 'members',
      ...(group ? { group: { id: group.id, name: group.name } } : {}),
    })
  }
  return NextResponse.json({ canSubmit: false, reason: 'invitational' })
}
