// Shared track/geometry types now live in @paddlesnitch/timing (monorepo
// package extraction). Re-exported here so existing `@/lib/types` imports across
// the app resolve unchanged. See docs/features/platform-monorepo.md.
export * from '@paddlesnitch/timing/types'
// Platform identity + Strava plumbing types live in @paddlesnitch/core.
export type { AuthUser, StravaActivitySummary, StravaTokens } from '@paddlesnitch/core/types'

// Locally-referenced moved types (needed in the att-domain definitions below).
import type { Line, CourseType, Split, EntryConditions } from '@paddlesnitch/timing/types'
import type { BoatClass, CrewMember } from '@paddlesnitch/core/types'

// Visibility scope. Phase 1 added public / private; phase 4 added `group`
// (visibility tied to a group's members + admins + owner). `visibleToGroupId`
// MUST be set when visibility === 'group' and absent otherwise.
export type Visibility = 'public' | 'private' | 'group'

export type CourseMetadata = {
  id: string
  name: string
  sport: 'kayak' | 'rowing' | 'both'
  type: CourseType
  startLine: Line
  finishLine?: Line   // only for point_to_point / one_way
  distanceMetres: number
  minValidSeconds?: number
  gateDirection?: 1 | -1  // legacy single-gate: derived from gates[0].direction
  gates?: Array<{ line: Line; direction: 1 | -1 }>  // gate type: ordered checkpoints
  // The owning group. Management authority (edit/delete/create-trial) belongs to
  // this group's owner + admins. Set on every course created from phase 2 on;
  // optional only to tolerate pre-migration data, where `adminUserId` is the
  // fallback owner. See docs/features/groups-and-creation-gating.md.
  groupId?: string
  // Created-by, retained for audit. NO LONGER the management authority once
  // `groupId` is set — that moved to the group's admins.
  adminUserId: string
  visibility: Visibility
  visibleToGroupId?: string // present iff visibility === 'group'
  createdAt: string
}

// `participation` controls WHO can submit a trace once they can view the trial
// (phase 3):
//   members      — any member of the trial's group (or an invitee). New default.
//   invitational — only users in `invitedUserIds`.
//   public       — anyone who can view the trial (the escape hatch for open
//                  community races).
// The organiser (creator / group admin) can always submit regardless.
// Legacy note: pre-phase-3 trials stored `'open'`, which is treated as `public`
// at read time and migrated by scripts/migrate-participation-open-to-public.ts.
export type Participation = 'members' | 'invitational' | 'public'

export type TrialMetadata = {
  id: string
  courseId: string
  name: string
  date: string // ISO date
  status: 'open' | 'closed'
  // The owning group, inherited from the course at creation. Manage authority
  // (open/close, edit, invite) belongs to this group's owner + admins. Set on
  // every trial created from phase 2 on; optional only for pre-migration data.
  groupId?: string
  // Created-by, retained for audit (see CourseMetadata.adminUserId).
  adminUserId: string
  visibility: Visibility
  visibleToGroupId?: string  // present iff visibility === 'group'
  participation: Participation
  // Cognito subs of invited users. Empty (or absent) for `open` trials.
  invitedUserIds: string[]
  // Optional shareable submit link. Anyone signed in who reaches the upload page
  // with `?invite={submitToken}` may submit — even on a members/invitational
  // trial — so an organiser can hand out one link and let recipients sign up and
  // submit without being added to the group first. Rotate/revoke to disable.
  submitToken?: string
  createdAt: string
}

// Boat classes + crew/seat model now live in @paddlesnitch/core (shared with the
// analysis app). Re-exported here so existing `@/lib/types` imports across att
// resolve unchanged. See docs/features/platform-monorepo.md.
export type { KayakClass, SculClass, SweepClass, BoatClass, Seat, CrewMember } from '@paddlesnitch/core/types'
export { BOAT_CLASSES, BOAT_CLASS_INFO, isBoatClass, expectedSeats, seatLabel, validateCrew } from '@paddlesnitch/core/types'

