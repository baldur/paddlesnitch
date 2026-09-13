import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import {
  getGroup,
  getInvitation,
  putGroup,
  putInvitation,
  deleteInvitation,
  addUserToGroupIndex,
} from '@/lib/groups'
import type { GroupMetadata } from '@/lib/types'

type Params = { params: Promise<{ groupId: string; invitationId: string }> }

// POST /att/api/groups/[groupId]/invitations/[invitationId]/accept
// Only the invitee may accept. On accept we add them to the group at the
// invited role and delete the invitation. Idempotent if they're already
// a member at the same or higher role.
export async function POST(_: NextRequest, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { groupId, invitationId } = await params
  const invitation = await getInvitation(groupId, invitationId)
  if (!invitation) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (invitation.toUserId !== user.id) {
    // Hide existence — the invite isn't for them.
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const group = await getGroup(groupId)
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const updated: GroupMetadata = { ...group }
  if (invitation.role === 'admin') {
    if (!updated.adminUserIds.includes(user.id)) {
      updated.adminUserIds = [...updated.adminUserIds, user.id]
    }
    // An accepted admin invitation supersedes a prior plain membership.
    updated.memberUserIds = updated.memberUserIds.filter(id => id !== user.id)
  } else {
    // Only promote to member if not already admin / owner.
    const role = group.ownerId === user.id || group.adminUserIds.includes(user.id) ? null : 'member'
    if (role && !updated.memberUserIds.includes(user.id)) {
      updated.memberUserIds = [...updated.memberUserIds, user.id]
    }
  }
  await putGroup(updated)
  await addUserToGroupIndex(user.id, groupId)
  await deleteInvitation(groupId, invitationId)
  return NextResponse.json({ group: updated })
}
