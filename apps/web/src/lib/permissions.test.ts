import { describe, it, expect } from 'vitest'
import {
  canViewCourse,
  canViewTrial,
  canManageCourse,
  canManageTrial,
  canCreateCourseInGroup,
  canSubmitToTrial,
  canManageGroup,
  canManageGroupMembers,
  canRequestToJoin,
  canDeleteGroup,
  canViewGroup,
  isListedForViewer,
} from './permissions'
import type { CourseMetadata, TrialMetadata, GroupMetadata, AuthUser, Participation } from './types'

// Permission matrix lives in docs/features/visibility-groups-tos.md. Story
// titles below are deliberate — they read as the matrix rows. If you change
// a check, the failing test name should already tell the story.

const owner: AuthUser = { id: 'alice-1', email: 'alice@example.com', displayName: 'Alice' }
const other: AuthUser = { id: 'bob-1', email: 'bob@example.com', displayName: 'Bob' }

function makeCourse(visibility: 'public' | 'private'): CourseMetadata {
  return {
    id: 'c1',
    name: 'C1',
    sport: 'kayak',
    type: 'point_to_point',
    startLine: [[0, 0], [0, 0.001]],
    finishLine: [[0.001, 0], [0.001, 0.001]],
    distanceMetres: 100,
    adminUserId: owner.id,
    visibility,
    createdAt: '2026-01-01T00:00:00Z',
  }
}

function makeTrial(
  visibility: 'public' | 'private' | 'group',
  participation: Participation = 'public',
  invitedUserIds: string[] = [],
  visibleToGroupId?: string,
  groupId?: string,
): TrialMetadata {
  return {
    id: 't1',
    courseId: 'c1',
    name: 'T1',
    date: '2026-01-01',
    status: 'open',
    groupId,
    adminUserId: owner.id,
    visibility,
    visibleToGroupId,
    participation,
    invitedUserIds,
    createdAt: '2026-01-01T00:00:00Z',
  }
}

function makeCourseGroup(visibleToGroupId: string): CourseMetadata {
  return {
    id: 'c-group',
    name: 'Group-only',
    sport: 'kayak',
    type: 'point_to_point',
    startLine: [[0, 0], [0, 0.001]],
    finishLine: [[0.001, 0], [0.001, 0.001]],
    distanceMetres: 100,
    adminUserId: owner.id,
    visibility: 'group',
    visibleToGroupId,
    createdAt: '2026-01-01T00:00:00Z',
  }
}

function makeGroup(): GroupMetadata {
  return {
    id: 'group-1',
    name: 'Group 1',
    description: '',
    ownerId: owner.id,
    adminUserIds: ['admin-1'],
    memberUserIds: ['member-1'],
    createdAt: '2026-01-01T00:00:00Z',
  }
}

describe('viewing a public course', () => {
  it('an unauthenticated visitor can see it', () => {
    expect(canViewCourse(makeCourse('public'), null)).toBe(true)
  })
  it('the owner can see it', () => {
    expect(canViewCourse(makeCourse('public'), owner)).toBe(true)
  })
  it('any other signed-in user can see it', () => {
    expect(canViewCourse(makeCourse('public'), other)).toBe(true)
  })
})

describe('viewing a private course', () => {
  it('an unauthenticated visitor cannot see it', () => {
    expect(canViewCourse(makeCourse('private'), null)).toBe(false)
  })
  it('the owner can see it', () => {
    expect(canViewCourse(makeCourse('private'), owner)).toBe(true)
  })
  it('any other signed-in user cannot see it', () => {
    expect(canViewCourse(makeCourse('private'), other)).toBe(false)
  })
})

describe('viewing a public trial', () => {
  it('an unauthenticated visitor can see the leaderboard', () => {
    expect(canViewTrial(makeTrial('public'), null)).toBe(true)
  })
  it('the trial owner can see it', () => {
    expect(canViewTrial(makeTrial('public'), owner)).toBe(true)
  })
  it('any other signed-in user can see it', () => {
    expect(canViewTrial(makeTrial('public'), other)).toBe(true)
  })
})

describe('viewing a private trial', () => {
  it('an unauthenticated visitor cannot see it', () => {
    expect(canViewTrial(makeTrial('private'), null)).toBe(false)
  })
  it('the trial owner can see it', () => {
    expect(canViewTrial(makeTrial('private'), owner)).toBe(true)
  })
  it('a signed-in non-owner cannot see it', () => {
    expect(canViewTrial(makeTrial('private'), other)).toBe(false)
  })
})

