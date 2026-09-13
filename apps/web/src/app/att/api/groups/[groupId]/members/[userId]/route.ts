import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getGroup, putGroup, removeUserFromGroupIndex } from '@/lib/groups'
import { canManageGroup } from '@/lib/permissions'
import type { GroupMetadata } from '@/lib/types'

type Params = { params: Promise<{ groupId: string; userId: string }> }

// DELETE /att/api/groups/[groupId]/members/[userId]
// Allowed for the owner / any admin (kicking a member or another admin)
// OR for the user themselves (self-leave). The owner cannot be removed
// from their own group without first transferring ownership.
//
// The reverse-index entry is removed too so the kicked user doesn't see
// the group in their list anymore.
export async function DELETE(_: NextRequest, { params }: Params) {
  const viewer = await getAuthUser()
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { groupId, userId } = await params
  const group = await getGroup(groupId)
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isSelf = viewer.id === userId
  if (!isSelf && !canManageGroup(group, viewer)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (userId === group.ownerId) {
    return NextResponse.json(
      { error: 'Cannot remove the group owner. Transfer ownership first.' },
      { status: 400 }
    )
  }

  const updated: GroupMetadata = {
    ...group,
    adminUserIds: group.adminUserIds.filter(id => id !== userId),
    memberUserIds: group.memberUserIds.filter(id => id !== userId),
  }
  await putGroup(updated)
  await removeUserFromGroupIndex(userId, groupId)
  return NextResponse.json({ group: updated })
}
