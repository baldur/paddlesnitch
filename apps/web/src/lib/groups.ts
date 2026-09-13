// Storage helpers for groups + group invitations.
//
// S3 layout:
//   groups/{groupId}/metadata.json
//   groups/{groupId}/invitations/{invitationId}.json     (resolved invites)
//   pending-invitations/groups/{emailHash}/{invitationId}.json
//   users/{userId}/groups.json                          (reverse index)
//
// The reverse index is a single { groupIds: string[] } record per user. It
// lets the catalogue + "are you in this group" checks avoid scanning every
// group's member list.
//
// `emailHash` is sha-256 hex of the lowercased email — keeps the path
// directory layout from leaking unverified emails to anyone who can list
// the bucket.

import { createHash } from 'crypto'
import { nanoid } from 'nanoid'
import { getJson, putJson, deleteObject, listKeys } from './storage'
import type { GroupMetadata, GroupInvitation, JoinRequest, JoinPolicy } from './types'

export function groupMetaKey(groupId: string): string {
  return `groups/${groupId}/metadata.json`
}

export function userGroupsKey(userId: string): string {
  return `users/${userId}/groups.json`
}

export function emailHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
}

// ---------------- Group CRUD ----------------

export async function getGroup(groupId: string): Promise<GroupMetadata | null> {
  return getJson<GroupMetadata>(groupMetaKey(groupId))
}

export async function putGroup(group: GroupMetadata): Promise<void> {
  await putJson(groupMetaKey(group.id), group)
}

export async function deleteGroup(groupId: string): Promise<void> {
  // Delete the metadata + every invitation under the group. Members'
  // reverse-index entries are cleaned up by the caller — they need to know
  // which subs to update.
  await deleteObject(groupMetaKey(groupId))
  const subKeys = [
    ...(await listKeys(`groups/${groupId}/invitations/`)),
    ...(await listKeys(`groups/${groupId}/join-requests/`)),
  ]
  await Promise.all(subKeys.map(k => deleteObject(k)))
}

export async function listAllGroups(): Promise<GroupMetadata[]> {
  const keys = await listKeys('groups/')
  const metaKeys = keys.filter(k => k.endsWith('/metadata.json') && !k.includes('/invitations/'))
  const groups = await Promise.all(metaKeys.map(k => getJson<GroupMetadata>(k)))
  return groups.filter((c): c is GroupMetadata => c !== null)
}

// ---------------- Per-user reverse index ----------------

type UserGroups = { groupIds: string[] }

export async function getUserGroupIds(userId: string): Promise<string[]> {
  const rec = await getJson<UserGroups>(userGroupsKey(userId))
  return rec?.groupIds ?? []
}

export async function addUserToGroupIndex(userId: string, groupId: string): Promise<void> {
  const current = await getUserGroupIds(userId)
  if (current.includes(groupId)) return
  await putJson(userGroupsKey(userId), { groupIds: [...current, groupId] })
}

export async function removeUserFromGroupIndex(userId: string, groupId: string): Promise<void> {
  const current = await getUserGroupIds(userId)
  if (!current.includes(groupId)) return
  await putJson(userGroupsKey(userId), { groupIds: current.filter(id => id !== groupId) })
}

// The set of groups `userId` can MANAGE (owner or admin) — the authority that
// gates course/trial creation + management. Walks the per-user reverse index
// (cheap; groups are few) and keeps only the owner/admin ones. Pass the result
// to canManageCourse / canManageTrial at the request boundary.
export async function getUserAdminGroupIds(userId: string): Promise<Set<string>> {
  const ids = await getUserGroupIds(userId)
  const groups = await Promise.all(ids.map(id => getGroup(id)))
  const manageable = new Set<string>()
  for (const group of groups) {
    if (!group) continue
    const role = groupRoleOf(group, userId)
    if (role === 'owner' || role === 'admin') manageable.add(group.id)
  }
  return manageable
}

// Whether `userId` is the owner, an admin, or a member of `group`. Cheap
// because the membership lists are inline on the metadata.
export function groupRoleOf(group: GroupMetadata, userId: string): 'owner' | 'admin' | 'member' | null {
  if (group.ownerId === userId) return 'owner'
  if (group.adminUserIds.includes(userId)) return 'admin'
  if (group.memberUserIds.includes(userId)) return 'member'
  return null
}

// ---------------- Invitations (resolved) ----------------

function inviteKey(groupId: string, invitationId: string): string {
  return `groups/${groupId}/invitations/${invitationId}.json`
}

export async function getInvitation(groupId: string, invitationId: string): Promise<GroupInvitation | null> {
  return getJson<GroupInvitation>(inviteKey(groupId, invitationId))
}

export async function putInvitation(invitation: GroupInvitation): Promise<void> {
  await putJson(inviteKey(invitation.groupId, invitation.id), invitation)
}

