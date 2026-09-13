import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import {
  getGroup,
  putGroup,
  groupRoleOf,
  joinPolicyOf,
  withMember,
  addUserToGroupIndex,
  findPendingJoinRequest,
  listJoinRequests,
  putJoinRequest,
  newJoinRequest,
} from '@/lib/groups'
import { canManageGroupMembers } from '@/lib/permissions'
import { findUserBySub } from '@/lib/cognito'
import type { JoinRequest } from '@/lib/types'

type Params = { params: Promise<{ groupId: string }> }

// POST /att/api/groups/[groupId]/join-requests   { token? }
// Self-serve join (phase 4). Behaviour depends on the group's joinPolicy:
//   - a matching joinLinkToken OR policy 'open' → join instantly
//   - policy 'request' → create a pending request for an admin to approve
//   - policy 'invite_only' → 403 (no self-serve)
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { groupId } = await params
  const group = await getGroup(groupId)
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (groupRoleOf(group, user.id)) {
    return NextResponse.json({ status: 'member' }) // already in — nothing to do
  }

  const body = await req.json().catch(() => ({}))
  const token = typeof body.token === 'string' ? body.token : undefined
  const policy = joinPolicyOf(group)
  const viaLink = !!group.joinLinkToken && token === group.joinLinkToken

  if (policy === 'open' || viaLink) {
    const updated = withMember(group, user.id)
    await putGroup(updated)
    await addUserToGroupIndex(user.id, groupId)
    return NextResponse.json({ status: 'accepted' })
  }

  if (policy === 'invite_only') {
    return NextResponse.json(
      { error: 'This group is invite-only — ask an admin for an invitation.', code: 'invite_only' },
      { status: 403 },
    )
  }

  // policy 'request' → pending, deduped (one pending request per user).
  const existing = await findPendingJoinRequest(groupId, user.id)
  if (existing) return NextResponse.json({ status: 'pending', request: existing })
  const request = newJoinRequest(groupId, user.id)
  await putJoinRequest(request)
  return NextResponse.json({ status: 'pending', request }, { status: 201 })
}

// GET /att/api/groups/[groupId]/join-requests
// Admin/owner only — the pending requests, with requester names resolved.
export async function GET(_: NextRequest, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { groupId } = await params
  const group = await getGroup(groupId)
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canManageGroupMembers(group, user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const pending = (await listJoinRequests(groupId)).filter((r: JoinRequest) => r.status === 'pending')
  const resolved = await Promise.all(
    pending.map(async r => {
      const u = await findUserBySub(r.userId)
      return { ...r, displayName: u?.displayName ?? r.userId, email: u?.email ?? '' }
    }),
  )
  return NextResponse.json({ requests: resolved })
}
