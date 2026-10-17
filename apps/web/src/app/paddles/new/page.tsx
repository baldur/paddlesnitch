'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import AnalysisView, { type ViewData } from '@/components/analysis/AnalysisView'
import type { StravaActivitySummary } from '@paddlesnitch/core/types'
import type { TrialEntrySummary } from '@paddlesnitch/analysis/trials'
import { trpc } from '@/lib/trpc'
import AppHeader from '@/components/AppHeader'
import { prepareTraceUpload, uploadErrorMessage, TOO_BIG_MESSAGE } from '@/lib/trace-upload'
import { fmtDayMonth } from '@paddlesnitch/core/format'
import { Page, PageHeader } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { Segmented } from '@paddlesnitch/ui/Form'
import { Card, Chevron, EmptyState, cardClass } from '@paddlesnitch/ui/Card'
import LoadingState from '@/components/LoadingState'

// A row to pick (a Strava activity, a time-trial entry): tapping it adds it.
const PICK = `${cardClass} w-full text-left flex items-center gap-3 px-4 py-3 min-h-11 transition-colors hover:border-border-strong hover:bg-surface-2 disabled:opacity-50`
type Result = ViewData & { id: string }

// Shared frame for the entry-screen states: the same header as every page.
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex-1 flex flex-col">
      <AppHeader breadcrumb={<Link href="/paddles" className="tt-nav-link text-sm shrink-0">← Paddles</Link>} />
      <Page width="narrow">
        <PageHeader title="Add a paddle" description="Upload a GPS file, or pick one from Strava, a time trial or your tracker." />
        <div className="flex flex-col gap-4">{children}</div>
      </Page>
    </main>
  )
}

