// Centralised access checks. Keep all visibility / ownership logic in one
// file so the permission tests can target a small surface and a future
// auditor sees the whole matrix at a glance.
//
// Permissions matrix lives in docs/features/visibility-groups-tos.md; the
// names and tests in this file should mirror that doc.

import type { CourseMetadata, TrialMetadata, GroupMetadata, AuthUser } from './types'

// When checking group-scoped visibility, callers fetch the viewer's group
// membership once at the request boundary (see `getUserGroupIds` in
// src/lib/groups.ts) and pass it down to every check on that request.
// Undefined behaves like "viewer is in no groups."
type GroupIds = Set<string> | undefined

function inGroup(groupId: string | undefined, groupIds: GroupIds): boolean {
  return !!groupIds && !!groupId && groupIds.has(groupId)
}

// `viewer` is null for unauthenticated requests.
export function canViewCourse(
  course: CourseMetadata,
  viewer: AuthUser | null,
  viewerGroupIds?: GroupIds,
): boolean {
  if (course.visibility === 'public') return true
  if (!viewer) return false
  if (viewer.id === course.adminUserId) return true
  if (course.visibility === 'group') {
    return inGroup(course.visibleToGroupId, viewerGroupIds)
  }
  return false
}

export function canViewTrial(
  trial: TrialMetadata,
  viewer: AuthUser | null,
  viewerGroupIds?: GroupIds,
): boolean {
  if (trial.visibility === 'public') return true
  if (!viewer) return false
  if (viewer.id === trial.adminUserId) return true
  // A private invitational trial would be useless if invitees couldn't see
  // the leaderboard they're racing on. Widening view to invitees on private
  // trials matches the expectation that "you got invited" implies "you can
  // watch it run."
  if (trial.participation === 'invitational' && trial.invitedUserIds.includes(viewer.id)) {
    return true
  }
  if (trial.visibility === 'group') {
    return inGroup(trial.visibleToGroupId, viewerGroupIds)
  }
  return false
}

// Management (edit / delete / open-close / create-trial) belongs to the OWNING
// GROUP's owner + admins — not the original creator. Callers compute the
// viewer's manageable-group set once at the request boundary (owner/admin only,
// see `getUserAdminGroupIds` in src/lib/groups.ts) and pass it down.
//
// Pre-migration fallback: a course/trial with no `groupId` yet (legacy data
// from before phase 2's migration ran) stays manageable by its `adminUserId`,
// so an owner is never locked out in the deploy→migrate window.
type AdminGroupIds = Set<string> | undefined

export function canManageCourse(
  course: CourseMetadata,
  viewer: AuthUser | null,
  adminGroupIds?: AdminGroupIds,
): boolean {
  if (!viewer) return false
  if (course.groupId) return !!adminGroupIds && adminGroupIds.has(course.groupId)
  return viewer.id === course.adminUserId
}

export function canManageTrial(
  trial: TrialMetadata,
  viewer: AuthUser | null,
  adminGroupIds?: AdminGroupIds,
): boolean {
  if (!viewer) return false
  if (trial.groupId) return !!adminGroupIds && adminGroupIds.has(trial.groupId)
  return viewer.id === trial.adminUserId
}

// Only a group's owner + admins may create courses/trials in it. (A trial is
// created on a course; the gate there is `canManageCourse`, since the trial
// inherits the course's group.)
export function canCreateCourseInGroup(group: GroupMetadata, viewer: AuthUser | null): boolean {
  return canManageGroup(group, viewer)
}

// Can `viewer` submit a trace to this trial (phase 3)? You must first be able
// to see it. Then participation decides WHO:
//   - public       → any viewer
//   - invitational → only invitedUserIds
//   - members      → any member of the trial's group, or an invitee
// The organiser (creator) can always submit. Trial open/closed status is
// enforced separately in the upload route — this is purely WHO, not WHEN.
export function canSubmitToTrial(
  trial: TrialMetadata,
  viewer: AuthUser | null,
  viewerGroupIds?: GroupIds,
): boolean {
  if (!viewer) return false
  if (!canViewTrial(trial, viewer, viewerGroupIds)) return false
  if (viewer.id === trial.adminUserId) return true
  // Legacy 'open' (pre-phase-3) behaves like 'public'.
  const participation = (trial.participation as string) === 'open' ? 'public' : trial.participation
  if (participation === 'public') return true
  if (participation === 'invitational') return trial.invitedUserIds.includes(viewer.id)
  // members: a member (owner/admin/member) of the trial's group, or an invitee.
  return inGroup(trial.groupId, viewerGroupIds) || trial.invitedUserIds.includes(viewer.id)
}

// Whether the resource should appear in a public listing for `viewer`.
// Matches canView semantics with the same group context.
export function isListedForViewer(
  resource:
    | (Pick<CourseMetadata, 'visibility' | 'adminUserId'> & { visibleToGroupId?: string })
    | (Pick<TrialMetadata, 'visibility' | 'adminUserId'> & { visibleToGroupId?: string }),
  viewer: AuthUser | null,
  viewerGroupIds?: GroupIds,
): boolean {
  if (resource.visibility === 'public') return true
  if (!viewer) return false
  if (viewer.id === resource.adminUserId) return true
  if (resource.visibility === 'group') {
    return inGroup(resource.visibleToGroupId, viewerGroupIds)
  }
  return false
}

// ---------------- Groups ----------------

// Owner can do everything; admins can manage members + invitations + (in
// phase 5) scope course/trial visibility; members can only see.
export function canManageGroup(group: GroupMetadata, viewer: AuthUser | null): boolean {
  if (!viewer) return false
  return viewer.id === group.ownerId || group.adminUserIds.includes(viewer.id)
}

// Only the owner can transfer ownership or delete the group outright.
export function canDeleteGroup(group: GroupMetadata, viewer: AuthUser | null): boolean {
  return !!viewer && viewer.id === group.ownerId
}

// Any member (incl. admins + owner) can see the group detail. Non-members
// can see the public name/description but not the membership list — that
// gating lives in the API route response shape rather than here.
export function canViewGroup(group: GroupMetadata, viewer: AuthUser | null): boolean {
  if (!viewer) return false
  return (
    viewer.id === group.ownerId ||
    group.adminUserIds.includes(viewer.id) ||
    group.memberUserIds.includes(viewer.id)
  )
}

// Managing membership (approve/decline join requests, kick, invite) is the
// owner/admin authority — same set as canManageGroup, named for the matrix.
export function canManageGroupMembers(group: GroupMetadata, viewer: AuthUser | null): boolean {
  return canManageGroup(group, viewer)
}

// Whether `viewer` may self-serve request to join (phase 4): signed in, not
// already in the group, and the group isn't invite-only. (joinPolicy missing
// is treated as 'request' — the default.)
export function canRequestToJoin(group: GroupMetadata, viewer: AuthUser | null): boolean {
  if (!viewer) return false
  if (
    viewer.id === group.ownerId ||
    group.adminUserIds.includes(viewer.id) ||
    group.memberUserIds.includes(viewer.id)
  ) {
    return false
  }
  return (group.joinPolicy ?? 'request') !== 'invite_only'
}
