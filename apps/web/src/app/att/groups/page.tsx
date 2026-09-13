'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import LoadingState from '@/components/LoadingState'
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

  const load = async () => {
    const [res, dirRes] = await Promise.all([
      fetch('/att/api/groups'),
      fetch('/att/api/groups?directory=1'),
    ])
    setGroups(res.ok ? (await res.json()).groups : [])
    if (dirRes.ok) setDirectory((await dirRes.json()).groups)
  }
  useEffect(() => { load() }, [])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setCreating(true)
    try {
      const res = await fetch('/att/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Could not create group')
      }
      const group = await res.json()
      router.push(`/att/groups/${group.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create group')
      setCreating(false)
    }
  }

  const inputClass = 'bg-bg border border-border px-3 py-2 text-fg text-sm focus:outline-none focus:border-primary transition-colors'

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={
          <>
            <Link href="/att" className="tt-nav-link text-sm">← HOME</Link>
            <span className="text-muted">/</span>
            <span className="text-fg text-sm">GROUPS</span>
          </>
        }
      />

      <div className="flex-1 px-4 py-8 max-w-3xl mx-auto w-full space-y-10">
        <section>
          <h1 className="text-lg font-bold text-fg tracking-widest mb-2">YOUR GROUPS</h1>
          <p className="text-sm text-muted mb-6">
            Groups scope courses and trials to a closed group of members.
          </p>

          {groups === null && <LoadingState className="py-8" />}
          {groups && groups.length === 0 && (
            <div className="border border-border p-6 text-center text-muted text-sm">
              You&apos;re not in any groups yet. Create one below, or wait for an invitation.
            </div>
          )}
          {groups && groups.length > 0 && (
            <div className="flex flex-col gap-2">
              {groups.map(c => (
                <Link
                  key={c.id}
                  href={`/att/groups/${c.id}`}
                  className="border border-border px-4 py-3 hover:border-primary transition-colors group flex items-center justify-between"
                >
                  <div className="min-w-0">
                    <div className="text-fg font-bold group-hover:text-primary transition-colors">{c.name}</div>
                    {c.description && (
                      <div className="text-xs text-muted mt-0.5 truncate">{c.description}</div>
                    )}
                  </div>
                  <div className="text-xs text-muted shrink-0 tabular">
                    {1 + c.adminUserIds.length + c.memberUserIds.length} member{1 + c.adminUserIds.length + c.memberUserIds.length === 1 ? '' : 's'}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Public directory of groups you can join (#99). Only groups you're not
            already in; invite-only groups are excluded server-side. */}
        {directory && directory.some(g => !g.isMember) && (
          <section className="border-t border-border pt-8">
            <h2 className="text-xs text-muted tracking-[0.2em] uppercase mb-2">Discover groups</h2>
            <p className="text-sm text-muted mb-4">Find a group to join. Open the group to join or request an invitation.</p>
            <div className="flex flex-col gap-2">
              {directory.filter(g => !g.isMember).map(g => (
                <Link
                  key={g.id}
                  href={`/att/groups/${g.id}`}
                  className="border border-border px-4 py-3 hover:border-primary transition-colors group flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-fg font-bold group-hover:text-primary transition-colors">{g.name}</div>
                    {g.description && (
                      <div className="text-xs text-muted mt-0.5 truncate">{g.description}</div>
                    )}
                    <div className="text-xs text-muted mt-0.5 tabular">
                      {g.memberCount} member{g.memberCount === 1 ? '' : 's'}
                    </div>
                  </div>
                  <span className={`text-xs tracking-widest px-2 py-0.5 border shrink-0 ${
                    g.joinPolicy === 'open'
                      ? 'border-green text-green'
                      : 'border-primary text-primary'
                  }`}>
                    {g.joinPolicy === 'open' ? 'JOIN' : 'REQUEST'}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="border-t border-border pt-8">
          <h2 className="text-xs text-muted tracking-[0.2em] uppercase mb-4">Create a group</h2>
          <form onSubmit={create} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Group name (e.g. Henley Rowing Group)"
              className={`${inputClass} flex-1`}
            />
            <button
              type="submit"
              disabled={creating || !name.trim()}
              className="px-6 py-2 bg-primary text-white text-xs font-bold tracking-widest hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {creating ? 'CREATING…' : 'CREATE GROUP'}
            </button>
          </form>
          {error && (
            <div className="border border-red bg-red/10 px-3 py-2 text-red text-xs mt-3">{error}</div>
          )}
        </section>
      </div>
    </main>
  )
}