// Legacy (pre-migration) management: a course/trial with no groupId yet stays
// manageable by its original adminUserId, so an owner isn't locked out in the
// deploy→migrate window.
describe('managing a legacy course with no group (edit / delete)', () => {
  it('the owner can manage a public course', () => {
    expect(canManageCourse(makeCourse('public'), owner)).toBe(true)
  })
  it('the owner can manage a private course', () => {
    expect(canManageCourse(makeCourse('private'), owner)).toBe(true)
  })
  it('a non-owner cannot manage a public course', () => {
    expect(canManageCourse(makeCourse('public'), other)).toBe(false)
  })
  it('a non-owner cannot manage a private course', () => {
    expect(canManageCourse(makeCourse('private'), other)).toBe(false)
  })
  it('an unauthenticated visitor cannot manage any course', () => {
    expect(canManageCourse(makeCourse('public'), null)).toBe(false)
    expect(canManageCourse(makeCourse('private'), null)).toBe(false)
  })
})

// Phase 2: a course/trial WITH a groupId is managed by that group's admins —
// NOT the original creator unless they're also a group admin.
describe('managing a group-owned course (phase 2)', () => {
  const groupCourse = (): CourseMetadata => ({ ...makeCourse('public'), groupId: 'g1' })
  it('an admin of the owning group can manage it', () => {
    expect(canManageCourse(groupCourse(), other, new Set(['g1']))).toBe(true)
  })
  it('a user who does not admin the owning group cannot — even the original creator', () => {
    // owner is the adminUserId but is NOT in the group-admin set → no longer manages.
    expect(canManageCourse(groupCourse(), owner, new Set())).toBe(false)
    expect(canManageCourse(groupCourse(), owner, undefined)).toBe(false)
  })
  it('an admin of a DIFFERENT group cannot manage it', () => {
    expect(canManageCourse(groupCourse(), other, new Set(['g2']))).toBe(false)
  })
})

describe('managing a group-owned trial (phase 2)', () => {
  const groupTrial = (): TrialMetadata => ({ ...makeTrial('public'), groupId: 'g1' })
  it('an admin of the owning group can manage it', () => {
    expect(canManageTrial(groupTrial(), other, new Set(['g1']))).toBe(true)
  })
  it('a non-admin of the owning group cannot', () => {
    expect(canManageTrial(groupTrial(), other, new Set(['g2']))).toBe(false)
    expect(canManageTrial(groupTrial(), owner, new Set())).toBe(false)
  })
})

describe('creating a course in a group (phase 2)', () => {
  const group: GroupMetadata = {
    id: 'g1', name: 'G', description: '', ownerId: owner.id,
    adminUserIds: ['admin-1'], memberUserIds: ['member-1'], createdAt: '2026-01-01T00:00:00Z',
  }
  const admin: AuthUser = { id: 'admin-1', email: 'a@x', displayName: 'A' }
  const member: AuthUser = { id: 'member-1', email: 'm@x', displayName: 'M' }
  it('the group owner can create', () => {
    expect(canCreateCourseInGroup(group, owner)).toBe(true)
  })
  it('a group admin can create', () => {
    expect(canCreateCourseInGroup(group, admin)).toBe(true)
  })
  it('a plain member cannot create', () => {
    expect(canCreateCourseInGroup(group, member)).toBe(false)
  })
  it('a stranger cannot create', () => {
    expect(canCreateCourseInGroup(group, other)).toBe(false)
  })
})

describe('managing a trial', () => {
  it('the owner can manage a public trial', () => {
    expect(canManageTrial(makeTrial('public'), owner)).toBe(true)
  })
  it('the owner can manage a private trial', () => {
    expect(canManageTrial(makeTrial('private'), owner)).toBe(true)
  })
  it('a non-owner cannot manage any trial', () => {
    expect(canManageTrial(makeTrial('public'), other)).toBe(false)
    expect(canManageTrial(makeTrial('private'), other)).toBe(false)
  })
})

describe('submitting to a public trial', () => {
  it('any signed-in viewer can submit', () => {
    expect(canSubmitToTrial(makeTrial('public', 'public'), other)).toBe(true)
  })
  it('the owner can submit', () => {
    expect(canSubmitToTrial(makeTrial('public', 'public'), owner)).toBe(true)
  })
  it('an unauthenticated visitor cannot submit', () => {
    expect(canSubmitToTrial(makeTrial('public', 'public'), null)).toBe(false)
  })
  it('a non-owner cannot submit to a private public-participation trial they cannot see', () => {
    expect(canSubmitToTrial(makeTrial('private', 'public'), other)).toBe(false)
  })
  it('a legacy "open" participation value is treated as public', () => {
    // Pre-phase-3 stored value; canSubmitToTrial normalises it.
    const legacy = { ...makeTrial('public', 'public'), participation: 'open' as unknown as Participation }
    expect(canSubmitToTrial(legacy, other)).toBe(true)
  })
})

