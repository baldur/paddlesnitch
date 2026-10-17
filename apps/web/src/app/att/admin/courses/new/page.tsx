'use client'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import { Page, PageHeader } from '@paddlesnitch/ui/Layout'
import { Button, buttonClass } from '@paddlesnitch/ui/Button'
import { Field, Segmented, inputClass, selectClass } from '@paddlesnitch/ui/Form'
import { Badge, EmptyState } from '@paddlesnitch/ui/Card'
import ReferenceTraceValidator from '@/components/ReferenceTraceValidator'
import { haversine } from '@/lib/geo'
import type { LatLng, Line } from '@/lib/types'

const DrawingMap = dynamic(() => import('@/components/map/DrawingMap'), { ssr: false })

type CourseTypeInput = 'point_to_point' | 'loop' | 'gate'
type GateData = Array<{ line: Line; direction: 1 | -1 }>

type CourseTypeOption = {
  value: CourseTypeInput
  label: string
  linesLabel: string
  summary: string
}

const COURSE_TYPES: CourseTypeOption[] = [
  {
    value: 'point_to_point',
    label: 'Point to point',
    linesLabel: '2 lines',
    summary: 'A start line and a finish line in different places. The clock runs from one to the other.',
  },
  {
    value: 'loop',
    label: 'Loop',
    linesLabel: '1 line',
    summary: 'One line, crossed twice in either direction. For out-and-back courses and loops.',
  },
  {
    value: 'gate',
    label: 'Gate',
    linesLabel: '2+ gates',
    summary: 'Two or more gates, crossed in order and the right way. For courses round buoys.',
  },
]

const midpoint = (line: Line): LatLng => [(line[0][0] + line[1][0]) / 2, (line[0][1] + line[1][1]) / 2]

