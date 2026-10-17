'use client'
import { fmtDay, sportLabel } from '@paddlesnitch/core/format'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import LoadingState from '@/components/LoadingState'
import { Page, PageHeader, Section } from '@paddlesnitch/ui/Layout'
import { Button } from '@paddlesnitch/ui/Button'
import { Field, inputClass, selectClass } from '@paddlesnitch/ui/Form'
import { Badge, Chevron, cardClass, cardLinkClass } from '@paddlesnitch/ui/Card'
import { haversine } from '@/lib/geo'
import type { CourseMetadata, TrialMetadata, Line, LatLng } from '@/lib/types'

const CourseMap = dynamic(() => import('@/components/map/CourseMap'), { ssr: false })
const DrawingMap = dynamic(() => import('@/components/map/DrawingMap'), { ssr: false })

type GateData = Array<{ line: Line; direction: 1 | -1 }>
type MapState = {
  startLine?: Line
  finishLine?: Line
  gates?: GateData
}

// Course distance is auto-derived for point_to_point and gate courses
// from the line midpoints; loops are user-supplied because there's no
// straight-line span to measure. Mirrors the create-course form.
const midpoint = (line: Line): LatLng => [(line[0][0] + line[1][0]) / 2, (line[0][1] + line[1][1]) / 2]

const sportName = sportLabel

