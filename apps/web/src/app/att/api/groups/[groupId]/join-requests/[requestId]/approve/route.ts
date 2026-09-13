import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import {
  getGroup,
  putGroup,
  getJoinRequest,
  deleteJoinRequest,
  withMember,
  addUserToGroupIndex,
} from '@/lib/groups'
import { canManageGroupMembers } from '@/lib/permissions'

type Params = { params: Promise<{ groupId: string; requestId: string }> }

// POST /att/api/groups/[groupId]/join-requests/[requestId]/approve
// Owner/admin approves: the requester becomes a member and the request record
// is cleared (membership itself is the record). Idempotent enough — a missing
// request is a 404.
export async function POST(_: NextRequest, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { groupId, requestId } = await params
  const group = await getGroup(groupId)
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canManageGroupMembers(group, user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const request = await getJoinRequest(groupId, requestId)
  if (!request || request.status !== 'pending') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const updated = withMember(group, request.userId)
  await putGroup(updated)
  await addUserToGroupIndex(request.userId, groupId)
  await deleteJoinRequest(groupId, requestId)
  return NextResponse.json({ group: updated })
}
