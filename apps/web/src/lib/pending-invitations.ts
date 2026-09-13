// Resolves pre-signup group invitations.
//
// When a user signs up, this is called with their fresh sub + email. It
// scans pending-invitations/groups/{emailHash}/ for any invites queued for
// the email, merges the user into each group at the invited role, and
// deletes the pending records. Idempotent: a re-run on the same user is
// a no-op if there's nothing left to merge.

import {
  listPendingInvitationsForEmail,
  deletePendingInvitation,
  getGroup,
  putGroup,
  addUserToGroupIndex,
} from './groups'
import type { GroupMetadata } from './types'

export async function applyPendingInvitations(email: string, userId: string): Promise<void> {
  const pending = await listPendingInvitationsForEmail(email)
  if (pending.length === 0) return

  // Group by groupId so we only read/write each group once even if the
  // user has multiple invitations to it (the most generous role wins).
  const byGroup = new Map<string, typeof pending>()
  for (const inv of pending) {
    const list = byGroup.get(inv.groupId) ?? []
    list.push(inv)
    byGroup.set(inv.groupId, list)
  }

  for (const [groupId, invites] of byGroup) {
    const group = await getGroup(groupId)
    if (!group) {
      // Group was deleted before the invitee signed up. Clean up the
      // orphan pending records and move on.
      await Promise.all(invites.map(i => deletePendingInvitation(email, i.id)))
      continue
    }
    const wantsAdmin = invites.some(i => i.role === 'admin')
    const updated: GroupMetadata = { ...group }
    if (wantsAdmin) {
      if (!updated.adminUserIds.includes(userId)) {
        updated.adminUserIds = [...updated.adminUserIds, userId]
      }
      updated.memberUserIds = updated.memberUserIds.filter(id => id !== userId)
    } else {
      if (!updated.memberUserIds.includes(userId) && updated.ownerId !== userId && !updated.adminUserIds.includes(userId)) {
        updated.memberUserIds = [...updated.memberUserIds, userId]
      }
    }
    await putGroup(updated)
    await addUserToGroupIndex(userId, groupId)
    await Promise.all(invites.map(i => deletePendingInvitation(email, i.id)))
  }
}
