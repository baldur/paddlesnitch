'use client'
import Link from 'next/link'
import { useEffect, useState, use } from 'react'
import AppHeader from '@/components/AppHeader'
import CourseMapClient from '@/components/map/CourseMapClient'
import LoadingState from '@/components/LoadingState'
import ViewOnStrava from '@/components/strava/ViewOnStrava'
import { formatTime } from '@/lib/geo'
import type { CourseMetadata, CrewMember, Split, EntryConditions, LatLng } from '@/lib/types'

type EntryDetail = {
  entry: {
    entryId: string
    userId: string
    displayName: string
    raceDate: string
    submittedAt: string
    boatClass: string
    crew: CrewMember[]
    totalElapsedSeconds: number
    splits: Split[]
    runCount?: number
    avgStrokeRate?: number
    trackSegment?: LatLng[]
    conditions?: EntryConditions
    stravaActivityId?: number
    note?: string
  }
  isOwner: boolean
  trial: { id: string; name: string; date: string; status: string }
  course: CourseMetadata | null
}

function compass(deg: number): string {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((deg % 360) + 360) % 360) / 45) % 8]
}

export default function EntryDetailPage({ params }: { params: Promise<{ entryId: string }> }) {
  const { entryId } = use(params)
  const [data, setData] = useState<EntryDetail | null | undefined>(undefined)
  const [note, setNote] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteMsg, setNoteMsg] = useState('')

  useEffect(() => {
    fetch(`/att/api/entries/${entryId}`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: EntryDetail | null) => {
        setData(d)
        if (d?.entry.note != null) setNote(d.entry.note)
      })
      .catch(() => setData(null))
  }, [entryId])

  const saveNote = async () => {
    setNoteSaving(true)
    setNoteMsg('')
    try {
      const res = await fetch(`/att/api/entries/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      })
      if (!res.ok) throw new Error('Could not save')
      setNoteMsg('Saved.')
    } catch {
      setNoteMsg('Could not save your note.')
    } finally {
      setNoteSaving(false)
    }
  }

  if (data === undefined) return <main className="flex-1"><LoadingState className="py-16" /></main>
  if (!data) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center gap-4 px-4">
        <p className="text-sm text-muted">This entry doesn&apos;t exist, or you can&apos;t see it.</p>
        <Link href="/att" className="tt-nav-link text-xs tracking-widest">← HOME</Link>
      </main>
    )
  }

  const { entry, isOwner, trial, course } = data
  const hasCox = !!entry.crew.find(c => c.seat === 'C')

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={
          <>
            <Link href={`/att/trials/${trial.id}`} className="tt-nav-link text-sm shrink-0">← {trial.name.toUpperCase()}</Link>
            <span className="text-muted shrink-0">/</span>
            <span className="text-fg text-sm truncate">ENTRY</span>
          </>
        }
      />

      <div className="flex-1 px-4 py-8 max-w-2xl mx-auto w-full space-y-8">
        <section>
          <div className="text-xs text-muted tracking-widest mb-1">
            <Link href={`/att/trials/${trial.id}`} className="tt-link">{trial.name}</Link> · {entry.raceDate}
          </div>
          <h1 className="text-lg font-bold text-fg tracking-widest">{entry.displayName.toUpperCase()}</h1>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="text-3xl font-bold text-primary tabular">{formatTime(entry.totalElapsedSeconds)}</span>
            <span className="text-xs text-muted tabular">{entry.boatClass}{course ? ` · ${course.distanceMetres.toLocaleString()} m` : ''}{entry.avgStrokeRate != null ? ` · ${entry.avgStrokeRate} spm avg` : ''}</span>
          </div>
          {entry.runCount && entry.runCount > 1 && (
            <p className="text-xs text-muted mt-1">Best of {entry.runCount} runs in this upload.</p>
          )}
          {entry.stravaActivityId != null && (
            <p className="text-xs text-muted mt-1">Imported from Strava · <ViewOnStrava activityId={entry.stravaActivityId} className="tt-link" /></p>
          )}
        </section>

        {entry.crew.length > 1 && (
          <section>
            <h2 className="text-xs text-muted tracking-[0.2em] uppercase mb-2">Crew</h2>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {entry.crew.map(m => (
                <span key={String(m.seat)}>
                  <span className="text-muted mr-1 tabular">{m.seat === 'C' ? 'Cox' : m.seat}</span>
                  <span className="text-fg">{m.name}</span>
                </span>
              ))}
            </div>
            <span className="sr-only">{hasCox ? 'includes cox' : ''}</span>
          </section>
        )}

        {entry.conditions && (
          <section>
            <h2 className="text-xs text-muted tracking-[0.2em] uppercase mb-2">Conditions at finish</h2>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-fg tabular">
              {entry.conditions.weather?.temperatureC != null && <span><span className="text-muted mr-1">temp</span>{entry.conditions.weather.temperatureC.toFixed(1)}°C</span>}
              {entry.conditions.weather?.windSpeedKmh != null && (
                <span><span className="text-muted mr-1">wind</span>{entry.conditions.weather.windSpeedKmh.toFixed(0)} km/h{entry.conditions.weather.windDirectionDeg != null && ` ${compass(entry.conditions.weather.windDirectionDeg)}`}</span>
              )}
              {entry.conditions.weather?.precipitationMm != null && <span><span className="text-muted mr-1">rain</span>{entry.conditions.weather.precipitationMm.toFixed(1)} mm</span>}
              {entry.conditions.flow?.valueM3s != null && (
                <span><span className="text-muted mr-1">flow</span>{entry.conditions.flow.valueM3s.toFixed(1)} m³/s{entry.conditions.flow.stationLabel && <span className="text-muted"> · {entry.conditions.flow.stationLabel}</span>}</span>
              )}
            </div>
          </section>
        )}

        {course && entry.trackSegment && entry.trackSegment.length > 0 && (
          <section>
            <h2 className="text-xs text-muted tracking-[0.2em] uppercase mb-2">Track</h2>
            <CourseMapClient course={course} track={entry.trackSegment} />
          </section>
        )}

        {entry.splits.length > 0 && (
          <section>
            <h2 className="text-xs text-muted tracking-[0.2em] uppercase mb-2">500 m splits</h2>
            <table className="text-sm border-collapse tabular">
              <thead>
                <tr className="text-muted tracking-wider text-xs">
                  <th className="text-left pr-8 py-1 font-normal">MARK</th>
                  <th className="text-right py-1 font-normal">ELAPSED</th>
                </tr>
              </thead>
              <tbody>
                {entry.splits.map(s => (
                  <tr key={s.distance} className="border-t border-surface-2">
                    <td className="pr-8 py-1.5 text-fg">{s.distance.toLocaleString()} m</td>
                    <td className="py-1.5 text-right text-split">{formatTime(s.elapsedSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* Private note — owner only. */}
        {isOwner && (
          <section className="border-t border-border pt-6">
            <h2 className="text-xs text-muted tracking-[0.2em] uppercase mb-1">Your note</h2>
            <p className="text-xs text-muted mb-3">
              🔒 Only you can see this. Jot down how the race felt, kit, tactics — anything.
            </p>
            <textarea
              value={note}
              onChange={e => { setNote(e.target.value); setNoteMsg('') }}
              maxLength={2000}
              rows={4}
              placeholder="Add a private note about this race…"
              className="w-full bg-bg border border-border px-3 py-2 text-fg text-sm focus:outline-none focus:border-primary transition-colors resize-y"
            />
            <div className="flex items-center gap-3 mt-2">
              <button
                type="button"
                onClick={saveNote}
                disabled={noteSaving}
                className="px-4 py-2 bg-primary text-white text-xs font-bold tracking-widest hover:bg-primary disabled:opacity-50 transition-colors"
              >
                {noteSaving ? 'SAVING…' : 'SAVE NOTE'}
              </button>
              {noteMsg && <span className="text-xs text-muted">{noteMsg}</span>}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
