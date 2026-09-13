import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { findUserByEmail } from '@/lib/cognito'
import {
  getGroup,
  listGroupInvitations,
  newInvitation,
  putInvitation,
  putPendingInvitation,
} from '@/lib/groups'
import { canManageGroup } from '@/lib/permissions'
import { sendEmail } from '@/lib/email'
import { pendingInviteEmail, existingAccountInviteEmail } from '@/lib/invitation-email'
import { canonicalBaseUrl } from '@/lib/url'
import { isSyntheticStravaEmail } from '@/lib/strava-account'

type Params = { params: Promise<{ groupId: string }> }

// GET /att/api/groups/[groupId]/invitations
// Owner / admin only. Returns every outstanding (or finalised) invitation
// stored under the group. Pending email invitations queued under
// pending-invitations/ are NOT included here — they're only surfaced when
// the matching user signs up.
export async function GET(_: NextRequest, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { groupId } = await params
  const group = await getGroup(groupId)
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canManageGroup(group, user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const invites = await listGroupInvitations(groupId)
  return NextResponse.json({ invitations: invites })
}

// POST /att/api/groups/[groupId]/invitations  { email, role?: 'admin' | 'member' }
// Owner / admin. If the email matches an existing account, the invite is
// stored resolved (toUserId set). If not, it's queued as a pending invite
// keyed by email-hash so the next signup with that address can pick it up.
//
// The inviter doesn't need to know whether the recipient has an account.
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { groupId } = await params
  const group = await getGroup(groupId)
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canManageGroup(group, user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email) return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  const role = body.role === 'admin' ? 'admin' : 'member'

  const baseUrl = canonicalBaseUrl(req)
  const inviterName = user.displayName || user.email
  // Synthetic Strava emails are non-routable placeholders — they live on
  // noreply.paddlesnitch.com and have no inbox. Skip the send rather than
  // bouncing a real address (the local part is strava-{athleteId} which
  // could collide with a real recipient by accident).
  const inboxIsReal = !isSyntheticStravaEmail(email)

  const matched = await findUserByEmail(email)
  if (matched) {
    // Already-an-account invite. Stored resolved under the group so the
    // recipient can find it by groupId without scanning everything.
    const invitation = newInvitation({
      groupId,
      role,
      invitedBy: user.id,
      toUserId: matched.sub,
    })
    await putInvitation(invitation)
    // emailSent is null when there's no real inbox to reach (synthetic Strava
    // address), true/false when a send was actually attempted. Surfacing it lets
    // the UI warn "invite saved but email failed" instead of the send failing
    // silently (see the SES IAM trap the invites hit in prod).
    let emailSent: boolean | null = null
    if (inboxIsReal) {
      const { subject, text } = existingAccountInviteEmail({ group, inviterName, baseUrl, role })
      emailSent = await sendEmail({ to: email, subject, text })
    }
    return NextResponse.json({ invitation, resolved: true, emailSent }, { status: 201 })
  }

  // Pre-signup invite. Queued under pending-invitations/groups/{emailHash}/
  // and merged into the user's groups when they sign up.
  const invitation = newInvitation({
    groupId,
    role,
    invitedBy: user.id,
    toEmail: email,
  })
  await putPendingInvitation(invitation)
  // Without this email the recipient has no idea they were invited — the whole
  // point of the pending-invitation feature breaks (see #53). Here a failed
  // send is the MOST damaging (a pre-signup recipient has no in-app fallback),
  // so emailSent is surfaced for the UI to warn on.
  let emailSent: boolean | null = null
  if (inboxIsReal) {
    const { subject, text } = pendingInviteEmail({ group, inviterName, baseUrl, role })
    emailSent = await sendEmail({ to: email, subject, text })
  }
  return NextResponse.json({ invitation, resolved: false, emailSent }, { status: 201 })
}
