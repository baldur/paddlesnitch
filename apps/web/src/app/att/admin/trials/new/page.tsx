'use client'
import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import { participationLabel } from '@paddlesnitch/core/format'
import { Page, PageHeader } from '@paddlesnitch/ui/Layout'
import { Button } from '@paddlesnitch/ui/Button'
import { Field, Segmented, inputClass, selectClass } from '@paddlesnitch/ui/Form'
import { cardClass } from '@paddlesnitch/ui/Card'

const whoCanEnterLabel = participationLabel
const WHO_CAN_SEE: Record<'public' | 'private' | 'group', string> = { public: 'Anyone', private: 'Only you', group: 'Group' }
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
      .catch(() => setError('Couldn’t load the courses. Please try again.'))
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
        throw new Error(data.error ?? 'Couldn’t create the trial. Please try again.')
      }
      const trial = await res.json()
      router.push(`/att/admin/trials/${trial.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setCreating(false)
    }
  }

  const selectedCourse = courses?.find(c => c.id === courseId)
  // The trial's scope can't exceed its course's: group courses force group;
  // private courses force private. The server clamps anyway.
  const courseLocksTo =
    selectedCourse?.visibility === 'private' ? 'private'
    : selectedCourse?.visibility === 'group' ? 'group'
    : null

  return (
    <Page width="narrow">
      <PageHeader title="New trial" />

      <form onSubmit={submit} className="flex flex-col gap-6">
        {courses === null ? (
          <Field label="Course"><p className="text-sm text-muted">Loading courses…</p></Field>
        ) : courses.length === 0 ? (
          <Field label="Course">
            <div className={`${cardClass} px-4 py-3 text-sm text-muted`}>
              No courses yet.{' '}
              <Link href="/att/admin/courses/new" className="tt-link">Draw one</Link> first.
            </div>
          </Field>
        ) : (
          <Field
            label="Course"
            htmlFor="trial-course"
            help={selectedCourse ? (
              <>
                <Link href={`/att/courses/${selectedCourse.id}`} className="tt-link">View the course</Link>
                {' '}or{' '}
                <Link href="/att/admin/courses/new" className="tt-link">draw a new one</Link>.
              </>
            ) : (
              <>
                Not listed?{' '}
                <Link href="/att/admin/courses/new" className="tt-link">Draw a new course</Link>.
              </>
            )}
          >
            <select
              id="trial-course"
              required
              value={courseId}
              onChange={e => setCourseId(e.target.value)}
              className={selectClass}
            >
              <option value="">Choose a course</option>
              {courses.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.sport}, {c.distanceMetres.toLocaleString()} m)
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Trial name" htmlFor="trial-name">
          <input
            id="trial-name"
            type="text"
            required
            placeholder="e.g. Spring Sprint 2025"
            value={name}
            onChange={e => setName(e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Date" htmlFor="trial-date" help="When the trial takes place.">
          <input
            id="trial-date"
            type="date"
            required
            value={date}
            onChange={e => setDate(e.target.value)}
            className={`${inputClass} cursor-pointer`}
          />
        </Field>

        <Field
          label="Who can see it"
          help={selectedCourse?.visibility === 'private'
            ? 'The course is private, so any trial on it is private too.'
            : selectedCourse?.visibility === 'group'
              ? 'The course is for its group only, so the trial is too.'
              : visibility === 'public'
                ? 'Anyone can see the trial and its leaderboard.'
                : visibility === 'group'
                  ? 'Only the course’s group members can see the trial.'
                  : 'Only you can see this trial and its leaderboard.'}
        >
          {courseLocksTo ? (
            <p className="text-base text-fg">{WHO_CAN_SEE[courseLocksTo]}</p>
          ) : (
            <Segmented
              label="Who can see it"
              value={visibility}
              onChange={setVisibility}
              options={(['public', 'private', 'group'] as const).map(v => ({ value: v, label: WHO_CAN_SEE[v] }))}
            />
          )}
        </Field>

        {/* Participation (phase 3). The organiser can always enter. */}
        <Field
          label="Who can enter"
          help={participation === 'members'
            ? 'Members of the course’s group can enter.'
            : participation === 'invitational'
              ? 'You choose who can enter after the trial is created.'
              : 'Anyone who can see the trial can enter.'}
        >
          <Segmented
            label="Who can enter"
            value={participation}
            onChange={setParticipation}
            options={(['members', 'invitational', 'public'] as const).map(v => ({ value: v, label: whoCanEnterLabel(v) }))}
          />
        </Field>

        {error && (
          <p role="alert" className="rounded-control border border-red/50 bg-red/10 px-3 py-2 text-red text-sm">{error}</p>
        )}

        <Button
          type="submit"
          variant="primary"
          disabled={creating || !courses || courses.length === 0}
          className="self-start"
        >
          {creating ? 'Creating…' : 'Create trial'}
        </Button>
      </form>
    </Page>
  )
}

export default function NewTrialPage() {
  return (
    <main className="flex-1 flex flex-col">
      <AppHeader breadcrumb={<Link href="/att" className="tt-nav-link">← Trials</Link>} />
      <Suspense fallback={null}>
        <NewTrialForm />
      </Suspense>
    </main>
  )
}
