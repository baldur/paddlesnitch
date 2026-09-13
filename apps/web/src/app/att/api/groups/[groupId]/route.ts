import { NextRequest, NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { getAuthUser } from '@/lib/auth'
import {
  getGroup,
  putGroup,
  deleteGroup,
  removeUserFromGroupIndex,
  groupRoleOf,
  joinPolicyOf,
  findPendingJoinRequest,
} from '@/lib/groups'
import { canManageGroup, canDeleteGroup } from '@/lib/permissions'
import type { GroupMetadata, JoinPolicy } from '@/lib/types'

type Params = { params: Promise<{ groupId: string }> }

function isJoinPolicy(v: unknown): v is JoinPolicy {
  return v === 'invite_only' || v === 'request' || v === 'open'
}

// GET /att/api/groups/[groupId]
// Members (owner/admin/member) get the full payload + viewerStatus. Everyone
// else gets a LIMITED projection (name, description, joinPolicy, member count)
// plus their viewerStatus ('none' | 'pending') — enough to render a join CTA
// without exposing the member list. Groups aren't enumerable (the catalogue
// only lists your own), so this is "discoverable by link", not browsable.
export async function GET(_: NextRequest, { params }: Params) {
  const { groupId } = await params
  const group = await getGroup(groupId)
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const viewer = await getAuthUser()
  const role = viewer ? groupRoleOf(group, viewer.id) : null
  if (role) {
    return NextResponse.json({ ...group, viewerStatus: role })
  }

  const pending = viewer ? await findPendingJoinRequest(groupId, viewer.id) : null
  return NextResponse.json({
    id: group.id,
    name: group.name,
    description: group.description,
    joinPolicy: joinPolicyOf(group),
    memberCount: 1 + group.adminUserIds.length + group.memberUserIds.length,
    viewerStatus: pending ? 'pending' : 'none',
    limited: true,
  })
}

// PATCH /att/api/groups/[groupId]
// Owner/admin: name, description, joinPolicy, and the shareable join link
// (`regenerateJoinLink: true` mints a new token; `joinLinkToken: null` revokes).
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { groupId } = await params
  const group = await getGroup(groupId)
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canManageGroup(group, user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const next: GroupMetadata = { ...group }
  if (typeof body.name === 'string' && body.name.trim()) next.name = body.name.trim()
  if (typeof body.description === 'string') next.description = body.description
  if (isJoinPolicy(body.joinPolicy)) next.joinPolicy = body.joinPolicy
  if (body.regenerateJoinLink === true) next.joinLinkToken = nanoid()
  if (body.joinLinkToken === null) delete next.joinLinkToken
  await putGroup(next)
  return NextResponse.json(next)
}

// DELETE /att/api/groups/[groupId]
// Owner only. Tears down the metadata + invitations + join requests, plus every
// member's reverse-index entry so they don't show a ghost group in their list.
export async function DELETE(_: NextRequest, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { groupId } = await params
  const group = await getGroup(groupId)
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canDeleteGroup(group, user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const everyone = [group.ownerId, ...group.adminUserIds, ...group.memberUserIds]
  await deleteGroup(groupId)
  await Promise.all(everyone.map(uid => removeUserFromGroupIndex(uid, groupId)))
  return NextResponse.json({ ok: true })
}
