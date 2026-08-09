'use client'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import AnalysisView, { type ViewData } from '@/components/analysis/AnalysisView'
import type { StravaActivitySummary } from '@paddlesnitch/core/types'
import type { TrialEntrySummary } from '@/lib/trials'
import AppShell from '@paddlesnitch/ui/AppShell'
import AppAccountNav from '@/components/AppAccountNav'

const PANEL = 'bg-[#0f172a]/95 border border-[#1e293b] rounded'
type Result = ViewData & { id: string }

// Shared frame for the entry-screen states so /analyse gets the same platform
// header (brand + Trials↔Analyse nav + account) as every other page.
function Frame({ nav, children }: { nav?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <AppShell active="analyse" nav={nav} account={<AppAccountNav />} />
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">{children}</div>
    </div>
  )
}

function fmtDist(m: number) { return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m` }
function fmtDate(iso: string) { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) } catch { return iso.slice(0, 10) } }

export default function AnalysePage() {
  const [authed, setAuthed] = useState<boolean | undefined>(undefined)
  const [tab, setTab] = useState<'file' | 'strava' | 'trials'>('file')
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

  useEffect(() => { fetch('/analyse/api/me').then(r => setAuthed(r.ok)).catch(() => setAuthed(false)) }, [])

  const loadStrava = () => {
    setActs(undefined); setStravaMsg(''); setStravaPage(1); setStravaMore(false)
    fetch('/analyse/api/strava/activities')
      .then(async r => { if (r.status === 409) { setStravaMsg('not_connected'); return { activities: [], hasMore: false } } return r.json() })
      .then((d: { activities: StravaActivitySummary[]; hasMore?: boolean }) => { setActs(d.activities ?? []); setStravaMore(!!d.hasMore) })
      .catch(() => { setActs([]); setStravaMsg('fetch_failed') })
  }
  // Fetch the next page and append (dedup by id — pages can overlap if the
  // athlete logged a new activity mid-browse).
  const loadMoreStrava = () => {
    const next = stravaPage + 1
    setStravaLoadingMore(true)
    fetch(`/analyse/api/strava/activities?page=${next}`)
      .then(r => (r.ok ? r.json() : { activities: [], hasMore: false }))
      .then((d: { activities: StravaActivitySummary[]; hasMore?: boolean }) => {
        setActs(prev => {
          const seen = new Set((prev ?? []).map(a => a.id))
          return [...(prev ?? []), ...(d.activities ?? []).filter(a => !seen.has(a.id))]
        })
        setStravaPage(next); setStravaMore(!!d.hasMore)
      })
      .catch(() => setStravaMore(false))
      .finally(() => setStravaLoadingMore(false))
  }
  const loadTrials = () => {
    setTrials(undefined)
    fetch('/analyse/api/trials')
      .then(r => (r.ok ? r.json() : { entries: [] }))
      .then((d: { entries: TrialEntrySummary[] }) => setTrials(d.entries ?? []))
      .catch(() => setTrials([]))
  }
  const openTab = (t: 'file' | 'strava' | 'trials') => {
    setTab(t)
    if (t === 'strava' && acts === undefined) loadStrava()
    if (t === 'trials' && trials === undefined) loadTrials()
  }

  const analyse = async (body: FormData) => {
    setStatus('busy'); setError(''); setDupId(null)
    try {
      const r = await fetch('/analyse/api/analyse', { method: 'POST', body })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Analysis failed')
      const data = await r.json()
      // Already in the library (#178) — point the paddler at the existing one
      // instead of silently creating a second copy.
      if (data.duplicate) setDupId(data.id as string)
      else setRes(data)
    } catch (err) { setError(err instanceof Error ? err.message : 'Analysis failed') }
    finally { setStatus('idle') }
  }
  const runFile = () => { if (!file) return; const fd = new FormData(); fd.append('file', file); analyse(fd) }
  const runStrava = (a: StravaActivitySummary) => { const fd = new FormData(); fd.append('stravaActivityId', String(a.id)); fd.append('sportType', a.sportType); analyse(fd) }
  const runTrial = (e: TrialEntrySummary) => { const fd = new FormData(); fd.append('trialEntryId', e.entryId); fd.append('trialId', e.trialId); analyse(fd) }
  const reset = () => { setRes(null); setFile(null); setError(''); setDupId(null) }

  // result → immersive view
  if (res) return <AnalysisView data={res} sessionId={res.id} onNewFile={reset} />

  if (authed === false) return (
    <Frame>
      <div className={`${PANEL} w-full max-w-md p-6 text-center`}>
        <h1 className="text-lg font-bold tracking-widest">PADDLE ANALYSIS</h1>
        <p className="text-xs text-[#64748b] mt-2 mb-5">Sign in to analyse your paddles, save them to your diary, and track progress over time.</p>
        <a href="/att/auth?next=/analyse" className="inline-block px-6 py-2.5 bg-[#0369a1] text-white text-xs font-bold tracking-widest rounded hover:bg-[#0284c7]">SIGN IN / SIGN UP</a>
      </div>
    </Frame>
  )

  return (
    <Frame nav={<Link href="/library" className="text-muted hover:text-fg tracking-widest transition-colors">MY PADDLES</Link>}>
      <div className={`${PANEL} w-full max-w-md p-6`}>
        <h1 className="text-lg font-bold tracking-widest">PADDLE ANALYSIS</h1>
        <p className="text-xs text-[#64748b] mt-1 mb-4">See what actually happened — pieces, rests, stroke-rate, wind &amp; flow — and keep a paddling diary.</p>

        <div className="flex gap-1 mb-4">
          {(['file', 'strava', 'trials'] as const).map(t => (
            <button key={t} onClick={() => openTab(t)} className={`px-3 py-1.5 text-[10px] tracking-widest rounded ${tab === t ? 'bg-[#0369a1] text-white' : 'bg-[#1e293b] text-[#94a3b8]'}`}>{t === 'file' ? 'UPLOAD FILE' : t === 'strava' ? 'FROM STRAVA' : 'TIME TRIALS'}</button>
          ))}
        </div>

        {dupId && (
          <div className="mb-4 text-xs border border-[#334155] bg-[#0b1220] px-3 py-3 rounded">
            <p className="text-[#94a3b8]">You&apos;ve already analysed this paddle — it&apos;s in your library.</p>
            <Link href={`/${dupId}`} className="mt-2 inline-block px-4 py-2 bg-[#0369a1] text-white font-bold tracking-widest rounded hover:bg-[#0284c7]">OPEN IT →</Link>
          </div>
        )}

        {tab === 'file' ? (
          <>
            <label className="text-[10px] text-[#64748b] tracking-widest">GPS FILE (.gpx .fit .tcx .csv .zip)</label>
            <input type="file" accept=".gpx,.fit,.tcx,.csv,.zip" onChange={e => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-sm text-[#e2e8f0] file:bg-[#1e293b] file:text-[#cbd5e1] file:border-0 file:px-3 file:py-1.5 file:mr-3 file:text-xs file:cursor-pointer bg-[#0b1220] border border-[#1e293b] px-3 py-2 rounded" />
          </>
        ) : tab === 'strava' ? (
          <div className="max-h-[300px] overflow-auto">
            {acts === undefined && <p className="text-xs text-[#64748b]">Loading your Strava activities…</p>}
            {stravaMsg === 'not_connected' && <p className="text-xs text-[#94a3b8]">Strava isn&apos;t connected. <a href="/profile/me/settings" className="text-[#0369a1]">Connect it in Account</a>, then come back.</p>}
            {acts && acts.length > 0 && acts.map(a => (
              <button key={a.id} disabled={status === 'busy'} onClick={() => runStrava(a)}
                className="block w-full text-left px-3 py-2 border border-[#1e293b] rounded mb-1 hover:border-[#0369a1] disabled:opacity-40">
                <span className="block text-sm truncate">{a.name}</span>
                <span className="text-[11px] text-[#64748b]">{a.sportType} · {fmtDate(a.startDate)} · {fmtDist(a.distanceMetres)}</span>
              </button>
            ))}
            {acts && acts.length === 0 && !stravaMsg && <p className="text-xs text-[#64748b]">No recent water activities found.</p>}
            {acts && acts.length > 0 && stravaMore && (
              <button disabled={stravaLoadingMore} onClick={loadMoreStrava}
                className="block w-full text-center px-3 py-2 mt-1 text-[11px] tracking-widest text-[#94a3b8] border border-[#1e293b] rounded hover:border-[#0369a1] hover:text-[#e2e8f0] disabled:opacity-40">
                {stravaLoadingMore ? 'LOADING…' : 'GET MORE'}
              </button>
            )}
          </div>
        ) : (
          <div className="max-h-[300px] overflow-auto">
            {trials === undefined && <p className="text-xs text-[#64748b]">Loading your time-trial entries…</p>}
            {trials && trials.length > 0 && trials.map(e => (
              <button key={e.entryId} disabled={status === 'busy'} onClick={() => runTrial(e)}
                className="block w-full text-left px-3 py-2 border border-[#1e293b] rounded mb-1 hover:border-[#0369a1] disabled:opacity-40">
                <span className="block text-sm truncate">{e.courseName}</span>
                <span className="text-[11px] text-[#64748b]">{e.trialName} · {fmtDate(e.paddledAt)}{e.distanceMetres ? ` · ${fmtDist(e.distanceMetres)}` : ''}</span>
              </button>
            ))}
            {trials && trials.length === 0 && <p className="text-xs text-[#64748b]">No time-trial submissions yet. <a href="/att" className="text-[#0369a1]">Race a trial</a>, then analyse it here.</p>}
          </div>
        )}

        {tab === 'file' && (
          <button disabled={!file || status === 'busy'} onClick={runFile}
            className="mt-4 w-full px-5 py-2.5 bg-[#0369a1] text-white text-xs font-bold tracking-widest hover:bg-[#0284c7] disabled:opacity-40 rounded">
            {status === 'busy' ? 'ANALYSING…' : 'ANALYSE'}
          </button>
        )}
        {tab !== 'file' && status === 'busy' && <p className="mt-3 text-xs text-[#64748b]">Analysing…</p>}
        {error && <div className="mt-3 text-xs text-[#fca5a5] border border-[#7f1d1d] bg-[#450a0a]/40 px-3 py-2 rounded">{error}</div>}
      </div>
    </Frame>
  )
}
