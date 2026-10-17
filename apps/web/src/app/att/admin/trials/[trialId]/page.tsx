'use client'
import { fmtDay, participationLabel } from '@paddlesnitch/core/format'
import { useEffect, useState, use } from 'react'
import AppHeader from '@/components/AppHeader'
import LoadingState from '@/components/LoadingState'
import { Page, PageHeader, Section, eyebrowClass } from '@paddlesnitch/ui/Layout'
import { Button, buttonClass } from '@paddlesnitch/ui/Button'
import { Field, Segmented, inputClass } from '@paddlesnitch/ui/Form'
import { Badge, cardClass } from '@paddlesnitch/ui/Card'
import type { TrialMetadata, CourseMetadata, LeaderboardEntry } from '@/lib/types'
import { formatTime } from '@/lib/geo'

const whoCanEnterLabel = participationLabel

type Invitee = { sub: string; email: string; displayName: string }

async function fetchInvitees(trialId: string): Promise<Invitee[] | null> {
  const res = await fetch(`/att/api/trials/${trialId}/invitations`)
  return res.ok ? (await res.json()).invitees : null
}

export default function TrialAdminPage({
  params,
}: {
  params: Promise<{ trialId: string }>
}) {
  const { trialId } = use(params)
  const [trial, setTrial] = useState<TrialMetadata | null>(null)
  const [course, setCourse] = useState<CourseMetadata | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [toggling, setToggling] = useState(false)
  const [invitees, setInvitees] = useState<Invitee[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState('')

  const loadInvitees = async () => {
    const list = await fetchInvitees(trialId)
    if (list) setInvitees(list)
  }

  // State is set only in the fetch callbacks, never synchronously in the effect.
  useEffect(() => {
    fetch(`/att/api/trials/${trialId}`).then(r => r.json()).then(async (t: TrialMetadata) => {
      setTrial(t)
      const [c, lb] = await Promise.all([
        fetch(`/att/api/courses/${t.courseId}`).then(r => r.json()),
        fetch(`/att/api/trials/${trialId}/leaderboard`).then(r => r.json()),
      ])
      setCourse(c)
      setLeaderboard(lb)
      if (t.participation === 'invitational') {
        const list = await fetchInvitees(trialId)
        if (list) setInvitees(list)
      }
    })
  }, [trialId])

  const toggleStatus = async () => {
    if (!trial) return
    setToggling(true)
    const newStatus = trial.status === 'open' ? 'closed' : 'open'
    const updated = await fetch(`/att/api/trials/${trialId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    }).then(r => r.json())
    setTrial(updated)
    setToggling(false)
  }

  const toggleVisibility = async () => {
    if (!trial) return
    const next = trial.visibility === 'public' ? 'private' : 'public'
    // Make-public acknowledgement gate. Server enforces too; the client
    // confirm makes the trade-off explicit so we're not silently flipping
    // someone's performance time into a public leaderboard.
    if (next === 'public' && trial.visibility !== 'public') {
      const ok = window.confirm(
        'Make this trial public?\n\n' +
        'Everyone’s name and time on the leaderboard will become visible to anyone on the internet. ' +
        'Participants were told in the Terms of Service that this could happen, but it cannot be undone for results that get cached or shared.\n\n' +
        'Continue?'
      )
      if (!ok) return
    }
    const res = await fetch(`/att/api/trials/${trialId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility: next, acknowledged: next === 'public' }),
    })
    const updated = await res.json()
    if (!res.ok) {
      alert(updated.error ?? 'Couldn’t change who can see this. Please try again.')
      return
    }
    setTrial(updated)
  }

  const changeParticipation = async (next: 'members' | 'invitational' | 'public') => {
    if (!trial || trial.participation === next) return
    const updated = await fetch(`/att/api/trials/${trialId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participation: next }),
    }).then(r => r.json())
    setTrial(updated)
    if (updated.participation === 'invitational') loadInvitees()
  }

  // Mint or revoke the shareable submit-link token.
  const changeSubmitToken = async (body: Record<string, unknown>) => {
    const updated = await fetch(`/att/api/trials/${trialId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json())
    setTrial(updated)
  }

  const submitInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setInviting(true)
    setInviteError('')
    try {
      const res = await fetch(`/att/api/trials/${trialId}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Couldn’t send the invitation. Please try again.')
      }
      setInviteEmail('')
      await loadInvitees()
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Couldn’t send the invitation. Please try again.')
    } finally {
      setInviting(false)
    }
  }

  const uninvite = async (sub: string) => {
    await fetch(`/att/api/trials/${trialId}/invitations/${sub}`, { method: 'DELETE' })
    setInvitees(prev => prev.filter(i => i.sub !== sub))
  }

  if (!trial || !course) {
    return (
      <main className="flex-1 flex">
        <LoadingState />
      </main>
    )
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const trialLink = `${origin}/att/trials/${trialId}`
  const submitLink = trial.submitToken ? `${origin}/att/trials/${trialId}/upload?invite=${trial.submitToken}` : ''
  const gated = trial.participation === 'members' || trial.participation === 'invitational'
  const copy = (t: string) => navigator.clipboard?.writeText(t)

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={<a href={`/att/admin/courses/${course.id}`} className="tt-nav-link">← {course.name}</a>}
      />

      <Page>
        <PageHeader
          eyebrow={<>{course.name} · {fmtDay(trial.date)}</>}
          title={trial.name}
          description={
            <Badge tone={trial.status === 'open' ? 'green' : 'neutral'}>
              {trial.status === 'open' ? 'Open for entries' : 'Closed'}
            </Badge>
          }
          actions={
            <a href={`/att/trials/${trialId}`} className={buttonClass('secondary')}>View leaderboard</a>
          }
        />

        {/* Settings: who can see it, then who can enter. */}
        <Section title="Settings">
          <div className={`${cardClass} divide-y divide-border`}>
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-medium text-fg">Who can see it</div>
                <p className="text-sm text-muted">
                  {trial.visibility === 'public'
                    ? 'Anyone, including the leaderboard.'
                    : trial.visibility === 'group'
                      ? 'Members of the course’s group.'
                      : 'Only you.'}
                  {course.visibility === 'private' && ' The course is private, so this trial is too.'}
                </p>
              </div>
              {/* Visibility flip. Server clamps to private when the parent
                  course is private; the next load reflects what was stored. */}
              <Button onClick={toggleVisibility} className="self-start sm:self-auto">
                {trial.visibility === 'public' ? 'Make private' : 'Make public'}
              </Button>
            </div>
            <div className="flex flex-col gap-2 p-4">
              <div className="text-sm font-medium text-fg">Who can enter</div>
              <Segmented
                label="Who can enter"
                value={trial.participation}
                onChange={changeParticipation}
                options={(['members', 'invitational', 'public'] as const).map(v => ({ value: v, label: whoCanEnterLabel(v) }))}
              />
            </div>
          </div>
        </Section>

        {/* Invitee management — only meaningful when participation is invitational. */}
        {trial.participation === 'invitational' && (
          <Section title={`Invited (${invitees.length})`}>
            <form onSubmit={submitInvite} className="flex flex-col sm:flex-row sm:items-end gap-3">
              <Field label="Email" htmlFor="trial-invite-email" className="flex-1" help="Someone with an account.">
                <input
                  id="trial-invite-email"
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="name@example.com"
                  className={inputClass}
                />
              </Field>
              <Button type="submit" disabled={inviting || !inviteEmail.trim()} className="sm:mb-7">
                {inviting ? 'Inviting…' : 'Invite'}
              </Button>
            </form>

            {inviteError && <p role="alert" className="text-sm text-red">{inviteError}</p>}

            {invitees.length === 0 ? (
              <p className="text-sm text-muted">
                No one is invited yet. Only you can enter until you invite someone.
              </p>
            ) : (
              <ul className={`${cardClass} divide-y divide-border`}>
                {invitees.map(i => (
                  <li key={i.sub} className="flex items-center justify-between gap-3 px-4 py-2 min-h-11">
                    <div className="min-w-0">
                      <div className="text-base text-fg truncate">{i.displayName}</div>
                      {i.email && <div className="text-sm text-muted truncate">{i.email}</div>}
                    </div>
                    <Button size="sm" variant="quiet" onClick={() => uninvite(i.sub)}>Remove</Button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {/* Sharing — get people onto this trial with a link. */}
        <Section title="Share this trial">
          <p className="text-sm text-muted -mt-1">
            People with this link can see the leaderboard and, while the trial is open, sign up and enter from it.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <label htmlFor="trial-link" className="sr-only">Trial link</label>
            <input id="trial-link" readOnly value={trialLink} onFocus={e => e.target.select()} className={`${inputClass} flex-1 text-sm`} />
            <Button onClick={() => copy(trialLink)}>Copy link</Button>
          </div>

          {gated && (
            <p className="rounded-control border border-border bg-surface-2 text-fg text-sm px-3 py-2">
              Only {trial.participation === 'members' ? 'group members' : 'invited paddlers'} can enter. To let
              anyone with a link enter, create an entry link below, or set Who can enter to Anyone.
            </p>
          )}

          <div className="flex flex-col gap-1.5 mt-2">
            <span className="text-sm font-medium text-fg">Entry link</span>
            <p className="text-sm text-muted">
              Anyone with this link can sign up and enter{gated ? ', even if they aren’t in the group or invited' : ''}. Turn it off any time.
            </p>
            {submitLink ? (
              <div className="flex flex-col sm:flex-row gap-2">
                <label htmlFor="submit-link" className="sr-only">Entry link</label>
                <input id="submit-link" readOnly value={submitLink} onFocus={e => e.target.select()} className={`${inputClass} flex-1 text-sm`} />
                <div className="flex gap-2">
                  <Button onClick={() => copy(submitLink)}>Copy</Button>
                  <Button variant="quiet" onClick={() => changeSubmitToken({ submitToken: null })}>Turn off link</Button>
                </div>
              </div>
            ) : (
              <Button onClick={() => changeSubmitToken({ regenerateSubmitToken: true })} className="self-start">
                Create entry link
              </Button>
            )}
          </div>
        </Section>

        <Section
          title={`Entries (${leaderboard.length})`}
          actions={trial.status === 'open' ? (
            <a href={`/att/trials/${trialId}/upload`} className={buttonClass('quiet', 'sm')}>Submit your entry</a>
          ) : undefined}
        >
          {leaderboard.length === 0 ? (
            <p className="text-sm text-muted">No entries yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-base border-collapse">
                <thead>
                  <tr className={`border-b border-border ${eyebrowClass}`}>
                    <th className="text-left py-2 pr-4 font-normal">#</th>
                    <th className="text-left py-2 pr-4 font-normal">Athlete</th>
                    <th className="text-right py-2 pr-4 font-normal">Time</th>
                    <th className="text-right py-2 font-normal">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((entry, i) => (
                    <tr key={entry.entryId} className="border-b border-border">
                      <td className="py-2.5 pr-4 text-muted tabular">{i + 1}</td>
                      <td className="py-2.5 pr-4 text-fg">{entry.displayName}</td>
                      <td className="py-2.5 pr-4 text-right tabular text-primary-text font-semibold">
                        {formatTime(entry.totalElapsedSeconds)}
                      </td>
                      <td className="py-2.5 text-right text-muted text-sm whitespace-nowrap">
                        {fmtDay(entry.submittedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* Closing ends entries: last, and red. */}
        <section className="border-t border-border pt-6 flex flex-col gap-2">
          <p className="text-sm text-muted">
            {trial.status === 'open'
              ? 'Closing stops new entries. The leaderboard stays up.'
              : 'Reopening lets people enter again.'}
          </p>
          <Button
            variant={trial.status === 'open' ? 'danger' : 'secondary'}
            onClick={toggleStatus}
            disabled={toggling}
            className="self-start"
          >
            {toggling ? (trial.status === 'open' ? 'Closing…' : 'Reopening…') : trial.status === 'open' ? 'Close trial' : 'Reopen trial'}
          </Button>
        </section>
      </Page>
    </main>
  )
}