export default function CourseAdminPage({
  params,
}: {
  params: Promise<{ courseId: string }>
}) {
  const { courseId } = use(params)
  const router = useRouter()
  const [course, setCourse] = useState<CourseMetadata | null>(null)
  const [trials, setTrials] = useState<TrialMetadata[]>([])
  const [trialName, setTrialName] = useState('')
  const [trialDate, setTrialDate] = useState(() => new Date().toISOString().split('T')[0])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  // Edit-details state. Initialised from `course` when the user clicks
  // "Edit details"; cleared when they Save or Cancel. Keeping it nested
  // inside the page (no separate child component) so the existing
  // page-level Loading guard covers it.
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editSport, setEditSport] = useState<CourseMetadata['sport']>('kayak')
  const [editDistance, setEditDistance] = useState<number | null>(null)
  const [editStartLine, setEditStartLine] = useState<Line | undefined>()
  const [editFinishLine, setEditFinishLine] = useState<Line | undefined>()
  const [editGates, setEditGates] = useState<GateData | undefined>()
  const [editMinValid, setEditMinValid] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState('')

  useEffect(() => {
    fetch(`/att/api/courses/${courseId}`)
      .then(r => r.json())
      .then(setCourse)
    fetch(`/att/api/trials?courseId=${courseId}`)
      .then(r => r.json())
      .then(setTrials)
  }, [courseId])

  const startEdit = () => {
    if (!course) return
    setEditName(course.name)
    setEditSport(course.sport)
    setEditDistance(course.distanceMetres)
    setEditStartLine(course.startLine)
    setEditFinishLine(course.finishLine)
    setEditGates(course.gates)
    setEditMinValid(course.minValidSeconds != null ? String(course.minValidSeconds) : '')
    setEditError('')
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
    setEditError('')
  }

  // Pull the latest geometry up from DrawingMap. Distance is re-derived
  // for the point_to_point and gate cases; for loops the user types it
  // in directly via the editDistance input.
  const onMapChange = (state: MapState) => {
    setEditStartLine(state.startLine)
    setEditFinishLine(state.finishLine)
    setEditGates(state.gates)
    if (!course) return
    const t = course.type
    if (t === 'point_to_point' && state.startLine && state.finishLine) {
      setEditDistance(Math.round(haversine(midpoint(state.startLine), midpoint(state.finishLine))))
    } else if (t === 'gate' && state.gates && state.gates.length >= 2) {
      const first = state.gates[0].line
      const last = state.gates[state.gates.length - 1].line
      setEditDistance(Math.round(haversine(midpoint(first), midpoint(last))))
    }
  }

  const saveEdit = async () => {
    if (!course) return
    setEditError('')
    if (!editName.trim()) { setEditError('Name is required.'); return }

    setSaving(true)
    try {
      const patch: Record<string, unknown> = {
        name: editName.trim(),
        sport: editSport,
      }
      // Geometry — only send the fields relevant to this course's type
      // so we don't accidentally trigger an unrelated change.
      if (course.type === 'point_to_point') {
        if (editStartLine) patch.startLine = editStartLine
        if (editFinishLine) patch.finishLine = editFinishLine
        if (editDistance != null) patch.distanceMetres = editDistance
      } else if (course.type === 'gate') {
        if (editGates) patch.gates = editGates
        if (editDistance != null) patch.distanceMetres = editDistance
      } else if (course.type === 'loop') {
        if (editStartLine) patch.startLine = editStartLine
        if (editDistance != null) patch.distanceMetres = editDistance
        if (editMinValid.trim()) patch.minValidSeconds = parseInt(editMinValid.trim(), 10)
      }

      const res = await fetch(`/att/api/courses/${courseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json()
      // Geometry edits on a course with entries return 409 (locked) — the
      // error message is surfaced below. Name/visibility/sport still succeed.
      if (!res.ok) throw new Error(data.error ?? 'Couldn’t save. Please try again.')

      setCourse(data)
      setEditing(false)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  const toggleVisibility = async () => {
    if (!course) return
    const next = course.visibility === 'public' ? 'private' : 'public'
    const updated = await fetch(`/att/api/courses/${courseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility: next }),
    }).then(r => r.json())
    setCourse(updated)
  }

  const createTrial = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setCreating(true)
    try {
      const res = await fetch('/att/api/trials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, name: trialName, date: trialDate }),
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

  if (!course) {
    return (
      <main className="flex-1 flex">
        <LoadingState />
      </main>
    )
  }

  const sortedTrials = [...trials].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )

  // For the DrawingMap default center we use the midpoint of the existing
  // start line so the map opens already showing the course geometry.
  const editCenter: LatLng = course.startLine
    ? midpoint(course.startLine)
    : course.gates?.[0]?.line
      ? midpoint(course.gates[0].line)
      : [51.45, -0.98]

  const typeLabel = course.type === 'loop' ? 'loop' : course.type === 'gate' ? 'gates' : 'point to point'

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={<Link href={`/att/courses/${course.id}`} className="tt-nav-link">← Course page</Link>}
      />

      <Page>
        {/* Read-only by default; Edit details opens the form. Visibility flip
            stays one click away because it's a common operation. */}
        <PageHeader
          title={course.name}
          description={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>{sportName(course.sport)} · <span className="tabular">{course.distanceMetres.toLocaleString()} m</span> · {typeLabel}</span>
              <Badge tone={course.visibility === 'public' ? 'green' : 'neutral'}>
                {course.visibility === 'public' ? 'Public' : course.visibility === 'group' ? 'Group only' : 'Private'}
              </Badge>
            </span>
          }
          actions={
            <>
              {!editing && <Button onClick={startEdit}>Edit details</Button>}
              <Button variant="quiet" onClick={toggleVisibility}>
                {course.visibility === 'public' ? 'Make private' : 'Make public'}
              </Button>
            </>
          }
        />

        {editing ? (
          <div className={`${cardClass} flex flex-col gap-5 p-4`}>
            <Field label="Course name" htmlFor="edit-name">
              <input
                id="edit-name"
                type="text"
                required
                value={editName}
                onChange={e => setEditName(e.target.value)}
                className={inputClass}
              />
            </Field>

            <Field label="Sport" htmlFor="edit-sport">
              <select
                id="edit-sport"
                value={editSport}
                onChange={e => setEditSport(e.target.value as CourseMetadata['sport'])}
                className={selectClass}
              >
                <option value="kayak">Kayak</option>
                <option value="rowing">Rowing</option>
                <option value="both">Both</option>
              </select>
            </Field>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-fg">Course lines ({typeLabel})</span>
              <p className="text-sm text-muted">
                Tap a line&apos;s button to draw it again; the distance updates as you draw.
                To change the course type, draw a new course.
              </p>
              <DrawingMap
                onChange={onMapChange}
                courseType={course.type === 'point_to_point' || course.type === 'loop' || course.type === 'gate' ? course.type : 'point_to_point'}
                defaultCenter={editCenter}
                initialStartLine={course.startLine}
                initialFinishLine={course.finishLine}
                initialGates={course.gates}
              />
            </div>

            {course.type === 'loop' && (
              <Field label="Distance in metres" htmlFor="edit-distance">
                <input
                  id="edit-distance"
                  type="number"
                  min={0}
                  value={editDistance ?? ''}
                  onChange={e => setEditDistance(e.target.value ? parseInt(e.target.value, 10) : null)}
                  className={inputClass}
                />
              </Field>
            )}

            {course.type === 'loop' && (
              <Field label="Minimum time in seconds (optional)" htmlFor="edit-min-time" help="Results shorter than this are ignored, so warm-up crossings don't count.">
                <input
                  id="edit-min-time"
                  type="number"
                  min={0}
                  value={editMinValid}
                  onChange={e => setEditMinValid(e.target.value)}
                  placeholder="e.g. 300"
                  className={inputClass}
                />
              </Field>
            )}

            {trials.length > 0 && (
              <p className="rounded-control border border-border bg-surface-2 px-3 py-2 text-fg text-sm">
                Once a course has results its lines can&apos;t change, so past results stay valid.
                You can still change its name, sport and who can see it.
              </p>
            )}

            {editError && (
              <p role="alert" className="rounded-control border border-red/50 bg-red/10 px-3 py-2 text-red text-sm">{editError}</p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={saveEdit} disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
              <Button variant="quiet" onClick={cancelEdit} disabled={saving}>Cancel</Button>
            </div>
          </div>
        ) : (
          <CourseMap course={course} />
        )}

        <Section title="Trials">
          {sortedTrials.length === 0 ? (
            <p className="text-sm text-muted">No trials yet. Open the first one below.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {sortedTrials.map(t => (
                <li key={t.id}>
                  <a
                    href={`/att/admin/trials/${t.id}`}
                    className={`${cardLinkClass} flex items-center gap-3 px-4 py-3 min-h-11`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-medium text-fg">{t.name}</div>
                      <div className="text-sm text-muted mt-0.5">{fmtDay(t.date)}</div>
                    </div>
                    <Badge tone={t.status === 'open' ? 'green' : 'neutral'}>{t.status === 'open' ? 'Open' : 'Closed'}</Badge>
                    <Chevron />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Open a trial">
          <form onSubmit={createTrial} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Trial name" htmlFor="new-trial-name">
                <input
                  id="new-trial-name"
                  type="text"
                  required
                  value={trialName}
                  onChange={e => setTrialName(e.target.value)}
                  placeholder="e.g. Spring 2025"
                  className={inputClass}
                />
              </Field>
              <Field label="Date" htmlFor="new-trial-date">
                <input
                  id="new-trial-date"
                  type="date"
                  required
                  value={trialDate}
                  onChange={e => setTrialDate(e.target.value)}
                  className={`${inputClass} cursor-pointer`}
                />
              </Field>
            </div>
            {error && (
              <p role="alert" className="rounded-control border border-red/50 bg-red/10 px-3 py-2 text-red text-sm">{error}</p>
            )}
            <Button type="submit" variant={editing ? 'secondary' : 'primary'} disabled={creating} className="self-start">
              {creating ? 'Creating…' : 'Create trial'}
            </Button>
          </form>
        </Section>
      </Page>
    </main>
  )
}