describe('submitting to a members trial (phase 3)', () => {
  const g = 'g1'
  const member: AuthUser = { id: 'm1', email: 'm@x', displayName: 'M' }
  it('a member of the trial\'s group can submit', () => {
    expect(canSubmitToTrial(makeTrial('public', 'members', [], undefined, g), member, new Set([g]))).toBe(true)
  })
  it('a non-member cannot submit', () => {
    expect(canSubmitToTrial(makeTrial('public', 'members', [], undefined, g), member, new Set())).toBe(false)
    expect(canSubmitToTrial(makeTrial('public', 'members', [], undefined, g), other, new Set(['g2']))).toBe(false)
  })
  it('the organiser can submit even without group membership', () => {
    expect(canSubmitToTrial(makeTrial('public', 'members', [], undefined, g), owner, new Set())).toBe(true)
  })
  it('an invitee can submit to a members trial without being in the group', () => {
    const inv: AuthUser = { id: 'inv1', email: 'i@x', displayName: 'I' }
    expect(canSubmitToTrial(makeTrial('public', 'members', [inv.id], undefined, g), inv, new Set())).toBe(true)
  })
})

describe('submitting to an invitational trial', () => {
  it('an invited user can submit', () => {
    expect(canSubmitToTrial(makeTrial('public', 'invitational', [other.id]), other)).toBe(true)
  })
  it('the owner can submit even when not in invitedUserIds', () => {
    expect(canSubmitToTrial(makeTrial('public', 'invitational', []), owner)).toBe(true)
  })
  it('a non-invited signed-in user cannot submit', () => {
    expect(canSubmitToTrial(makeTrial('public', 'invitational', []), other)).toBe(false)
  })
  it('an unauthenticated visitor cannot submit', () => {
    expect(canSubmitToTrial(makeTrial('public', 'invitational', []), null)).toBe(false)
  })
  it('a private invitational trial: the owner and invitees can submit', () => {
    const invited = { id: 'invited-1', email: 'i@x', displayName: 'I' }
    const trial = makeTrial('private', 'invitational', [invited.id])
    expect(canSubmitToTrial(trial, invited)).toBe(true)
    expect(canSubmitToTrial(trial, owner)).toBe(true)
  })

  it('a private invitational trial: a non-invited signed-in user is still blocked', () => {
    const trial = makeTrial('private', 'invitational', [])
    expect(canSubmitToTrial(trial, other)).toBe(false)
  })
})

describe('an invitee of a private invitational trial', () => {
  // canViewTrial was widened in phase 2 so invitees see the leaderboard of
  // private trials they're racing on. This bracket pins that down.
  const invited: AuthUser = { id: 'invited-2', email: 'inv@x', displayName: 'Inv' }

  it('can see the trial detail', () => {
    const trial = makeTrial('private', 'invitational', [invited.id])
    expect(canViewTrial(trial, invited)).toBe(true)
  })

  it('still cannot manage the trial', () => {
    const trial = makeTrial('private', 'invitational', [invited.id])
    expect(canManageTrial(trial, invited)).toBe(false)
  })

  it('a non-invited signed-in user still gets a flat no', () => {
    const trial = makeTrial('private', 'invitational', [])
    expect(canViewTrial(trial, other)).toBe(false)
  })
})

describe('viewing a group-scoped course', () => {
  const groupId = 'group-1'

  it('a viewer who is in the group can see it', () => {
    const course = makeCourseGroup(groupId)
    expect(canViewCourse(course, other, new Set([groupId]))).toBe(true)
  })

  it('a viewer who is NOT in the group gets a flat no', () => {
    const course = makeCourseGroup(groupId)
    expect(canViewCourse(course, other, new Set())).toBe(false)
  })

  it('an unauthenticated visitor cannot see it', () => {
    const course = makeCourseGroup(groupId)
    expect(canViewCourse(course, null)).toBe(false)
  })

  it('the owner can always see their own group-scoped course', () => {
    const course = makeCourseGroup(groupId)
    expect(canViewCourse(course, owner, new Set())).toBe(true)
  })

  it('a stale viewerGroupIds with the wrong group id does NOT widen access', () => {
    const course = makeCourseGroup(groupId)
    expect(canViewCourse(course, other, new Set(['some-other-group']))).toBe(false)
  })
})

