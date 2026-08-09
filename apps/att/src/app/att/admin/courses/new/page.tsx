'use client'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
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
  detail: string
}

const COURSE_TYPES: CourseTypeOption[] = [
  {
    value: 'point_to_point',
    label: 'Point to Point',
    linesLabel: '2 lines',
    summary: 'Separate start and finish at different locations.',
    detail: 'Draw a start line and a finish line. The clock starts when the athlete crosses the start line and stops when they cross the finish line. Use this for straight stretches of river where start and finish are in different places.',
  },
  {
    value: 'loop',
    label: 'Loop',
    linesLabel: '1 line',
    summary: 'Cross the same line twice — go out, do your course, come back through.',
    detail: 'Draw one line. The clock starts when the athlete crosses it for the first time and stops the next time they cross it, regardless of direction. Works for out-and-back courses, circular loops, or any course where athletes return through the same line. Set a minimum time to filter out false starts from warmup crossings.',
  },
  {
    value: 'gate',
    label: 'Gate',
    linesLabel: '2+ gates',
    summary: 'Ordered gates each with a crossing direction — proves athletes navigated the full course correctly.',
    detail: 'Add a start gate and finish gate (minimum), plus any intermediate gates around turning buoys. Each gate is a drawn line with a direction; athletes must cross every gate in the defined direction, in order. The clock starts at gate 1 and stops at the last gate. Athletes who miss a gate or cross in the wrong direction are automatically disqualified.',
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
        throw new Error(data.error ?? 'Failed to create course')
      }
      const course = await res.json()
      router.push(`/att/admin/courses/${course.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setSaving(false)
    }
  }

  const inputClass = 'bg-bg border border-border px-3 py-2 text-fg text-sm focus:outline-none focus:border-primary transition-colors'
  const selectedType = COURSE_TYPES.find(t => t.value === courseType)!

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={
          <>
            <Link href="/att" className="tt-nav-link text-sm">
              ← HOME
            </Link>
            <span className="text-muted">/</span>
            <span className="text-fg text-sm">NEW COURSE</span>
          </>
        }
      />

      <div className="flex-1 px-4 py-8 max-w-2xl mx-auto w-full">
        <h1 className="text-lg font-bold text-fg tracking-widest mb-8">CREATE COURSE</h1>

        {groups !== null && groups.length === 0 ? (
          // No group → no creation (phase 2). Point the would-be organiser at
          // the "create a group" on-ramp instead of a form they can't submit.
          <div className="border border-border bg-surface p-8 text-center flex flex-col gap-4">
            <p className="text-sm font-bold text-fg tracking-widest">CREATE A GROUP FIRST</p>
            <p className="text-xs text-muted leading-relaxed">
              Courses belong to a group — a club, a squad, or just you. Create one to start
              organising; you’ll be its admin and can add courses and open trials on them.
            </p>
            <div>
              <Link
                href="/att/groups"
                className="inline-block px-6 py-2.5 bg-primary text-white font-bold text-sm tracking-widest hover:bg-primary transition-colors"
              >
                + NEW GROUP
              </Link>
            </div>
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          {/* Name */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted tracking-widest">COURSE NAME</label>
            <input ref={nameRef} type="text" required placeholder="e.g. Thames — Henley Reach" className={inputClass} />
          </div>

          {/* Sport */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted tracking-widest">SPORT</label>
            <select ref={sportRef} required className={inputClass}>
              <option value="kayak">Kayak</option>
              <option value="rowing">Rowing</option>
              <option value="both">Both</option>
            </select>
          </div>

          {/* Group — the owning group (phase 2). Defaults to the user's only group. */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted tracking-widest">GROUP</label>
            <select value={groupId} onChange={e => setGroupId(e.target.value)} required className={inputClass}>
              <option value="">{groups === null ? 'Loading…' : '— Pick a group —'}</option>
              {(groups ?? []).map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            <p className="text-xs text-muted">The group that owns this course. Its admins can edit it and open trials on it.</p>
          </div>

          {/* Course type */}
          <div className="flex flex-col gap-2">
            <label className="text-xs text-muted tracking-widest">COURSE TYPE</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {COURSE_TYPES.map(t => (
                <label
                  key={t.value}
                  className={`flex flex-col gap-1.5 border p-3 cursor-pointer transition-colors ${
                    courseType === t.value
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-muted'
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
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-fg">{t.label}</span>
                    <span className="text-[10px] tracking-widest text-muted border border-border px-1.5 py-0.5 whitespace-nowrap">
                      {t.linesLabel}
                    </span>
                  </div>
                  <p className="text-xs text-muted">{t.summary}</p>
                </label>
              ))}
            </div>
            <div className="border border-border bg-surface px-3 py-3 text-xs text-muted leading-relaxed">
              <span className="font-bold text-fg">{selectedType.label}: </span>
              {selectedType.detail}
            </div>
          </div>

          {/* Map */}
          <div className="flex flex-col gap-2">
            <label className="text-xs text-muted tracking-widest">
              {isP2P ? 'START / FINISH LINES' : isGate ? 'GATES' : 'CROSSING LINE'}
            </label>
            <DrawingMap onChange={handleMapChange} courseType={courseType} />
            <div className="flex gap-4 text-xs flex-wrap">
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
                <span className="text-split">~{distanceMetres.toLocaleString()} m</span>
              )}
            </div>
          </div>

          {/* Gate courses: optionally validate the drawn gates against a real trace */}
          {isGate && gates && gates.length >= 2 && (
            <ReferenceTraceValidator geometry={{ type: 'gate', gates }} />
          )}

          {/* Manual distance (loop only) */}
          {courseType === 'loop' && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted tracking-widest">COURSE DISTANCE (METRES) — OPTIONAL</label>
              <input ref={distanceRef} type="number" min={0} placeholder="e.g. 1000" className={inputClass} />
              <p className="text-xs text-muted">Nominal course length shown on the leaderboard. Leave blank if unknown.</p>
            </div>
          )}

          {/* Minimum valid time */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted tracking-widest">MINIMUM VALID TIME (SECONDS) — OPTIONAL</label>
            <input ref={minValidSecondsRef} type="number" min={0} placeholder="e.g. 300" className={inputClass} />
            <p className="text-xs text-muted">
              Ignore results shorter than this. Useful for loop courses where warmup crossings could be mistaken for a race.
            </p>
          </div>

          {/* Visibility */}
          <div className="flex flex-col gap-2">
            <label className="text-xs text-muted tracking-widest">VISIBILITY</label>
            <div className="flex gap-2">
              {(['public', 'private', 'group'] as const).map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVisibility(v)}
                  className={`px-4 py-2 text-xs tracking-widest border transition-colors ${
                    visibility === v
                      ? 'border-primary text-primary bg-primary/10'
                      : 'border-border text-muted hover:border-muted'
                  }`}
                >
                  {v === 'group' ? 'MY GROUP' : v.toUpperCase()}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted">
              {visibility === 'public'
                ? 'Anyone can find this course. Group admins can open time trials on it.'
                : visibility === 'private'
                  ? 'Only you can see this course and the trials on it. You can change this later.'
                  : 'Only the owning group’s members can see this course and any trials on it.'}
            </p>
          </div>

          {error && (
            <div className="border border-red bg-red/10 px-3 py-2 text-red text-xs">{error}</div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 bg-primary text-white font-bold text-sm tracking-widest hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'SAVING…' : 'CREATE COURSE'}
          </button>
        </form>
        )}
      </div>
    </main>
  )
}
