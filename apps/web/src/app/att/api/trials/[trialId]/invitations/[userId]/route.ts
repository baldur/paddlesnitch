import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getJson, putJson } from '@/lib/storage'
import { canManageTrial } from '@/lib/permissions'
import { getUserAdminGroupIds } from '@/lib/groups'
import type { TrialMetadata } from '@/lib/types'

type Params = { params: Promise<{ trialId: string; userId: string }> }

// DELETE /att/api/trials/[trialId]/invitations/[userId]
// Removes the user from the trial's invitedUserIds. Owner-only.
// Idempotent — removing a not-present user is a 200, not a 404, so the
// UI can call this without checking first.
export async function DELETE(_: NextRequest, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { trialId, userId } = await params
  const trial = await getJson<TrialMetadata>(`trials/${trialId}/metadata.json`)
  if (!trial) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canManageTrial(trial, user, await getUserAdminGroupIds(user.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const updated: TrialMetadata = {
    ...trial,
    invitedUserIds: (trial.invitedUserIds ?? []).filter(s => s !== userId),
  }
  await putJson(`trials/${trialId}/metadata.json`, updated)
  return NextResponse.json({ ok: true })
}