export async function deleteInvitation(groupId: string, invitationId: string): Promise<void> {
  await deleteObject(inviteKey(groupId, invitationId))
}

export async function listGroupInvitations(groupId: string): Promise<GroupInvitation[]> {
  const keys = await listKeys(`groups/${groupId}/invitations/`)
  const invites = await Promise.all(keys.map(k => getJson<GroupInvitation>(k)))
  return invites.filter((i): i is GroupInvitation => i !== null)
}

// ---------------- Join policy + membership ----------------

// A group's effective join policy. Missing (pre-phase-4 groups) is treated as
// 'request' — the new default. Self-serve checks go through here so the default
// lives in one place.
export function joinPolicyOf(group: GroupMetadata): JoinPolicy {
  return group.joinPolicy ?? 'request'
}

// Pure: returns `group` with `userId` added as a plain member, unless they're
// already the owner / an admin / a member. Callers persist with putGroup +
// addUserToGroupIndex (mirrors the accept-invite flow).
export function withMember(group: GroupMetadata, userId: string): GroupMetadata {
  if (group.ownerId === userId || group.adminUserIds.includes(userId) || group.memberUserIds.includes(userId)) {
    return group
  }
  return { ...group, memberUserIds: [...group.memberUserIds, userId] }
}

// ---------------- Join requests (self-serve) ----------------

function joinRequestKey(groupId: string, id: string): string {
  return `groups/${groupId}/join-requests/${id}.json`
}

export async function getJoinRequest(groupId: string, id: string): Promise<JoinRequest | null> {
  return getJson<JoinRequest>(joinRequestKey(groupId, id))
}

export async function putJoinRequest(request: JoinRequest): Promise<void> {
  await putJson(joinRequestKey(request.groupId, request.id), request)
}

export async function deleteJoinRequest(groupId: string, id: string): Promise<void> {
  await deleteObject(joinRequestKey(groupId, id))
}

export async function listJoinRequests(groupId: string): Promise<JoinRequest[]> {
  const keys = await listKeys(`groups/${groupId}/join-requests/`)
  const reqs = await Promise.all(keys.map(k => getJson<JoinRequest>(k)))
  return reqs.filter((r): r is JoinRequest => r !== null)
}

// The pending join request for `userId` on `groupId`, if any (a user has at
// most one). Used to surface "you've already requested" and to avoid dupes.
export async function findPendingJoinRequest(groupId: string, userId: string): Promise<JoinRequest | null> {
  const all = await listJoinRequests(groupId)
  return all.find(r => r.userId === userId && r.status === 'pending') ?? null
}

export function newJoinRequest(groupId: string, userId: string): JoinRequest {
  return { id: nanoid(), groupId, userId, requestedAt: new Date().toISOString(), status: 'pending' }
}

// ---------------- Pending email invitations (pre-signup) ----------------

function pendingKey(email: string, invitationId: string): string {
  return `pending-invitations/groups/${emailHash(email)}/${invitationId}.json`
}

export async function putPendingInvitation(invitation: GroupInvitation): Promise<void> {
  if (!invitation.toEmail) throw new Error('putPendingInvitation requires toEmail')
  await putJson(pendingKey(invitation.toEmail, invitation.id), invitation)
}

// Returns every pending invitation queued for this email. Used by the
// signup hook to merge them into the new user's groups.
export async function listPendingInvitationsForEmail(email: string): Promise<GroupInvitation[]> {
  const keys = await listKeys(`pending-invitations/groups/${emailHash(email)}/`)
  const invites = await Promise.all(keys.map(k => getJson<GroupInvitation>(k)))
  return invites.filter((i): i is GroupInvitation => i !== null)
}

export async function deletePendingInvitation(email: string, invitationId: string): Promise<void> {
  await deleteObject(pendingKey(email, invitationId))
}

// ---------------- Builder ----------------

// Constructs a fresh GroupMetadata, generating an id, and seeding the owner
// as the first (sole) admin so they have full management rights without
// being listed twice in the member array.
export function newGroup(input: {
  name: string
  description?: string
  ownerId: string
}): GroupMetadata {
  return {
    id: nanoid(),
    name: input.name,
    description: input.description ?? '',
    ownerId: input.ownerId,
    adminUserIds: [],
    memberUserIds: [],
    createdAt: new Date().toISOString(),
    joinPolicy: 'request',
  }
}

// Constructs an invitation. If `toEmail` is set, it's a pending invite; if
// `toUserId` is set, it's a resolved invite (we already know the account).
export function newInvitation(input: {
  groupId: string
  role: 'admin' | 'member'
  invitedBy: string
  toUserId?: string
  toEmail?: string
}): GroupInvitation {
  const now = new Date()
  const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  return {
    id: nanoid(),
    groupId: input.groupId,
    role: input.role,
    invitedBy: input.invitedBy,
    toUserId: input.toUserId,
    toEmail: input.toEmail,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    status: 'pending',
  }
}
