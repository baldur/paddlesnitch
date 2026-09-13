import { NextRequest, NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { getAuthUser } from '@/lib/auth'
import { getJson, putJson } from '@/lib/storage'
import { canViewTrial, canManageTrial } from '@/lib/permissions'
import { getUserGroupIds, getUserAdminGroupIds } from '@/lib/groups'
import type { TrialMetadata, CourseMetadata, Visibility, Participation } from '@/lib/types'

type Params = { params: Promise<{ trialId: string }> }

function isVisibility(v: unknown): v is Visibility {
  return v === 'public' || v === 'private' || v === 'group'
}

function isParticipation(v: unknown): v is Participation {
  return v === 'members' || v === 'invitational' || v === 'public'
}

export async function GET(_: NextRequest, { params }: Params) {
  const { trialId } = await params
  const trial = await getJson<TrialMetadata>(`trials/${trialId}/metadata.json`)
  if (!trial) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const viewer = await getAuthUser()
  const viewerGroupIds = viewer ? new Set(await getUserGroupIds(viewer.id)) : undefined
  if (!canViewTrial(trial, viewer, viewerGroupIds)) {
    // Hide existence of private trials from non-owners.
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json(trial)
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { trialId } = await params
  const trial = await getJson<TrialMetadata>(`trials/${trialId}/metadata.json`)
  if (!trial) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Management belongs to the owning group's owner/admins (phase 2).
  const adminGroupIds = await getUserAdminGroupIds(user.id)
  if (!canManageTrial(trial, user, adminGroupIds)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // A trial's visibility cannot exceed its parent course's. Private parent
  // → private trial; group parent → trial inherits the group; otherwise
  // the trial gets whatever the patch asked for (subject to group-scope
  // permission, see below).
  const course = await getJson<CourseMetadata>(`courses/${trial.courseId}/metadata.json`)

  const body = await req.json()
  const next: TrialMetadata = { ...trial }
  if (typeof body.name === 'string') next.name = body.name
  if (typeof body.date === 'string') next.date = body.date
  if (body.status === 'open' || body.status === 'closed') next.status = body.status
  if (isVisibility(body.visibility)) {
    // Phase 4 — clamp to the parent course's scope. A trial's visibility
    // can never be wider than its course; private course → private trial;
    // group course → trial inherits the group; otherwise the trial gets
    // whatever was asked for (still subject to group-scope permission).
    let requested: Visibility = body.visibility
    // The trial's group is fixed (it inherited the course's group); 'group'
    // visibility always scopes to that owning group — never an arbitrary one.
    let requestedGroupId = next.groupId ?? course?.groupId ?? course?.visibleToGroupId

    if (course?.visibility === 'private') {
      requested = 'private'
      requestedGroupId = undefined
    } else if (course?.visibility === 'group') {
      requested = 'group'
      requestedGroupId = course.visibleToGroupId
    } else if (requested === 'group' && !requestedGroupId) {
      // Group-scoped trial but no owning group to scope to (legacy) → private.
      requested = 'private'
    }

    // Phase 5 — make-public acknowledgement: a flip TO public (after
    // clamping) requires the owner to explicitly tick the
    // "I understand performance times will become public" box. Group /
    // private widening doesn't trigger this — only the public flip does.
    // The check uses the RESOLVED `requested` value so a request for
    // public that gets clamped to private (because the course is
    // private) doesn't force an unnecessary ack.
    const flippingToPublic = trial.visibility !== 'public' && requested === 'public'
    if (flippingToPublic && body.acknowledged !== true) {
      return NextResponse.json(
        {
          error: 'Making a trial public requires an explicit acknowledgement that participants’ performance times will become visible to anyone.',
          code: 'make_public_ack_required',
        },
        { status: 422 }
      )
    }

    next.visibility = requested
    if (requested === 'group' && requestedGroupId) {
      next.visibleToGroupId = requestedGroupId
    } else {
      delete next.visibleToGroupId
    }
  }
  if (isParticipation(body.participation)) {
    // Flipping from invitational to open keeps the invitee list intact —
    // it's just ignored. Flipping back doesn't surprise the owner.
    next.participation = body.participation
  }
  // Shareable submit link: mint a fresh token or revoke it.
  if (body.regenerateSubmitToken === true) next.submitToken = nanoid()
  if (body.submitToken === null) delete next.submitToken
  await putJson(`trials/${trialId}/metadata.json`, next)
  return NextResponse.json(next)
}
