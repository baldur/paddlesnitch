'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, use } from 'react'
import AppHeader from '@/components/AppHeader'
import { fmtDay } from '@paddlesnitch/core/format'
import { Page, PageHeader, Section, eyebrowClass } from '@paddlesnitch/ui/Layout'
import { Button, buttonClass } from '@paddlesnitch/ui/Button'
import { Stat, cardClass } from '@paddlesnitch/ui/Card'
import { inputClass } from '@paddlesnitch/ui/Form'
import { paceFor500m } from '@/lib/format'
import CourseMapClient from '@/components/map/CourseMapClient'
import LoadingState from '@/components/LoadingState'
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
  const router = useRouter()
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

  const [opening, setOpening] = useState(false)
  const [openErr, setOpenErr] = useState('')
  const openAsPaddle = async () => {
    if (!data) return
    setOpening(true); setOpenErr('')
    try {
      const fd = new FormData()
      fd.append('trialEntryId', data.entry.entryId)
      fd.append('trialId', data.trial.id)
      const res = await fetch('/paddles/api/analyse', { method: 'POST', body: fd })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.id) throw new Error()
      router.push(`/paddles/${d.id}`)
    } catch {
      setOpenErr('Couldn’t open it as a paddle. Please try again.')
      setOpening(false)
    }
  }

  const saveNote = async () => {
    setNoteSaving(true)
    setNoteMsg('')
    try {
      const res = await fetch(`/att/api/entries/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      })
      if (!res.ok) throw new Error('Couldn’t save. Please try again.')
      setNoteMsg('Saved.')
    } catch {
      setNoteMsg('Couldn’t save your note. Please try again.')
    } finally {
      setNoteSaving(false)
    }
  }

  if (data === undefined) return <main className="flex-1"><LoadingState className="py-16" /></main>
  if (!data) {
    return (
      <main className="flex-1 flex flex-col">
        <AppHeader />
        <Page width="narrow">
          <PageHeader title="We can't find this result" />
          <Link href="/att" className={buttonClass('secondary', 'md', 'self-start')}>Back to Trials</Link>
        </Page>
      </main>
    )
  }

  const { entry, isOwner, trial, course } = data
  const hasCox = !!entry.crew.find(c => c.seat === 'C')
  const leaderboardHref = `/att/trials/${trial.id}`

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={<Link href={leaderboardHref} className="tt-nav-link">← {trial.name}</Link>}
      />

      <Page>
        <PageHeader
          eyebrow={<>{trial.name} · {fmtDay(entry.raceDate)}</>}
          title={entry.displayName}
          description={entry.runCount && entry.runCount > 1 ? <>Best of {entry.runCount} runs in this upload.</> : undefined}
        />

        <div className={`${cardClass} p-4 grid grid-cols-2 sm:grid-cols-4 gap-4`}>
          <Stat label="Time" value={formatTime(entry.totalElapsedSeconds)} tone="primary" />
          <Stat label="Class" value={entry.boatClass} />
          {course && course.distanceMetres > 0 && (
            <Stat label="Distance" value={`${course.distanceMetres.toLocaleString()} m`} />
          )}
          {entry.avgStrokeRate != null && <Stat label="Avg rate" value={`${entry.avgStrokeRate} spm`} tone="split" />}
        </div>

        {entry.splits.length > 0 && (
          <Section title="500 m splits">
            <div className="overflow-x-auto">
              <table className="w-full text-base border-collapse tabular">
                <thead>
                  <tr className={eyebrowClass}>
                    <th className="text-left pr-4 py-2 font-normal">Mark</th>
                    <th className="text-right pr-4 py-2 font-normal">Elapsed</th>
                    <th className="text-right pr-4 py-2 font-normal">Split</th>
                    <th className="text-right py-2 font-normal whitespace-nowrap">Pace /500</th>
                  </tr>
                </thead>
                <tbody>
                  {entry.splits.map((s, i) => {
                    const prev = i === 0 ? null : entry.splits[i - 1]
                    const segSecs = s.elapsedSeconds - (prev?.elapsedSeconds ?? 0)
                    const segDist = s.distance - (prev?.distance ?? 0)
                    return (
                      <tr key={s.distance} className="border-t border-border">
                        <td className="pr-4 py-2 text-muted whitespace-nowrap">{s.distance.toLocaleString()} m</td>
                        <td className="pr-4 py-2 text-right text-fg">{formatTime(s.elapsedSeconds)}</td>
                        <td className="pr-4 py-2 text-right text-split">{formatTime(segSecs)}</td>
                        <td className="py-2 text-right text-primary-text">{paceFor500m(segDist, segSecs)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {course && entry.trackSegment && entry.trackSegment.length > 0 && (
          <Section title="Track">
            <CourseMapClient course={course} track={entry.trackSegment} />
          </Section>
        )}

        {entry.crew.length > 1 && (
          <Section title="Crew">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-base">
              {entry.crew.map(m => (
                <span key={String(m.seat)}>
                  <span className="text-muted mr-1 tabular">{m.seat === 'C' ? 'Cox' : m.seat}</span>
                  <span className="text-fg">{m.name}</span>
                </span>
              ))}
            </div>
            <span className="sr-only">{hasCox ? 'includes cox' : ''}</span>
          </Section>
        )}

        {entry.conditions && (
          <Section title="Conditions at finish">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-base text-fg tabular">
              {entry.conditions.weather?.temperatureC != null && <span><span className="text-muted mr-1">temp</span>{entry.conditions.weather.temperatureC.toFixed(1)}°C</span>}
              {entry.conditions.weather?.windSpeedKmh != null && (
                <span><span className="text-muted mr-1">wind</span>{entry.conditions.weather.windSpeedKmh.toFixed(0)} km/h{entry.conditions.weather.windDirectionDeg != null && ` ${compass(entry.conditions.weather.windDirectionDeg)}`}</span>
              )}
              {entry.conditions.weather?.precipitationMm != null && <span><span className="text-muted mr-1">rain</span>{entry.conditions.weather.precipitationMm.toFixed(1)} mm</span>}
              {entry.conditions.flow?.valueM3s != null && (
                <span><span className="text-muted mr-1">flow</span>{entry.conditions.flow.valueM3s.toFixed(1)} m³/s{entry.conditions.flow.stationLabel && <span className="text-muted"> · {entry.conditions.flow.stationLabel}</span>}</span>
              )}
            </div>
          </Section>
        )}

        {/* Private note — owner only. */}
        {isOwner && (
          <Section title="Your note">
            <p className="text-sm text-muted -mt-1">
              Only you can see this. How the race felt, kit, tactics: anything.
            </p>
            <label htmlFor="entry-note" className="sr-only">Your note</label>
            <textarea
              id="entry-note"
              value={note}
              onChange={e => { setNote(e.target.value); setNoteMsg('') }}
              maxLength={2000}
              rows={4}
              placeholder="Add a private note about this race…"
              className={`${inputClass} py-2 resize-y`}
            />
            <div className="flex items-center gap-3">
              <Button onClick={saveNote} disabled={noteSaving}>
                {noteSaving ? 'Saving…' : 'Save note'}
              </Button>
              {noteMsg && <span className="text-sm text-muted">{noteMsg}</span>}
            </div>
          </Section>
        )}

        {/* Next steps. Your own result opens as a paddle: the full analysis
            (efforts, stroke rate, the chart) of the same run. Analysed on
            first open; after that the duplicate check opens the paddle you
            already have. */}
        <nav aria-label="Next steps" className="flex flex-col gap-2 border-t border-border pt-6">
          <div className="flex flex-wrap gap-2">
            <Link href={leaderboardHref} className={buttonClass('secondary')}>Back to the leaderboard</Link>
            {isOwner && (
              <Button onClick={openAsPaddle} disabled={opening}>
                {opening ? 'Opening…' : 'Open as a paddle'}
              </Button>
            )}
          </div>
          {openErr && <p className="text-sm text-red" role="alert">{openErr}</p>}
        </nav>
      </Page>
    </main>
  )
}