describe('viewing a group-scoped trial', () => {
  const groupId = 'group-1'

  it('a viewer who is in the group can see it', () => {
    const trial = makeTrial('group', 'open', [], groupId)
    expect(canViewTrial(trial, other, new Set([groupId]))).toBe(true)
  })

  it('a viewer who is NOT in the group cannot see it', () => {
    const trial = makeTrial('group', 'open', [], groupId)
    expect(canViewTrial(trial, other, new Set())).toBe(false)
  })

  it('a group member can submit to a group-scoped open trial', () => {
    const trial = makeTrial('group', 'open', [], groupId)
    expect(canSubmitToTrial(trial, other, new Set([groupId]))).toBe(true)
  })

  it('a non-member cannot submit to a group-scoped open trial', () => {
    const trial = makeTrial('group', 'open', [], groupId)
    expect(canSubmitToTrial(trial, other, new Set())).toBe(false)
  })

  it('a group member who is NOT in the invitee list cannot submit to a group-scoped invitational trial', () => {
    const trial = makeTrial('group', 'invitational', [], groupId)
    expect(canSubmitToTrial(trial, other, new Set([groupId]))).toBe(false)
  })

  it('a group member who IS in the invitee list can submit to a group-scoped invitational trial', () => {
    const trial = makeTrial('group', 'invitational', [other.id], groupId)
    expect(canSubmitToTrial(trial, other, new Set([groupId]))).toBe(true)
  })
})

describe('managing a group', () => {
  it('the owner can manage', () => {
    expect(canManageGroup(makeGroup(), owner)).toBe(true)
  })
  it('an admin can manage', () => {
    const admin: AuthUser = { id: 'admin-1', email: 'a@x', displayName: 'A' }
    expect(canManageGroup(makeGroup(), admin)).toBe(true)
  })
  it('a plain member cannot manage', () => {
    const member: AuthUser = { id: 'member-1', email: 'm@x', displayName: 'M' }
    expect(canManageGroup(makeGroup(), member)).toBe(false)
  })
  it('a non-member cannot manage', () => {
    expect(canManageGroup(makeGroup(), other)).toBe(false)
  })

  it('only the owner can delete', () => {
    const admin: AuthUser = { id: 'admin-1', email: 'a@x', displayName: 'A' }
    expect(canDeleteGroup(makeGroup(), owner)).toBe(true)
    expect(canDeleteGroup(makeGroup(), admin)).toBe(false)
  })

  it('any member can view a group', () => {
    const member: AuthUser = { id: 'member-1', email: 'm@x', displayName: 'M' }
    expect(canViewGroup(makeGroup(), member)).toBe(true)
  })

  it('a non-member cannot view a group', () => {
    expect(canViewGroup(makeGroup(), other)).toBe(false)
  })

  it('an unauthenticated visitor cannot view a group', () => {
    expect(canViewGroup(makeGroup(), null)).toBe(false)
  })
})

describe('self-serve join permissions (phase 4)', () => {
  const member: AuthUser = { id: 'member-1', email: 'm@x', displayName: 'M' }
  const admin: AuthUser = { id: 'admin-1', email: 'a@x', displayName: 'A' }

  it('owner + admins can manage members; plain members + strangers cannot', () => {
    expect(canManageGroupMembers(makeGroup(), owner)).toBe(true)
    expect(canManageGroupMembers(makeGroup(), admin)).toBe(true)
    expect(canManageGroupMembers(makeGroup(), member)).toBe(false)
    expect(canManageGroupMembers(makeGroup(), other)).toBe(false)
  })

  it('a signed-in non-member can request to join a request-policy group', () => {
    expect(canRequestToJoin({ ...makeGroup(), joinPolicy: 'request' }, other)).toBe(true)
    // Missing joinPolicy defaults to request.
    expect(canRequestToJoin(makeGroup(), other)).toBe(true)
  })

  it('nobody can self-serve into an invite-only group', () => {
    expect(canRequestToJoin({ ...makeGroup(), joinPolicy: 'invite_only' }, other)).toBe(false)
  })

  it('existing members + an unauthenticated visitor cannot request to join', () => {
    expect(canRequestToJoin(makeGroup(), member)).toBe(false)
    expect(canRequestToJoin(makeGroup(), owner)).toBe(false)
    expect(canRequestToJoin(makeGroup(), null)).toBe(false)
  })
})

describe('listing courses and trials', () => {
  it('a public course is listed for an unauthenticated visitor', () => {
    expect(isListedForViewer(makeCourse('public'), null)).toBe(true)
  })
  it('a private course is hidden from non-owners in the listing', () => {
    expect(isListedForViewer(makeCourse('private'), other)).toBe(false)
  })
  it('a private course appears in the listing for its owner', () => {
    expect(isListedForViewer(makeCourse('private'), owner)).toBe(true)
  })
})
