'use client'
import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import type { CourseMetadata } from '@/lib/types'

function NewTrialForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Derive directly from searchParams — see CLAUDE.md (useSearchParams anti-pattern note).
  const presetCourseId = searchParams.get('courseId') ?? ''

  const [courses, setCourses] = useState<CourseMetadata[] | null>(null)
  const [courseId, setCourseId] = useState(presetCourseId)
  const [name, setName] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [visibility, setVisibility] = useState<'public' | 'private' | 'group'>('public')
  const [participation, setParticipation] = useState<'members' | 'invitational' | 'public'>('members')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    // Only courses the viewer can manage — opening a trial needs admin of the
    // course's group (phase 2). A 'group'-scoped trial inherits that group.
    fetch('/att/api/courses?manageable=1')
      .then(r => r.json())
      .then(setCourses)
      .catch(() => setError('Could not load courses'))
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!courseId) { setError('Pick a course.'); return }
    if (!name.trim()) { setError('Trial name is required.'); return }

    setCreating(true)
    try {
      const res = await fetch('/att/api/trials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId,
          name: name.trim(),
          date,
          visibility,
          participation,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to create trial')
      }
      const trial = await res.json()
      router.push(`/att/admin/trials/${trial.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setCreating(false)
    }
  }

  const inputClass = 'bg-bg border border-border px-3 py-2 text-fg text-sm focus:outline-none focus:border-primary transition-colors'

  const selectedCourse = courses?.find(c => c.id === courseId)

  return (
    <div className="flex-1 px-4 py-8 max-w-2xl mx-auto w-full">
      <h1 className="text-lg font-bold text-fg tracking-widest mb-8">CREATE TIME TRIAL</h1>

      <form onSubmit={submit} className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <label className="text-xs text-muted tracking-widest">COURSE</label>
          {courses === null ? (
            <div className="text-xs text-muted py-2">Loading courses…</div>
          ) : courses.length === 0 ? (
            <div className="border border-border bg-surface px-3 py-3 text-xs text-muted">
              No courses yet.{' '}
              <Link href="/att/admin/courses/new" className="tt-link">
                Create one
              </Link>{' '}
              to get started.
            </div>
          ) : (
            <>
              <select
                required
                value={courseId}
                onChange={e => setCourseId(e.target.value)}
                className={inputClass}
              >
                <option value="">— Select a course —</option>
                {courses.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.sport}, {c.distanceMetres.toLocaleString()} m)
                  </option>
                ))}
              </select>
              {selectedCourse && (
                <p className="text-xs text-muted">
                  <Link href={`/att/courses/${selectedCourse.id}`} className="tt-link">
                    View course details
                  </Link>{' '}
                  · or{' '}
                  <Link href="/att/admin/courses/new" className="tt-link">
                    create a new course
                  </Link>
                </p>
              )}
              {!selectedCourse && (
                <p className="text-xs text-muted">
                  Or{' '}
                  <Link href="/att/admin/courses/new" className="tt-link">
                    create a new course
                  </Link>{' '}
                  if yours isn&apos;t listed.
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted tracking-widest">TRIAL NAME</label>
          <input
            type="text"
            required
            placeholder="e.g. Spring Sprint 2025"
            value={name}
            onChange={e => setName(e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted tracking-widest">DATE</label>
          <input
            type="date"
            required
            value={date}
            onChange={e => setDate(e.target.value)}
            className={`${inputClass} cursor-pointer`}
          />
          <p className="text-xs text-muted">When the trial takes place. Defaults to today.</p>
        </div>

        {/* Visibility. The trial's scope can't exceed its course's: group
            courses force group; private courses force private. The server
            clamps anyway, but we visually disable to make it obvious. */}
        <div className="flex flex-col gap-2">
          <label className="text-xs text-muted tracking-widest">VISIBILITY</label>
          <div className="flex gap-2">
            {(['public', 'private', 'group'] as const).map(v => {
              const courseLocksTo =
                selectedCourse?.visibility === 'private' ? 'private'
                : selectedCourse?.visibility === 'group' ? 'group'
                : null
              const disabled = !!courseLocksTo && v !== courseLocksTo
              const active = (courseLocksTo ?? visibility) === v
              return (
                <button
                  key={v}
                  type="button"
                  disabled={disabled}
                  onClick={() => { if (!disabled) setVisibility(v) }}
                  className={`px-4 py-2 text-xs tracking-widest border transition-colors ${
                    active
                      ? 'border-primary text-primary bg-primary/10'
                      : 'border-border text-muted hover:border-muted'
                  } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  {v === 'group' ? 'GROUP' : v.toUpperCase()}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-muted">
            {selectedCourse?.visibility === 'private'
              ? 'This course is private, so any trial on it must be private too.'
              : selectedCourse?.visibility === 'group'
                ? 'This course is scoped to its group, so the trial is too.'
                : visibility === 'public'
                  ? 'The leaderboard will be visible to anyone.'
                  : visibility === 'group'
                    ? 'Only the course’s group members can see the trial.'
                    : 'Only you can see this trial and its leaderboard.'}
          </p>
        </div>

        {/* Participation (phase 3). Members = anyone in the course's group;
            invitational = only users you invite; public = anyone who can view.
            The organiser can always submit. */}
        <div className="flex flex-col gap-2">
          <label className="text-xs text-muted tracking-widest">WHO CAN SUBMIT</label>
          <div className="flex gap-2">
            {(['members', 'invitational', 'public'] as const).map(v => (
              <button
                key={v}
                type="button"
                onClick={() => setParticipation(v)}
                className={`px-4 py-2 text-xs tracking-widest border transition-colors ${
                  participation === v
                    ? 'border-primary text-primary bg-primary/10'
                    : 'border-border text-muted hover:border-muted'
                }`}
              >
                {v.toUpperCase()}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">
            {participation === 'members'
              ? 'Members of this course’s group can submit a trace.'
              : participation === 'invitational'
                ? 'You will choose who can submit after the trial is created.'
                : 'Anyone who can see the trial can submit a trace.'}
          </p>
        </div>

        {error && (
          <div className="border border-red bg-red/10 px-3 py-2 text-red text-xs">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={creating || !courses || courses.length === 0}
          className="px-6 py-2.5 bg-primary text-white font-bold text-sm tracking-widest hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors self-start"
        >
          {creating ? 'CREATING…' : 'CREATE TRIAL'}
        </button>
      </form>
    </div>
  )
}

export default function NewTrialPage() {
  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={
          <>
            <Link href="/att" className="tt-nav-link text-sm">
              ← HOME
            </Link>
            <span className="text-muted">/</span>
            <span className="text-fg text-sm">NEW TRIAL</span>
          </>
        }
      />
      <Suspense fallback={null}>
        <NewTrialForm />
      </Suspense>
    </main>
  )
}
