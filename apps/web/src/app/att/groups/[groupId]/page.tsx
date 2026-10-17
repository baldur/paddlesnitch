'use client'
import Link from 'next/link'
import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import LoadingState from '@/components/LoadingState'
import { Page, PageHeader, Section } from '@paddlesnitch/ui/Layout'
import { Button, buttonClass } from '@paddlesnitch/ui/Button'
import { Field, Segmented, inputClass, selectClass } from '@paddlesnitch/ui/Form'
import { Badge, Card, cardClass } from '@paddlesnitch/ui/Card'
import type { GroupInvitation, JoinPolicy, AuthUser } from '@/lib/types'

type Invitation = GroupInvitation
type ViewerStatus = 'owner' | 'admin' | 'member' | 'none' | 'pending'

// What GET /att/api/groups/[id] returns: full payload for members, a limited
// projection (name/description/memberCount) for non-members. `viewerStatus`
// distinguishes them.
type GroupView = {
  id: string
  name: string
  description: string
  viewerStatus: ViewerStatus
  limited?: boolean
  // full payload only (members):
  ownerId?: string
  adminUserIds?: string[]
  memberUserIds?: string[]
  memberNames?: Record<string, string>
  joinPolicy?: JoinPolicy
  joinLinkToken?: string
  // limited payload only (non-members):
  memberCount?: number
}

type PendingRequest = { id: string; userId: string; displayName: string; email: string }

// Loads the page's data, setting each piece as it arrives (the group shows
// before an admin's invitations and join requests do). Outside the component so
// the mount effect sets state only in these async callbacks.
async function loadGroupPage(groupId: string, set: {
  setUser: (u: AuthUser | null) => void
  setGroup: (g: GroupView | null) => void
  setInvitations: (i: Invitation[]) => void
  setJoinRequests: (r: PendingRequest[]) => void
}) {
  const { setUser, setGroup, setInvitations, setJoinRequests } = set
  const [meRes, groupRes] = await Promise.all([
    fetch('/att/api/auth/me').then(r => r.ok ? r.json() : null),
    fetch(`/att/api/groups/${groupId}`),
  ])
  setUser(meRes)
  if (!groupRes.ok) { setGroup(null); return }
  const g: GroupView = await groupRes.json()
  setGroup(g)
  const canManage = g.viewerStatus === 'owner' || g.viewerStatus === 'admin'
  if (canManage) {
    const [invRes, reqRes] = await Promise.all([
      fetch(`/att/api/groups/${groupId}/invitations`),
      fetch(`/att/api/groups/${groupId}/join-requests`),
    ])
    if (invRes.ok) setInvitations((await invRes.json()).invitations ?? [])
    if (reqRes.ok) setJoinRequests((await reqRes.json()).requests ?? [])
  }
}