export type LeaderboardEntry = {
  entryId: string
  userId: string
  displayName: string
  submittedAt: string
  // raceDate is inferred server-side from the trace's first timestamp
  // (YYYY-MM-DD, UTC), falling back to the trial date (#123).
  raceDate: string
  boatClass: BoatClass
  crew: CrewMember[]
  totalElapsedSeconds: number
  splits: Split[]
  // How many valid runs the uploaded trace contained; this row is the
  // fastest. Shown as "best of N runs" when > 1. Undefined for pre-#77
  // entries (treat as a single run).
  runCount?: number
  // Mean stroke rate (SPM) over the racing window, when the source trace carried
  // it (#143/#148). Shown on the leaderboard's expanded row. Undefined when the
  // trace had no cadence/stroke-rate data (common for GPX exports).
  avgStrokeRate?: number
  // Set only when the entry was imported from Strava — the source activity id,
  // so the leaderboard can link "View on Strava" back to it (Strava brand
  // guidelines, #107). Derived from the stored trace filename.
  stravaActivityId?: number
  // Weather + river flow at this entry's finish time (#106). Best-effort; may
  // be absent (capture failed) or partial.
  conditions?: EntryConditions
}

// EntryConditions moved to @paddlesnitch/timing/types (re-exported at top of
// this file). AuthUser / StravaTokens / StravaActivitySummary moved to
// @paddlesnitch/core/types (re-exported at top of this file).

// ---------------------------------------------------------------------------
// Groups (phase 4)
// ---------------------------------------------------------------------------
//
// A group is an org / community / team that can scope a course or trial's
// visibility to its members. Ownership semantics:
//   - exactly one owner (the creator until explicit transfer)
//   - zero or more admins (can manage on behalf of the group, can NOT
//     transfer ownership or delete)
//   - zero or more members (can see group-visibility resources, can submit
//     to group-scoped trials, can NOT manage anything)
//
// Stored at groups/{groupId}/metadata.json. Reverse index per user lives at
// users/{userId}/groups.json — see src/lib/groups.ts.

export type GroupMetadata = {
  id: string
  name: string
  description: string           // free-form, optional in the UI but always present as a string
  ownerId: string               // Cognito sub
  adminUserIds: string[]
  memberUserIds: string[]
  createdAt: string
  // How a non-member can join (phase 4). Missing is treated as 'request':
  //   invite_only — only via an admin invitation (no self-serve)
  //   request     — anyone can request; an admin approves (default)
  //   open        — anyone can join instantly, no approval
  joinPolicy?: JoinPolicy
  // Optional shareable join link. Anyone signed in who hits the group with a
  // matching token joins instantly, regardless of joinPolicy. Rotate/clear to
  // revoke. Absent = no active link.
  joinLinkToken?: string
}

export type JoinPolicy = 'invite_only' | 'request' | 'open'

// A self-serve request to join a group (phase 4). Stored at
// groups/{groupId}/join-requests/{id}.json. Auto-accepted instantly when the
// group's joinPolicy is 'open' (so a pending record never persists in that
// case); otherwise it sits 'pending' until an admin approves or declines.
export type JoinRequest = {
  id: string
  groupId: string
  userId: string                // Cognito sub of the requester
  requestedAt: string           // ISO 8601
  status: 'pending' | 'accepted' | 'declined'
}

// Stored at groups/{groupId}/invitations/{invitationId}.json (resolved invites
// for users who already have an account) and at
// pending-invitations/groups/{emailHash}/{invitationId}.json (unresolved
// invites that fire on signup).
//
// Pre-signup invites resolve themselves when the matching email signs up.
export type GroupInvitation = {
  id: string
  groupId: string
  role: 'admin' | 'member'
  invitedBy: string             // Cognito sub of the inviter
  // Exactly one of these is set. toUserId for resolved invites; toEmail
  // for invites that landed before the recipient had an account.
  toUserId?: string
  toEmail?: string
  createdAt: string
  expiresAt: string             // ISO; default +30 days
  status: 'pending' | 'accepted' | 'declined' | 'expired'
}

// ---------------------------------------------------------------------------
// Terms of Service (phase 5)
// ---------------------------------------------------------------------------

// Bumped manually when legal/tos-{version}.md gets a material change.
// Signed-in users see a re-accept gate on their next request until they
// accept the new version.
export const CURRENT_TOS_VERSION = '001'

// Persisted per-user at users/{userId}/tos-consent.json. A user with no
// record at all has never accepted any ToS version (a pre-existing
// account from before phase 5 ships, for example).
export type TosConsent = {
  acceptances: Array<{ version: string; acceptedAt: string }>
}
