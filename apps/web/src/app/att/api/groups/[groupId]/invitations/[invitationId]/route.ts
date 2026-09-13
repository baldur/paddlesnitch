import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import {
  getGroup,
  getInvitation,
  deleteInvitation,
} from '@/lib/groups'
import { canManageGroup } from '@/lib/permissions'

type Params = { params: Promise<{ groupId: string; invitationId: string }> }

// DELETE /att/api/groups/[groupId]/invitations/[invitationId]
// Owner / admin can rescind any invitation. Idempotent — a 404 on a
// missing invitation is still treated as success so the UI can call this
// without checking first.
export async function DELETE(_: NextRequest, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { groupId, invitationId } = await params
  const group = await getGroup(groupId)
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canManageGroup(group, user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await deleteInvitation(groupId, invitationId)
  return NextResponse.json({ ok: true })
}
