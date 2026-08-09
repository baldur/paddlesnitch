'use client'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import LoadingState from '@/components/LoadingState'
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
      if (!res.ok) throw new Error(data.error ?? 'Failed to save')

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
        throw new Error(data.error ?? 'Failed to create trial')
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

  const inputClass = 'bg-bg border border-border px-3 py-2 text-fg text-sm focus:outline-none focus:border-primary transition-colors'

  // For the DrawingMap default center we use the midpoint of the existing
  // start line so the map opens already showing the course geometry.
  const editCenter: LatLng = course.startLine
    ? midpoint(course.startLine)
    : course.gates?.[0]?.line
      ? midpoint(course.gates[0].line)
      : [51.45, -0.98]

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={
          <>
            <Link href="/att" className="tt-nav-link text-sm shrink-0">
              ← HOME
            </Link>
            <span className="text-muted shrink-0">/</span>
            <span className="text-fg text-sm truncate">{course.name.toUpperCase()}</span>
          </>
        }
      />

      <div className="flex-1 px-4 py-8 max-w-3xl mx-auto w-full space-y-10">
        {/* Course details — read-only by default. Click "Edit details" to
            mutate name / sport / geometry. Visibility flip stays accessible
            at all times because it's a common one-click operation. */}
        <section>
          <div className="flex items-start justify-between gap-4 mb-1">
            <h1 className="text-lg font-bold text-fg tracking-widest">
              {course.name.toUpperCase()}
            </h1>
            <div className="flex flex-col items-end gap-2">
              <span
                className={`text-xs px-2 py-0.5 border ${
                  course.visibility === 'public'
                    ? 'border-green text-green'
                    : 'border-muted text-muted'
                }`}
              >
                {course.visibility.toUpperCase()}
              </span>
              <button
                type="button"
                onClick={toggleVisibility}
                className="px-3 py-1 text-xs font-bold tracking-widest border border-border text-muted hover:border-primary hover:text-primary transition-colors"
              >
                {course.visibility === 'public' ? '→ MAKE PRIVATE' : '→ MAKE PUBLIC'}
              </button>
              {!editing && (
                <button
                  type="button"
                  onClick={startEdit}
                  className="px-3 py-1 text-xs font-bold tracking-widest border border-border text-muted hover:border-primary hover:text-primary transition-colors"
                >
                  EDIT DETAILS
                </button>
              )}
            </div>
          </div>
          <p className="text-xs text-muted mb-4">
            {course.sport.toUpperCase()} · {course.distanceMetres.toLocaleString()} M
            {course.type === 'loop' && ' · LOOP'}
            {course.type === 'gate' && ' · GATE'}
          </p>

          {editing ? (
            <div className="flex flex-col gap-4 border border-border p-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted tracking-widest">COURSE NAME</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted tracking-widest">SPORT</label>
                <select
                  value={editSport}
                  onChange={e => setEditSport(e.target.value as CourseMetadata['sport'])}
                  className={inputClass}
                >
                  <option value="kayak">Kayak</option>
                  <option value="rowing">Rowing</option>
                  <option value="both">Both</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted tracking-widest">
                  GEOMETRY ({course.type.replace('_', ' ')})
                </label>
                <p className="text-xs text-muted">
                  Existing lines are highlighted. Click on the map to re-draw any
                  segment; the previous segment will reset. Distance updates as you
                  draw. The course type can&apos;t be changed here — create a new
                  course if you need a different shape.
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
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted tracking-widest">DISTANCE (M)</label>
                  <input
                    type="number"
                    min={0}
                    value={editDistance ?? ''}
                    onChange={e => setEditDistance(e.target.value ? parseInt(e.target.value, 10) : null)}
                    className={inputClass}
                  />
                </div>
              )}

              {course.type === 'loop' && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted tracking-widest">MINIMUM VALID TIME (SECONDS) — OPTIONAL</label>
                  <input
                    type="number"
                    min={0}
                    value={editMinValid}
                    onChange={e => setEditMinValid(e.target.value)}
                    placeholder="e.g. 300"
                    className={inputClass}
                  />
                  <p className="text-xs text-muted">
                    Ignore results shorter than this. Useful for loops where warmup crossings could be mistaken for a race.
                  </p>
                </div>
              )}

              {trials.length > 0 && (
                <div className="border border-border bg-surface-2 px-3 py-2 text-fg text-xs">
                  This course already has trials. Editing the lines or course type
                  will create a NEW course (the original stays intact so historical
                  leaderboards aren&apos;t invalidated). Name and sport edits stay on
                  this course.
                </div>
              )}

              {editError && (
                <div className="border border-red bg-red/10 px-3 py-2 text-red text-xs">
                  {editError}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={saving}
                  className="px-4 py-2 bg-primary text-white font-bold text-xs tracking-widest hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? 'SAVING…' : 'SAVE CHANGES'}
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={saving}
                  className="px-4 py-2 border border-border text-muted text-xs tracking-widest hover:bg-surface-2 disabled:opacity-50 transition-colors"
                >
                  CANCEL
                </button>
              </div>
            </div>
          ) : (
            <CourseMap course={course} />
          )}
        </section>

        <section>
          <h2 className="text-xs text-muted tracking-[0.2em] uppercase mb-4">
            Time Trials
          </h2>
          {sortedTrials.length === 0 ? (
            <div className="border border-border p-6 text-center text-muted text-sm">
              No trials yet.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {sortedTrials.map(t => (
                <a
                  key={t.id}
                  href={`/att/admin/trials/${t.id}`}
                  className="border border-border px-4 py-3 flex items-center justify-between hover:border-primary transition-colors group"
                >
                  <div>
                    <div className="text-fg text-sm group-hover:text-primary transition-colors">
                      {t.name}
                    </div>
                    <div className="text-xs text-muted mt-0.5">{t.date}</div>
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 border ${
                      t.status === 'open'
                        ? 'border-green text-green'
                        : 'border-muted text-muted'
                    }`}
                  >
                    {t.status.toUpperCase()}
                  </span>
                </a>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-xs text-muted tracking-[0.2em] uppercase mb-4">
            New Time Trial
          </h2>
          <form onSubmit={createTrial} className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted tracking-widest">TRIAL NAME</label>
                <input
                  type="text"
                  required
                  value={trialName}
                  onChange={e => setTrialName(e.target.value)}
                  placeholder="e.g. Spring 2025"
                  className={inputClass}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted tracking-widest">DATE</label>
                <input
                  type="date"
                  required
                  value={trialDate}
                  onChange={e => setTrialDate(e.target.value)}
                  className={`${inputClass} cursor-pointer`}
                />
                <p className="text-xs text-muted">Click to open calendar</p>
              </div>
            </div>
            {error && (
              <div className="border border-red bg-red/10 px-3 py-2 text-red text-xs">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={creating}
              className="px-6 py-2.5 bg-primary text-white font-bold text-sm tracking-widest hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors self-start"
            >
              {creating ? 'CREATING…' : 'CREATE TRIAL'}
            </button>
          </form>
        </section>
      </div>
    </main>
  )
}