// /att/groups/[groupId] — view a group, manage members (admins), or join
// (non-members). Self-serve join is phase 4.
export default function GroupDetailPage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const { groupId } = use(params)
  const router = useRouter()
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined)
  const [group, setGroup] = useState<GroupView | null | undefined>(undefined)
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [joinRequests, setJoinRequests] = useState<PendingRequest[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState('')
  // Set when the invite was saved but its email couldn't be sent, so the
  // organiser knows to resend or share the link directly instead of assuming
  // the recipient was notified.
  const [inviteWarning, setInviteWarning] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState('')

  const loadAll = () => loadGroupPage(groupId, { setUser, setGroup, setInvitations, setJoinRequests })
  useEffect(() => { loadGroupPage(groupId, { setUser, setGroup, setInvitations, setJoinRequests }) }, [groupId])

  if (user === undefined || group === undefined) {
    return <main className="flex-1 flex"><LoadingState /></main>
  }
  if (!user) {
    return (
      <main className="flex-1 flex flex-col">
        <AppHeader breadcrumb={<Link href="/att/groups" className="tt-nav-link">← Groups</Link>} />
        <Page width="narrow">
          <PageHeader title="Sign in to see this group" />
          <Link href={`/signin?next=/att/groups/${groupId}`} className={buttonClass('primary', 'md', 'self-start')}>Sign in</Link>
        </Page>
      </main>
    )
  }
  if (!group) {
    return (
      <main className="flex-1 flex flex-col">
        <AppHeader breadcrumb={<Link href="/att/groups" className="tt-nav-link">← Groups</Link>} />
        <Page width="narrow">
          <PageHeader title="We can't find this group" />
          <Link href="/att/groups" className={buttonClass('secondary', 'md', 'self-start')}>Back to groups</Link>
        </Page>
      </main>
    )
  }

  const role = group.viewerStatus
  const isMember = role === 'owner' || role === 'admin' || role === 'member'
  const canManage = role === 'owner' || role === 'admin'

  // ---- Non-member: the join view ----
  if (!isMember) {
    const policy = group.joinPolicy ?? 'request'
    const requestToJoin = async () => {
      setJoining(true)
      setJoinError('')
      try {
        const token = new URLSearchParams(window.location.search).get('join') ?? undefined
        const res = await fetch(`/att/api/groups/${groupId}/join-requests`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(token ? { token } : {}),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error ?? 'Couldn’t join the group. Please try again.')
        await loadAll() // reflect accepted (now a member) or pending
      } catch (err) {
        setJoinError(err instanceof Error ? err.message : 'Couldn’t join the group. Please try again.')
      } finally {
        setJoining(false)
      }
    }

    return (
      <main className="flex-1 flex flex-col">
        <AppHeader breadcrumb={<Link href="/att/groups" className="tt-nav-link">← Groups</Link>} />
        <Page width="narrow">
          <PageHeader
            title={group.name}
            description={<span className="tabular">{group.memberCount} member{group.memberCount === 1 ? '' : 's'}</span>}
          />
          {group.description && <p className="text-base text-muted whitespace-pre-wrap">{group.description}</p>}

          <Card className="flex flex-col gap-3">
            {role === 'pending' ? (
              <p className="text-base text-fg">Your request to join is waiting for an admin.</p>
            ) : policy === 'invite_only' ? (
              <p className="text-base text-muted">This group is invite only. Ask an admin to send you an invitation.</p>
            ) : (
              <>
                <p className="text-base text-fg">
                  {policy === 'open'
                    ? 'Anyone can join this group.'
                    : 'Ask to join and an admin will let you in.'}
                </p>
                <Button variant="primary" onClick={requestToJoin} disabled={joining} className="self-start">
                  {joining ? (policy === 'open' ? 'Joining…' : 'Asking…') : policy === 'open' ? 'Join group' : 'Ask to join'}
                </Button>
              </>
            )}
            {joinError && <p className="text-sm text-red" role="alert">{joinError}</p>}
          </Card>
        </Page>
      </main>
    )
  }

  // ---- Member / admin view ----
  const adminUserIds = group.adminUserIds ?? []
  const memberUserIds = group.memberUserIds ?? []
  const ownerId = group.ownerId!
  const names = group.memberNames ?? {}

  const submitInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setInviting(true)
    setInviteError('')
    setInviteWarning('')
    try {
      const res = await fetch(`/att/api/groups/${groupId}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Couldn’t send the invitation. Please try again.')
      }
      const data = await res.json()
      const invited = inviteEmail.trim()
      setInviteEmail('')
      if (data.resolved) setInvitations(prev => [...prev, data.invitation])
      // The invite is saved either way, but if the notification email failed we
      // tell the organiser so the recipient doesn't silently go un-notified.
      if (data.emailSent === false) {
        setInviteWarning(`Invitation to ${invited} saved, but the email couldn’t be sent. Try again, or share the group link with them directly.`)
      }
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Couldn’t send the invitation. Please try again.')
    } finally {
      setInviting(false)
    }
  }

  const removeInvitation = async (id: string) => {
    await fetch(`/att/api/groups/${groupId}/invitations/${id}`, { method: 'DELETE' })
    setInvitations(prev => prev.filter(i => i.id !== id))
  }

  const removeMember = async (userId: string) => {
    const res = await fetch(`/att/api/groups/${groupId}/members/${userId}`, { method: 'DELETE' })
    if (!res.ok) return
    const data = await res.json()
    setGroup({ ...data.group, viewerStatus: role })
  }

  const leaveGroup = async () => {
    if (!confirm('Leave this group?')) return
    const res = await fetch(`/att/api/groups/${groupId}/members/${user.id}`, { method: 'DELETE' })
    if (res.ok) router.push('/att/groups')
  }

  const deleteGroup = async () => {
    if (!confirm('Delete this group? This cannot be undone.')) return
    const res = await fetch(`/att/api/groups/${groupId}`, { method: 'DELETE' })
    if (res.ok) router.push('/att/groups')
  }

  const setJoinPolicy = async (policy: JoinPolicy) => {
    const res = await fetch(`/att/api/groups/${groupId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ joinPolicy: policy }),
    })
    if (res.ok) { const g = await res.json(); setGroup({ ...g, viewerStatus: role }) }
  }

  const patchLink = async (body: Record<string, unknown>) => {
    const res = await fetch(`/att/api/groups/${groupId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) { const g = await res.json(); setGroup({ ...g, viewerStatus: role }) }
  }

  const approveRequest = async (id: string) => {
    const res = await fetch(`/att/api/groups/${groupId}/join-requests/${id}/approve`, { method: 'POST' })
    if (!res.ok) return
    const data = await res.json()
    setGroup({ ...data.group, viewerStatus: role })
    setJoinRequests(prev => prev.filter(r => r.id !== id))
  }

  const declineRequest = async (id: string) => {
    const res = await fetch(`/att/api/groups/${groupId}/join-requests/${id}/decline`, { method: 'POST' })
    if (res.ok) setJoinRequests(prev => prev.filter(r => r.id !== id))
  }

  const joinPolicy = group.joinPolicy ?? 'request'
  const joinLink = group.joinLinkToken
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/att/groups/${groupId}?join=${group.joinLinkToken}`
    : ''

  const memberCount = 1 + adminUserIds.length + memberUserIds.length

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={<Link href="/att/groups" className="tt-nav-link">← Groups</Link>}
      />

      <Page>
        <PageHeader
          title={group.name}
          description={
            <span className="flex flex-wrap items-center gap-2">
              <span className="tabular">{memberCount} member{memberCount === 1 ? '' : 's'}</span>
              {canManage && <Badge tone="primary">{role === 'owner' ? 'You own this group' : 'You are an admin'}</Badge>}
            </span>
          }
        />
        {group.description && (
          <p className="text-base text-muted whitespace-pre-wrap -mt-4">{group.description}</p>
        )}

        <Section title="Members">
          <ul className={`${cardClass} divide-y divide-border`}>
            <MemberRow name={names[ownerId]} role="owner" canKick={false} onKick={() => {}} />
            {adminUserIds.map(id => (
              <MemberRow key={id} name={names[id]} role="admin" canKick={role === 'owner' && id !== user.id} onKick={() => removeMember(id)} />
            ))}
            {memberUserIds.map(id => (
              <MemberRow key={id} name={names[id]} role="member" canKick={canManage && id !== user.id} onKick={() => removeMember(id)} />
            ))}
          </ul>
        </Section>

        {canManage && joinRequests.length > 0 && (
          <Section title={`Asking to join (${joinRequests.length})`}>
            <ul className={`${cardClass} divide-y divide-border`}>
              {joinRequests.map(r => (
                <li key={r.id} className="flex items-center justify-between px-4 py-2 gap-3">
                  <div className="min-w-0">
                    <div className="text-base text-fg truncate">{r.displayName}</div>
                    {r.email && <div className="text-sm text-muted truncate">{r.email}</div>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" onClick={() => approveRequest(r.id)}>Approve</Button>
                    <Button size="sm" variant="quiet" onClick={() => declineRequest(r.id)}>Decline</Button>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {canManage && (
          <Section title="Invite someone">
            <form onSubmit={submitInvite} className="flex flex-col sm:flex-row sm:items-end gap-3">
              <Field label="Email" htmlFor="invite-email" className="flex-1">
                <input id="invite-email" type="email" required value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="name@example.com" className={inputClass} />
              </Field>
              <Field label="As" htmlFor="invite-role">
                <select id="invite-role" value={inviteRole} onChange={e => setInviteRole(e.target.value as 'admin' | 'member')} className={selectClass}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </Field>
              <Button type="submit" variant="primary" disabled={inviting || !inviteEmail.trim()}>
                {inviting ? 'Inviting…' : 'Invite'}
              </Button>
            </form>
            {inviteError && <p role="alert" className="text-sm text-red">{inviteError}</p>}
            {inviteWarning && <p className="rounded-control border border-border bg-surface-2 px-3 py-2 text-fg text-sm">{inviteWarning}</p>}
            <p className="text-sm text-muted">If they don’t have an account yet, they’ll join when they sign up.</p>
          </Section>
        )}

        {canManage && invitations.length > 0 && (
          <Section title={`Invited (${invitations.length})`}>
            <ul className={`${cardClass} divide-y divide-border`}>
              {invitations.map(i => (
                <li key={i.id} className="flex items-center justify-between px-4 py-2 gap-3">
                  <div className="min-w-0">
                    <div className="text-base text-fg truncate">{i.toEmail ?? i.toUserId}</div>
                    <div className="text-sm text-muted">As {i.role}</div>
                  </div>
                  <Button size="sm" variant="quiet" onClick={() => removeInvitation(i.id)}>Cancel invite</Button>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {canManage && (
          <Section title="How people join">
            <Segmented
              label="How people join"
              value={joinPolicy}
              onChange={setJoinPolicy}
              options={[
                { value: 'invite_only', label: 'Invite only' },
                { value: 'request', label: 'Ask to join' },
                { value: 'open', label: 'Open' },
              ]}
            />
            <p className="text-sm text-muted">
              {joinPolicy === 'invite_only'
                ? 'Only people you invite can join.'
                : joinPolicy === 'request'
                  ? 'Anyone can ask to join; you approve each one.'
                  : 'Anyone with the group link can join straight away.'}
            </p>
            <div className="flex flex-col gap-1.5 mt-2">
              <span className="text-sm font-medium text-fg">Join link</span>
              {joinLink ? (
                <div className="flex flex-col sm:flex-row gap-2">
                  <label htmlFor="join-link" className="sr-only">Join link</label>
                  <input id="join-link" readOnly value={joinLink} onFocus={e => e.target.select()} className={`${inputClass} flex-1 text-sm`} />
                  <div className="flex gap-2">
                    <Button onClick={() => navigator.clipboard?.writeText(joinLink)}>Copy</Button>
                    <Button variant="quiet" onClick={() => patchLink({ joinLinkToken: null })}>Turn off link</Button>
                  </div>
                </div>
              ) : (
                <Button onClick={() => patchLink({ regenerateJoinLink: true })} className="self-start">
                  Create join link
                </Button>
              )}
              <p className="text-sm text-muted">Anyone signed in who opens this link joins straight away, whatever you chose above. Turn it off any time.</p>
            </div>
          </Section>
        )}

        {/* Leaving or deleting: quiet, red, at the end. */}
        {role !== 'owner' && (
          <div className="border-t border-border pt-6">
            <Button variant="danger" onClick={leaveGroup}>Leave group</Button>
          </div>
        )}

        {role === 'owner' && (
          <section className="border-t border-border pt-6 flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-fg">Delete group</h2>
            <p className="text-sm text-muted">
              Deletes the group and its invitations, and removes all its members.
              Courses and trials shared with this group become private. You can share them again later.
            </p>
            <Button variant="danger" onClick={deleteGroup} className="self-start">Delete group</Button>
          </section>
        )}
      </Page>
    </main>
  )
}

function MemberRow({
  name,
  role,
  canKick,
  onKick,
}: {
  name: string | undefined
  role: 'owner' | 'admin' | 'member'
  canKick: boolean
  onKick: () => void
}) {
  // Only owner and admins get a mark; a badge on every member says nothing.
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2 min-h-11">
      <div className="min-w-0 flex items-center gap-2">
        <span className="text-base text-fg truncate">{name ?? 'A paddler'}</span>
        {role !== 'member' && <Badge tone={role === 'owner' ? 'primary' : 'neutral'}>{role === 'owner' ? 'Owner' : 'Admin'}</Badge>}
      </div>
      {canKick && (
        <Button size="sm" variant="quiet" onClick={onKick}>Remove</Button>
      )}
    </li>
  )
}
