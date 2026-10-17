'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import LoadingState from '@/components/LoadingState'
import { Page, PageHeader, Section } from '@paddlesnitch/ui/Layout'
import { Button, buttonClass } from '@paddlesnitch/ui/Button'
import { Field, inputClass } from '@paddlesnitch/ui/Form'
import { Badge, Chevron, EmptyState, cardLinkClass } from '@paddlesnitch/ui/Card'
import type { GroupMetadata } from '@/lib/types'

// /att/groups — the viewer's groups, a public directory of joinable groups
// (#99), and a quick-create form.

// A public-directory group (limited projection — no member list). #99.
type DirectoryGroup = {
  id: string
  name: string
  description: string
  joinPolicy: 'open' | 'request' | 'invite_only'
  memberCount: number
  isMember: boolean
}

export default function GroupsCataloguePage() {
  const router = useRouter()
  const [groups, setGroups] = useState<GroupMetadata[] | null>(null)
  const [directory, setDirectory] = useState<DirectoryGroup[] | null>(null)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/att/api/groups'),
      fetch('/att/api/groups?directory=1'),
    ]).then(async ([res, dirRes]) => {
      setGroups(res.ok ? (await res.json()).groups : [])
      if (dirRes.ok) setDirectory((await dirRes.json()).groups)
    })
  }, [])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!name.trim()) { setError('Give your group a name first.'); return }
    setCreating(true)
    try {
      const res = await fetch('/att/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Couldn’t create the group. Please try again.')
      }
      const group = await res.json()
      router.push(`/att/groups/${group.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t create the group. Please try again.')
      setCreating(false)
    }
  }

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={<Link href="/att" className="tt-nav-link">← Trials</Link>}
      />

      <Page>
        <PageHeader
          title="Groups"
          description="A group is a club or squad. It runs courses and trials for its members."
          actions={<a href="#new-group" className={buttonClass('primary')}>New group</a>}
        />

        <Section title="Your groups">
          {groups === null && <LoadingState className="py-8" />}
          {groups && groups.length === 0 && (
            <EmptyState
              title="You're not in a group yet"
              body="Start one for your club or squad, or join one below."
              action={<a href="#new-group" className={buttonClass('secondary')}>New group</a>}
            />
          )}
          {groups && groups.length > 0 && (
            <ul className="flex flex-col gap-2">
              {groups.map(c => {
                const count = 1 + c.adminUserIds.length + c.memberUserIds.length
                return (
                  <li key={c.id}>
                    <Link href={`/att/groups/${c.id}`} className={`${cardLinkClass} flex items-center gap-3 px-4 py-3 min-h-11`}>
                      <div className="min-w-0 flex-1">
                        <div className="text-base font-semibold text-fg">{c.name}</div>
                        {c.description && <div className="text-sm text-muted mt-0.5 truncate">{c.description}</div>}
                        <div className="text-sm text-muted mt-0.5 tabular">{count} member{count === 1 ? '' : 's'}</div>
                      </div>
                      <Chevron />
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

        {/* Public directory of groups you can join (#99). Only groups you're not
            already in; invite-only groups are excluded server-side. */}
        {directory && directory.some(g => !g.isMember) && (
          <Section title="Find a group">
            <ul className="flex flex-col gap-2">
              {directory.filter(g => !g.isMember).map(g => (
                <li key={g.id}>
                  <Link href={`/att/groups/${g.id}`} className={`${cardLinkClass} flex items-center gap-3 px-4 py-3 min-h-11`}>
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-semibold text-fg">{g.name}</div>
                      {g.description && <div className="text-sm text-muted mt-0.5 truncate">{g.description}</div>}
                      <div className="text-sm text-muted mt-0.5 tabular">{g.memberCount} member{g.memberCount === 1 ? '' : 's'}</div>
                    </div>
                    <Badge tone={g.joinPolicy === 'open' ? 'green' : 'neutral'}>
                      {g.joinPolicy === 'open' ? 'Open to join' : 'Ask to join'}
                    </Badge>
                    <Chevron />
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <section id="new-group" className="flex flex-col gap-3 border-t border-border pt-8 scroll-mt-24">
          <h2 className="text-lg font-semibold text-fg">New group</h2>
          <form onSubmit={create} className="flex flex-col sm:flex-row sm:items-end gap-3">
            <Field label="Group name" htmlFor="group-name" className="flex-1" error={error || undefined}>
              <input
                id="group-name"
                type="text"
                value={name}
                onChange={e => { setName(e.target.value); setError('') }}
                placeholder="e.g. Henley Rowing Club"
                className={inputClass}
              />
            </Field>
            <Button type="submit" variant="primary" disabled={creating} className={error ? 'sm:mb-7' : ''}>
              {creating ? 'Creating…' : 'Create group'}
            </Button>
          </form>
          <p className="text-sm text-muted">You&apos;ll be its owner, so you can add courses and open trials.</p>
        </section>
      </Page>
    </main>
  )
}