export default function NewCoursePage() {
  const router = useRouter()
  const [courseType, setCourseType] = useState<CourseTypeInput>('point_to_point')
  const [startLine, setStartLine] = useState<Line | undefined>()
  const [finishLine, setFinishLine] = useState<Line | undefined>()
  const [gates, setGates] = useState<GateData | undefined>()
  const [distanceMetres, setDistanceMetres] = useState<number | null>(null)
  const [visibility, setVisibility] = useState<'public' | 'private' | 'group'>('public')
  // Groups the user owns/admins. A course must belong to one of these (phase 2:
  // only group admins create courses). Fetched on mount; null = still loading.
  const [groups, setGroups] = useState<Array<{ id: string; name: string }> | null>(null)
  const [groupId, setGroupId] = useState<string>('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/att/api/groups?role=admin')
      .then(r => (r.ok ? r.json() : { groups: [] }))
      .then(data => {
        const gs: Array<{ id: string; name: string }> = data.groups ?? []
        setGroups(gs)
        if (gs.length === 1) setGroupId(gs[0].id) // sensible default
      })
      .catch(() => setGroups([]))
  }, [])

  const nameRef = useRef<HTMLInputElement>(null)
  const sportRef = useRef<HTMLSelectElement>(null)
  const distanceRef = useRef<HTMLInputElement>(null)
  const minValidSecondsRef = useRef<HTMLInputElement>(null)

  const isP2P = courseType === 'point_to_point'
  const isGate = courseType === 'gate'

  const handleMapChange = (state: { startLine?: Line; finishLine?: Line; gateDirection?: 1 | -1; gates?: GateData }) => {
    setStartLine(state.startLine)
    setFinishLine(state.finishLine)
    setGates(state.gates)
    if (isP2P && state.startLine && state.finishLine) {
      setDistanceMetres(Math.round(haversine(midpoint(state.startLine), midpoint(state.finishLine))))
    } else if (isGate && state.gates && state.gates.length >= 2) {
      const first = state.gates[0].line
      const last = state.gates[state.gates.length - 1].line
      setDistanceMetres(Math.round(haversine(midpoint(first), midpoint(last))))
    } else {
      setDistanceMetres(null)
    }
  }

  const handleTypeChange = (type: CourseTypeInput) => {
    setCourseType(type)
    setStartLine(undefined)
    setFinishLine(undefined)
    setGates(undefined)
    setDistanceMetres(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (isGate) {
      if (!gates || gates.length < 2) {
        setError('Draw all gate lines on the map before saving.')
        return
      }
    } else {
      if (!startLine) {
        setError(isP2P
          ? 'Draw both start and finish lines on the map before saving.'
          : 'Draw the crossing line on the map before saving.')
        return
      }
      if (isP2P && !finishLine) {
        setError('Draw the finish line on the map before saving.')
        return
      }
    }

    const name = nameRef.current?.value.trim()
    const sport = sportRef.current?.value
    if (!name || !sport) { setError('All fields are required.'); return }
    if (!groupId) { setError('Pick which group this course belongs to.'); return }

    const dist = courseType === 'loop'
      ? (distanceRef.current?.value ? parseInt(distanceRef.current.value, 10) : 0)
      : (distanceMetres ?? 0)

    setSaving(true)
    try {
      const res = await fetch('/att/api/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, sport,
          type: courseType,
          ...(isGate ? { gates } : { startLine }),
          ...(isP2P ? { finishLine } : {}),
          distanceMetres: dist,
          minValidSeconds: minValidSecondsRef.current?.value ? parseInt(minValidSecondsRef.current.value, 10) : undefined,
          groupId,
          visibility,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Couldn’t create the course. Please try again.')
      }
      const course = await res.json()
      router.push(`/att/admin/courses/${course.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setSaving(false)
    }
  }

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader breadcrumb={<Link href="/att/courses" className="tt-nav-link">← Courses</Link>} />

      <Page width="narrow">
        <PageHeader title="New course" />

        {groups !== null && groups.length === 0 ? (
          // No group → no creation (phase 2). Point the would-be organiser at
          // the "create a group" on-ramp instead of a form they can't submit.
          <EmptyState
            title="Create a group first"
            body="Courses belong to a group: a club, a squad, or just you. You'll be its admin and can add courses and open trials."
            action={<Link href="/att/groups#new-group" className={buttonClass('primary')}>New group</Link>}
          />
        ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <Field label="Course name" htmlFor="course-name">
            <input id="course-name" ref={nameRef} type="text" required placeholder="e.g. Thames, Henley Reach" className={inputClass} />
          </Field>

          <Field label="Sport" htmlFor="course-sport">
            <select id="course-sport" ref={sportRef} required className={selectClass}>
              <option value="kayak">Kayak</option>
              <option value="rowing">Rowing</option>
              <option value="both">Both</option>
            </select>
          </Field>

          {/* The owning group (phase 2). Defaults to the user's only group. */}
          <Field label="Group" htmlFor="course-group" help="Its admins can edit the course and open trials on it.">
            <select id="course-group" value={groupId} onChange={e => setGroupId(e.target.value)} required className={selectClass}>
              <option value="">{groups === null ? 'Loading…' : 'Choose a group'}</option>
              {(groups ?? []).map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </Field>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium text-fg mb-1.5">Course type</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {COURSE_TYPES.map(t => (
                <label
                  key={t.value}
                  className={`flex flex-col gap-1.5 rounded-control border p-3 cursor-pointer transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${
                    courseType === t.value
                      ? 'border-primary bg-primary/10'
                      : 'border-border-strong hover:bg-surface-2'
                  }`}
                >
                  <input
                    type="radio"
                    name="courseType"
                    value={t.value}
                    checked={courseType === t.value}
                    onChange={() => handleTypeChange(t.value)}
                    className="sr-only"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-base font-semibold text-fg">{t.label}</span>
                    <Badge>{t.linesLabel}</Badge>
                  </div>
                  <p className="text-sm text-muted">{t.summary}</p>
                </label>
              ))}
            </div>
            {courseType === 'loop' && (
              <p className="text-sm text-muted">Set a minimum time below so warm-up crossings don&apos;t count.</p>
            )}
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-fg">
              {isP2P ? 'Start and finish lines' : isGate ? 'Gates' : 'Crossing line'}
            </span>
            <DrawingMap onChange={handleMapChange} courseType={courseType} />
            <div className="flex gap-4 text-sm flex-wrap">
              {isGate ? (
                <span className={gates ? 'text-green' : 'text-muted'}>
                  {gates ? `✓ ${gates.length} gates set` : '○ Gates not complete'}
                </span>
              ) : (
                <>
                  <span className={startLine ? (isP2P ? 'text-green' : 'text-split') : 'text-muted'}>
                    {isP2P
                      ? (startLine ? '✓ Start line set' : '○ Start line not set')
                      : (startLine ? '✓ Crossing line set' : '○ Crossing line not set')}
                  </span>
                  {isP2P && (
                    <span className={finishLine ? 'text-red' : 'text-muted'}>
                      {finishLine ? '✓ Finish line set' : '○ Finish line not set'}
                    </span>
                  )}
                </>
              )}
              {distanceMetres != null && courseType !== 'loop' && (
                <span className="text-split tabular">~{distanceMetres.toLocaleString()} m</span>
              )}
            </div>
          </div>

          {/* Gate courses: optionally validate the drawn gates against a real trace */}
          {isGate && gates && gates.length >= 2 && (
            <ReferenceTraceValidator geometry={{ type: 'gate', gates }} />
          )}

          {courseType === 'loop' && (
            <Field label="Distance in metres (optional)" htmlFor="course-distance" help="Shown on the leaderboard. Leave blank if you don't know it.">
              <input id="course-distance" ref={distanceRef} type="number" min={0} placeholder="e.g. 1000" className={inputClass} />
            </Field>
          )}

          <Field label="Minimum time in seconds (optional)" htmlFor="course-min-time" help="Results shorter than this are ignored.">
            <input id="course-min-time" ref={minValidSecondsRef} type="number" min={0} placeholder="e.g. 300" className={inputClass} />
          </Field>

          <Field
            label="Who can see it"
            help={visibility === 'public'
              ? 'Anyone can find this course. Group admins can open trials on it.'
              : visibility === 'private'
                ? 'Only you can see this course and its trials. You can change this later.'
                : 'Only the group’s members can see this course and its trials.'}
          >
            <Segmented
              label="Who can see it"
              value={visibility}
              onChange={setVisibility}
              options={[
                { value: 'public', label: 'Anyone' },
                { value: 'private', label: 'Only you' },
                { value: 'group', label: 'Group' },
              ]}
            />
          </Field>

          {error && (
            <p role="alert" className="rounded-control border border-red/50 bg-red/10 px-3 py-2 text-red text-sm">{error}</p>
          )}

          <Button type="submit" variant="primary" disabled={saving} className="self-start">
            {saving ? 'Creating…' : 'Create course'}
          </Button>
        </form>
        )}
      </Page>
    </main>
  )
}
