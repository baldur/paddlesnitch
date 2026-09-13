import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getGroup, getJoinRequest, deleteJoinRequest } from '@/lib/groups'
import { canManageGroupMembers } from '@/lib/permissions'

type Params = { params: Promise<{ groupId: string; requestId: string }> }

// POST /att/api/groups/[groupId]/join-requests/[requestId]/decline
// Owner/admin declines: the request is removed. The user can request again
// later (e.g. after talking to an admin). A missing request is a 404.
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
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await deleteJoinRequest(groupId, requestId)
  return NextResponse.json({ ok: true })
}
