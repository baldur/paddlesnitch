'use client'
import Link from 'next/link'
import { useState } from 'react'
import AnalysisView, { type ViewData } from '@/components/analysis/AnalysisView'
import type { StravaActivitySummary } from '@paddlesnitch/core/types'
import type { TrialEntrySummary } from '@paddlesnitch/analysis/trials'
import type { DeviceSessionMeta } from '@paddlesnitch/analysis/device-sessions'
import { trpc } from '@/lib/trpc'
import AppHeader from '@/components/AppHeader'

const PANEL = 'bg-surface/95 border border-border'
type Result = ViewData & { id: string }

// Shared frame for the entry-screen states: the same header as every page.
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader breadcrumb={<Link href="/paddles" className="tt-nav-link text-sm shrink-0">← PADDLES</Link>} />
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">{children}</div>
    </div>
  )
}

function fmtDist(m: number) { return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m` }
function fmtDate(iso: string) { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) } catch { return iso.slice(0, 10) } }

export default function AddPaddlePage() {
  const [tab, setTab] = useState<'file' | 'strava' | 'trials' | 'device'>('file')
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<'idle' | 'busy'>('idle')
  const [error, setError] = useState('')
  const [res, setRes] = useState<Result | null>(null)
  const [dupId, setDupId] = useState<string | null>(null)
  const [acts, setActs] = useState<StravaActivitySummary[] | undefined>(undefined)
  const [stravaMsg, setStravaMsg] = useState('')
  const [stravaPage, setStravaPage] = useState(1)
  const [stravaMore, setStravaMore] = useState(false)
  const [stravaLoadingMore, setStravaLoadingMore] = useState(false)
  const [trials, setTrials] = useState<TrialEntrySummary[] | undefined>(undefined)
  const [deviceSessions, setDeviceSessions] = useState<DeviceSessionMeta[] | undefined>(undefined)

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
  const loadDevices = () => {
    setDeviceSessions(undefined)
    utils.sources.devices.fetch().then(setDeviceSessions).catch(() => setDeviceSessions([]))
  }
  const openTab = (t: 'file' | 'strava' | 'trials' | 'device') => {
    setTab(t)
    if (t === 'strava' && acts === undefined) loadStrava()
    if (t === 'trials' && trials === undefined) loadTrials()
    if (t === 'device' && deviceSessions === undefined) loadDevices()
  }

  const analyse = async (body: FormData) => {
    setStatus('busy'); setError(''); setDupId(null)
    try {
      const r = await fetch('/paddles/api/analyse', { method: 'POST', body })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Couldn’t analyse that paddle. Please try again.')
      const data = await r.json()
      // Already in the library (#178) — point the paddler at the existing one
      // instead of silently creating a second copy.
      if (data.duplicate) setDupId(data.id as string)
      else setRes(data)
    } catch (err) { setError(err instanceof Error ? err.message : 'Couldn’t analyse that paddle. Please try again.') }
    finally { setStatus('idle') }
  }
  const runFile = () => { if (!file) return; const fd = new FormData(); fd.append('file', file); analyse(fd) }
  const runStrava = (a: StravaActivitySummary) => { const fd = new FormData(); fd.append('stravaActivityId', String(a.id)); fd.append('sportType', a.sportType); analyse(fd) }
  const runTrial = (e: TrialEntrySummary) => { const fd = new FormData(); fd.append('trialEntryId', e.entryId); fd.append('trialId', e.trialId); analyse(fd) }
  const runDevice = (s: DeviceSessionMeta) => { const fd = new FormData(); fd.append('deviceSessionId', s.sessionId); fd.append('deviceId', s.deviceId); analyse(fd) }
  const reset = () => { setRes(null); setFile(null); setError(''); setDupId(null) }

  // result → immersive view
  if (res) return <AnalysisView data={res} sessionId={res.id} onNewFile={reset} />

  if (authed === false) return (
    <Frame>
      <div className={`${PANEL} w-full max-w-md p-6 text-center`}>
        <h1 className="text-lg font-bold tracking-widest">ADD A PADDLE</h1>
        <p className="text-xs text-muted mt-2 mb-5">Sign in to analyse and save your paddles.</p>
        <a href="/att/auth?next=/paddles/new" className="inline-block px-6 py-2.5 bg-primary text-white text-xs font-bold tracking-widest hover:opacity-90">SIGN IN</a>
      </div>
    </Frame>
  )

  return (
    <Frame>
      <div className={`${PANEL} w-full max-w-md p-6`}>
        <h1 className="text-lg font-bold tracking-widest">ADD A PADDLE</h1>
        <p className="text-xs text-muted mt-1 mb-4">Upload a GPS file, or pick one from Strava, a time trial or your tracker.</p>

        <div className="flex gap-1 mb-4">
          {(['file', 'strava', 'trials', 'device'] as const).map(t => (
            <button key={t} onClick={() => openTab(t)} className={`px-3 py-1.5 text-[10px] tracking-widest ${tab === t ? 'bg-primary text-white' : 'bg-surface-2 text-muted'}`}>{t === 'file' ? 'UPLOAD FILE' : t === 'strava' ? 'FROM STRAVA' : t === 'trials' ? 'TIME TRIALS' : 'TRACKER'}</button>
          ))}
        </div>

        {dupId && (
          <div className="mb-4 text-xs border border-border bg-bg px-3 py-3">
            <p className="text-muted">You&apos;ve already added this paddle.</p>
            <Link href={`/paddles/${dupId}`} className="mt-2 inline-block px-4 py-2 bg-primary text-white font-bold tracking-widest hover:opacity-90">OPEN IT →</Link>
          </div>
        )}

        {tab === 'file' ? (
          <>
            <label className="text-[10px] text-muted tracking-widest">GPS FILE (.gpx .fit .tcx .csv .zip)</label>
            <input type="file" accept=".gpx,.fit,.tcx,.csv,.zip" onChange={e => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-sm text-fg file:bg-surface-2 file:text-fg file:border-0 file:px-3 file:py-1.5 file:mr-3 file:text-xs file:cursor-pointer bg-bg border border-border px-3 py-2" />
          </>
        ) : tab === 'strava' ? (
          <div className="max-h-[300px] overflow-auto">
            {acts === undefined && <p className="text-xs text-muted">Loading your Strava activities…</p>}
            {stravaMsg === 'not_connected' && <p className="text-xs text-muted">Strava isn&apos;t connected. <a href="/account" className="text-primary">Connect it in your account</a>, then come back.</p>}
            {acts && acts.length > 0 && acts.map(a => (
              <button key={a.id} disabled={status === 'busy'} onClick={() => runStrava(a)}
                className="block w-full text-left px-3 py-2 border border-border mb-1 hover:border-primary disabled:opacity-40">
                <span className="block text-sm truncate">{a.name}</span>
                <span className="text-[11px] text-muted">{a.sportType} · {fmtDate(a.startDate)} · {fmtDist(a.distanceMetres)}</span>
              </button>
            ))}
            {acts && acts.length === 0 && !stravaMsg && <p className="text-xs text-muted">No recent water activities found.</p>}
            {acts && acts.length > 0 && stravaMore && (
              <button disabled={stravaLoadingMore} onClick={loadMoreStrava}
                className="block w-full text-center px-3 py-2 mt-1 text-[11px] tracking-widest text-muted border border-border hover:border-primary hover:text-fg disabled:opacity-40">
                {stravaLoadingMore ? 'LOADING…' : 'LOAD MORE'}
              </button>
            )}
          </div>
        ) : tab === 'trials' ? (
          <div className="max-h-[300px] overflow-auto">
            {trials === undefined && <p className="text-xs text-muted">Loading your time-trial entries…</p>}
            {trials && trials.length > 0 && trials.map(e => (
              <button key={e.entryId} disabled={status === 'busy'} onClick={() => runTrial(e)}
                className="block w-full text-left px-3 py-2 border border-border mb-1 hover:border-primary disabled:opacity-40">
                <span className="block text-sm truncate">{e.courseName}</span>
                <span className="text-[11px] text-muted">{e.trialName} · {fmtDate(e.paddledAt)}{e.distanceMetres ? ` · ${fmtDist(e.distanceMetres)}` : ''}</span>
              </button>
            ))}
            {trials && trials.length === 0 && <p className="text-xs text-muted">No time-trial submissions yet. <a href="/att" className="text-primary">Race a trial</a>, then analyse it here.</p>}
          </div>
        ) : (
          <div className="max-h-[300px] overflow-auto">
            {deviceSessions === undefined && <p className="text-xs text-muted">Loading your tracker sessions…</p>}
            {deviceSessions && deviceSessions.length > 0 && deviceSessions.map(s => (
              <button key={s.sessionId} disabled={status === 'busy'} onClick={() => runDevice(s)}
                className="block w-full text-left px-3 py-2 border border-border mb-1 hover:border-primary disabled:opacity-40">
                <span className="block text-sm truncate">{s.filename}</span>
                <span className="text-[11px] text-muted">{fmtDate(s.startedAt ?? s.uploadedAt)}{s.distanceMetres ? ` · ${fmtDist(s.distanceMetres)}` : ''} · {s.points} pts</span>
              </button>
            ))}
            {deviceSessions && deviceSessions.length === 0 && <p className="text-xs text-muted">No tracker recordings yet. <a href="/devices" className="text-primary">Add a tracker</a>.</p>}
          </div>
        )}

        {tab === 'file' && (
          <button disabled={!file || status === 'busy'} onClick={runFile}
            className="mt-4 w-full px-5 py-2.5 bg-primary text-white text-xs font-bold tracking-widest hover:opacity-90 disabled:opacity-40">
            {status === 'busy' ? 'ANALYSING…' : 'ANALYSE'}
          </button>
        )}
        {tab !== 'file' && status === 'busy' && <p className="mt-3 text-xs text-muted">Analysing…</p>}
        {error && <div className="mt-3 text-xs text-red border border-red bg-red/10 px-3 py-2">{error}</div>}
      </div>
    </Frame>
  )
}
