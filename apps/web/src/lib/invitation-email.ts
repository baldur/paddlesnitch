// Email templates for group invitations. Kept separate from email.ts so
// the SES wiring stays generic and the wording is easy to grep when
// product wants to tweak it.

import type { GroupMetadata } from './types'

type Args = {
  group: GroupMetadata
  inviterName: string
  baseUrl: string
  role: 'admin' | 'member'
}

// Sign-up invite — recipient does not yet have an account. The
// `?next=/att/groups/{groupId}` query param tells the auth page where to
// send them once they've signed up; the signup handler converts the
// pending invite to a real membership automatically (see
// applyPendingInvitations in src/lib/pending-invitations.ts), so by the
// time they hit the group page they're already a member.
export function pendingInviteEmail({ group, inviterName, baseUrl, role }: Args) {
  const signupUrl = new URL('/att/auth', baseUrl)
  signupUrl.searchParams.set('next', `/att/groups/${group.id}`)
  signupUrl.searchParams.set('signup', '1')

  const subject = `${inviterName} invited you to join ${group.name} on paddlesnitch`
  const text = [
    `${inviterName} has invited you to join ${group.name} on paddlesnitch.com${role === 'admin' ? ' as an admin' : ''}.`,
    '',
    'paddlesnitch is a GPS-verified time-trial service for kayak and rowing crews. Groups use it to run regular sprints and longer head-races without a stopwatch.',
    '',
    'Create your account here:',
    signupUrl.toString(),
    '',
    'Once signed up you\'ll join the group automatically. The invitation expires in 30 days.',
    '',
    'If you don\'t know the person who invited you, you can safely ignore this email — your address won\'t be added to anything.',
  ].join('\n')

  return { subject, text }
}

// Already-an-account invite. Link straight to the group page; the proxy
// will bounce them through sign-in if their session has lapsed.
export function existingAccountInviteEmail({ group, inviterName, baseUrl, role }: Args) {
  const url = new URL(`/att/groups/${group.id}`, baseUrl).toString()
  const subject = `${inviterName} invited you to join ${group.name} on paddlesnitch`
  const text = [
    `${inviterName} has invited you to join ${group.name} on paddlesnitch.com${role === 'admin' ? ' as an admin' : ''}.`,
    '',
    'Open the group to accept:',
    url,
    '',
    'The invitation expires in 30 days.',
  ].join('\n')

  return { subject, text }
}