function fmtDist(m: number) { return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m` }
const fmtDate = fmtDayMonth

export default function AddPaddlePage() {
  const [tab, setTab] = useState<'file' | 'strava' | 'trials' | 'device'>('file')
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [status, setStatus] = useState<'idle' | 'busy'>('idle')
  const [error, setError] = useState('')
  const router = useRouter()
  const [res, setRes] = useState<Result | null>(null)
  const [dupId, setDupId] = useState<string | null>(null)
  const [acts, setActs] = useState<StravaActivitySummary[] | undefined>(undefined)
  const [stravaMsg, setStravaMsg] = useState('')
  const [stravaPage, setStravaPage] = useState(1)
  const [stravaMore, setStravaMore] = useState(false)
  const [stravaLoadingMore, setStravaLoadingMore] = useState(false)
  const [trials, setTrials] = useState<TrialEntrySummary[] | undefined>(undefined)

  // Signed-out is normal (the `me` procedure returns { user: null }); undefined
  // while the probe is in flight.
  const utils = trpc.useUtils()
  const meQ = trpc.me.useQuery()
  const authed = meQ.isPending ? undefined : !!meQ.data?.user

  const loadStrava = () => {
    setActs(undefined); setStravaMsg(''); setStravaPage(1); setStravaMore(false)
    utils.sources.strava.fetch({ page: 1 })
      .then(d => {
        if (!d.connected) { setStravaMsg('not_connected'); setActs([]); return }
        setActs(d.activities); setStravaMore(d.hasMore)
      })
      .catch(() => { setActs([]); setStravaMsg('fetch_failed') })
  }
  // Fetch the next page and append (dedup by id — pages can overlap if the
  // athlete logged a new activity mid-browse).
  const loadMoreStrava = () => {
    const next = stravaPage + 1
    setStravaLoadingMore(true)
    utils.sources.strava.fetch({ page: next })
      .then(d => {
        if (!d.connected) { setStravaMore(false); return }
        setActs(prev => {
          const seen = new Set((prev ?? []).map(a => a.id))
          return [...(prev ?? []), ...d.activities.filter(a => !seen.has(a.id))]
        })
        setStravaPage(next); setStravaMore(d.hasMore)
      })
      .catch(() => setStravaMore(false))
      .finally(() => setStravaLoadingMore(false))
  }
  const loadTrials = () => {
    setTrials(undefined)
    utils.sources.trials.fetch().then(setTrials).catch(() => setTrials([]))
  }
  const openTab = (t: 'file' | 'strava' | 'trials' | 'device') => {
    setTab(t)
    if (t === 'strava' && acts === undefined) loadStrava()
    if (t === 'trials' && trials === undefined) loadTrials()
  }

  const analyse = async (body: FormData) => {
    setStatus('busy'); setError(''); setDupId(null)
    try {
      const r = await fetch('/paddles/api/analyse', { method: 'POST', body })
      if (!r.ok) throw new Error(uploadErrorMessage(r.status, await r.json().catch(() => ({})), 'Couldn’t analyse that paddle. Please try again.'))
      const data = await r.json()
      // Already in the library (#178) — point the paddler at the existing one
      // instead of silently creating a second copy.
      if (data.duplicate) setDupId(data.id as string)
      // Go to the paddle's own page: rendering it here at /paddles/new meant
      // a refresh lost it and the URL couldn't be shared or bookmarked.
      else if (data.id) router.replace(`/paddles/${data.id}`)
      else setRes(data)
    } catch (err) { setError(err instanceof Error ? err.message : 'Couldn’t analyse that paddle. Please try again.') }
    finally { setStatus('idle') }
  }
  const runFile = async () => {
    if (!file) return
    let upload: File
    try { upload = await prepareTraceUpload(file) } catch (err) { setError(err instanceof Error ? err.message : TOO_BIG_MESSAGE); return }
    const fd = new FormData(); fd.append('file', upload); analyse(fd)
  }
  const runStrava = (a: StravaActivitySummary) => { const fd = new FormData(); fd.append('stravaActivityId', String(a.id)); fd.append('sportType', a.sportType); analyse(fd) }
  const runTrial = (e: TrialEntrySummary) => { const fd = new FormData(); fd.append('trialEntryId', e.entryId); fd.append('trialId', e.trialId); analyse(fd) }
  const reset = () => { setRes(null); setFile(null); setError(''); setDupId(null) }

  // result → immersive view
  if (res) return <AnalysisView data={res} sessionId={res.id} onNewFile={reset} />

  if (authed === false) return (
    <Frame>
      <EmptyState title="Sign in to add a paddle" body="Your paddles are saved to your account."
        action={<a href="/signin?next=/paddles/new" className={buttonClass('primary')}>Sign in</a>} />
    </Frame>
  )

  const busy = status === 'busy'
  return (
    <Frame>
      <Segmented label="Where the paddle comes from" value={tab} onChange={openTab}
        options={[{ value: 'file', label: 'File' }, { value: 'strava', label: 'Strava' }, { value: 'trials', label: 'Trials' }, { value: 'device', label: 'Tracker' }]} />

      {dupId && (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-base text-fg">You&apos;ve already added this paddle.</p>
          <Link href={`/paddles/${dupId}`} className={buttonClass('secondary')}>Open it</Link>
        </Card>
      )}

      {tab === 'file' ? (
        <div className="flex flex-col gap-4">
          {/* A drop zone over the same file input: tap to choose, or drop a
              file on it on a computer. */}
          <label
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f) }}
            className={`${cardClass} border-2 border-dashed cursor-pointer px-6 py-10 flex flex-col items-center gap-2 text-center transition-colors focus-within:border-primary ${dragging ? 'border-primary bg-primary/10' : 'hover:border-border-strong hover:bg-surface-2'}`}>
            <input type="file" accept=".gpx,.fit,.tcx,.csv,.zip" onChange={e => setFile(e.target.files?.[0] ?? null)} className="sr-only" />
            <svg aria-hidden viewBox="0 0 24 24" className="w-8 h-8 text-muted" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {file
              ? <span className="text-base text-fg break-all">{file.name}</span>
              : <span className="text-base text-fg">Choose a GPS file<span className="hidden sm:inline"> or drop it here</span></span>}
            <span className="text-sm text-muted">{file ? 'Tap to choose another' : 'GPX, FIT, TCX, CSV or a zip from Garmin'}</span>
          </label>
          <button type="button" disabled={!file || busy} onClick={runFile} className={buttonClass('primary', 'md', 'w-full')}>
            {busy ? 'Adding…' : 'Add paddle'}
          </button>
        </div>
      ) : tab === 'strava' ? (
        <div className="flex flex-col gap-2">
          {acts === undefined && <LoadingState label="Loading your Strava activities" className="py-8" />}
          {stravaMsg === 'not_connected' && <EmptyState title="Strava isn't connected" body="Connect it in your account, then come back to pick a paddle."
            action={<a href="/account" className={buttonClass('secondary')}>Go to Account</a>} />}
          {acts && acts.length > 0 && acts.map(a => (
            <button key={a.id} type="button" disabled={busy} onClick={() => runStrava(a)} className={PICK}>
              <span className="flex-1 min-w-0">
                <span className="block text-base text-fg truncate">{a.name}</span>
                <span className="block text-sm text-muted tabular">{a.sportType} · {fmtDate(a.startDate)} · {fmtDist(a.distanceMetres)}</span>
              </span>
              <Chevron />
            </button>
          ))}
          {acts && acts.length === 0 && !stravaMsg && <p className="text-base text-muted">No recent paddles on Strava.</p>}
          {stravaMsg === 'fetch_failed' && <p className="text-base text-red">Couldn&apos;t load your Strava activities. Please try again.</p>}
          {acts && acts.length > 0 && stravaMore && (
            <button type="button" disabled={stravaLoadingMore} onClick={loadMoreStrava} className={buttonClass('quiet', 'md', 'w-full')}>
              {stravaLoadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      ) : tab === 'trials' ? (
        <div className="flex flex-col gap-2">
          {trials === undefined && <LoadingState label="Loading your time-trial entries" className="py-8" />}
          {trials && trials.length > 0 && trials.map(e => (
            <button key={e.entryId} type="button" disabled={busy} onClick={() => runTrial(e)} className={PICK}>
              <span className="flex-1 min-w-0">
                <span className="block text-base text-fg truncate">{e.courseName}</span>
                <span className="block text-sm text-muted tabular">{e.trialName} · {fmtDate(e.paddledAt)}{e.distanceMetres ? ` · ${fmtDist(e.distanceMetres)}` : ''}</span>
              </span>
              <Chevron />
            </button>
          ))}
          {trials && trials.length === 0 && <EmptyState title="No time-trial entries yet" body="Race a trial, then add it here to see it in detail."
            action={<a href="/att" className={buttonClass('secondary')}>Open Trials</a>} />}
        </div>
      ) : (
        // A tracker's recordings become paddles by themselves (one-paddle.md,
        // phase 2), so there's nothing to pick here any more.
        <Card className="flex flex-col gap-2">
          <p className="text-base text-fg">Nothing to add: your tracker&apos;s paddles appear in <Link href="/paddles" className="text-primary-text">Paddles</Link> by themselves once it uploads them.</p>
          <p className="text-sm text-muted">Recordings where the boat barely moved, like a test at home, stay on your tracker&apos;s page under <Link href="/devices" className="text-primary-text">Devices</Link>.</p>
        </Card>
      )}

      {tab !== 'file' && busy && <p className="text-sm text-muted" role="status">Adding…</p>}
      {error && <p role="alert" className="text-sm text-red border border-red/50 bg-red/10 rounded-control px-3 py-2">{error}</p>}
    </Frame>
  )
}
