'use client'
import Link from 'next/link'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { fmtDur, split500 } from '@paddlesnitch/analysis/analysis'
import type { Racer } from '@paddlesnitch/analysis/similar'
import { trpc } from '@/lib/trpc'
import SectionRaceMapClient from '@/components/map/SectionRaceMapClient'
import AppHeader from '@/components/AppHeader'

// Palette: source is blue; the picked racers cycle through the rest.
const SOURCE_COLOR = '#38bdf8'
const RACER_COLORS = ['#22c55e', '#a78bfa', '#eab308', '#f472b6', '#fb923c', '#2dd4bf']
const colorFor = (racers: Racer[], i: number) => (racers[i].isSource ? SOURCE_COLOR : RACER_COLORS[racers.slice(0, i).filter(r => !r.isSource).length % RACER_COLORS.length])

function fmtDate(iso: string) { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) } catch { return iso.slice(0, 10) } }
const signed = (s: number) => (Math.abs(s) < 0.5 ? '—' : `${s < 0 ? '−' : '+'}${Math.abs(s) < 60 ? `${Math.abs(s).toFixed(0)}s` : fmtDur(Math.abs(s))}`)
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const compass = (d?: number | null) => (d == null ? '' : ` ${COMPASS[Math.round(d / 45) % 8]}`)

export default function SectionComparePage() {
  return <Suspense fallback={<div className="min-h-screen bg-bg" />}><Inner /></Suspense>
}

function Inner() {
  const sp = useSearchParams()
  const src = sp.get('src'), a = sp.get('a'), b = sp.get('b'), ids = sp.get('ids')
  const valid = !!src && a != null && b != null
  const q = trpc.similar.compare.useQuery(
    { sourceId: src ?? '', aIdx: Number(a), bIdx: Number(b), sessionIds: (ids ?? '').split(',').filter(Boolean) },
    { enabled: valid, retry: false },
  )
  const race = !valid ? null : q.isPending ? undefined : (q.data?.race ?? null)
  const err = q.data?.reason === 'section_too_short' ? 'That section is too short to compare.' : (q.isError ? 'Couldn’t compare these paddles. Please try again.' : '')

  if (race === undefined) return <div className="min-h-screen bg-bg text-muted flex items-center justify-center text-sm">Loading…</div>
  if (!race || race.racers.length === 0) return (
    <div className="min-h-screen bg-bg text-fg flex flex-col items-center justify-center gap-3">
      <p className="text-sm text-muted">{err || 'Nothing to compare here.'}</p>
      <Link href="/paddles" className="text-xs tracking-widest text-primary">← PADDLES</Link>
    </div>
  )

  const racers = race.racers
  const source = racers.find(r => r.isSource) ?? racers[0]
  const fastest = Math.min(...racers.map(r => r.elapsedS))
  const overlay = racers.map((r, i) => ({ trackSegment: r.trackSegment, color: colorFor(racers, i), label: `${r.isSource ? 'you · ' : ''}${fmtDate(r.paddledAt)} · ${fmtDur(r.elapsedS)}` }))

  // union of 500 m split boundaries across racers, for the splits table
  const maxDist = Math.max(0, ...racers.flatMap(r => r.splits.map(s => s.distance)))
  const boundaries: number[] = []
  for (let d = 500; d <= maxDist; d += 500) boundaries.push(d)
  const splitAt = (r: Racer, d: number) => r.splits.find(s => s.distance === d)?.elapsedSeconds

  return (
    <div className="min-h-screen bg-bg text-fg">
      <AppHeader breadcrumb={<Link href="/paddles" className="tt-nav-link text-sm shrink-0">← PADDLES</Link>} />
      <div className="h-[46vh] w-full relative">
        <SectionRaceMapClient racers={overlay} startLine={race.startLine} finishLine={race.finishLine} />
        <div className="absolute top-3 left-3 z-[1000] bg-surface/95 border border-border px-3 py-2 text-xs">
          <div className="text-[10px] text-muted tracking-widest">SECTION COMPARE</div>
          <div className="tabular text-sm font-bold">{(race.sectionM / 1000).toFixed(2)} km · {racers.length} paddles</div>
        </div>
        <Link href={src ? `/paddles/${src}` : '/paddles'} className="absolute top-3 right-3 z-[1000] bg-surface/95 border border-border px-3 py-2 text-[10px] tracking-widest text-muted hover:text-fg">← BACK</Link>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5">
        {/* coach narrative — reasons about whether conditions explain the gap */}
        {race.insight && (
          <div className="mb-6">
            <div className="text-[10px] text-muted tracking-widest mb-1">SUMMARY</div>
            <p className="text-sm leading-relaxed border-l-2 border-primary pl-3">{race.insight}</p>
          </div>
        )}

        {/* comparison table — dates across the top, metrics down the side */}
        <div className="text-[10px] text-muted tracking-widest mb-2">TIMES FROM THE START LINE</div>
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-sm tabular border-collapse">
            <thead>
              <tr className="text-[10px] text-muted tracking-widest">
                <th className="text-left font-normal py-1 pr-3"></th>
                {racers.map((r, i) => (
                  <th key={r.sessionId} className="text-right font-normal py-1 pl-3 whitespace-nowrap">
                    <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: colorFor(racers, i) }} />
                    {fmtDate(r.paddledAt).replace(/ \d{4}$/, '')}{r.isSource && <span className="text-[#38bdf8]"> · you</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border">
                <td className="text-left py-1.5 pr-3 text-muted">TIME</td>
                {racers.map(r => <td key={r.sessionId} className={`text-right py-1.5 pl-3 font-bold ${r.elapsedS === fastest ? 'text-green' : 'text-fg'}`}>{fmtDur(r.elapsedS)}</td>)}
              </tr>
              <tr className="border-t border-border">
                <td className="text-left py-1 pr-3 text-muted">VS YOU</td>
                {racers.map(r => { const d = r.elapsedS - source.elapsedS; return <td key={r.sessionId} className={`text-right py-1 pl-3 ${r.isSource ? 'text-muted' : d < 0 ? 'text-green' : d > 0 ? 'text-red' : 'text-muted'}`}>{r.isSource ? '—' : signed(d)}</td> })}
              </tr>
              <tr className="border-t border-border">
                <td className="text-left py-1 pr-3 text-muted">PACE /500</td>
                {racers.map(r => <td key={r.sessionId} className="text-right py-1 pl-3 text-muted">{split500(r.cruiseSpeed)}</td>)}
              </tr>
              <tr className="border-t border-border">
                <td className="text-left py-1 pr-3 text-muted">STROKE RATE</td>
                {racers.map(r => <td key={r.sessionId} className="text-right py-1 pl-3 text-muted">{r.avgSR != null ? `${Math.round(r.avgSR)} spm` : '—'}</td>)}
              </tr>
              <tr className="border-t border-border">
                <td className="text-left py-1 pr-3 text-muted">DISTANCE PER STROKE</td>
                {racers.map(r => <td key={r.sessionId} className="text-right py-1 pl-3 text-muted">{r.avgDps != null ? `${r.avgDps.toFixed(1)} m` : '—'}</td>)}
              </tr>
              <tr className="border-t border-border">
                <td className="text-left py-1 pr-3 text-muted">WIND</td>
                {racers.map(r => <td key={r.sessionId} className="text-right py-1 pl-3 text-muted whitespace-nowrap">{r.conditions?.windKmh != null ? `${Math.round(r.conditions.windKmh)} km/h${compass(r.conditions.windDir)}` : '—'}</td>)}
              </tr>
              <tr className="border-t border-border">
                <td className="text-left py-1 pr-3 text-muted">RIVER FLOW</td>
                {racers.map(r => <td key={r.sessionId} className="text-right py-1 pl-3 text-[#22d3ee] whitespace-nowrap">{r.conditions?.flowM3s != null ? `${r.conditions.flowM3s.toFixed(1)} m³/s` : '—'}</td>)}
              </tr>
            </tbody>
          </table>
          {racers.every(r => !r.conditions?.windKmh && !r.conditions?.flowM3s) && (
            <div className="text-[11px] text-muted mt-1">No wind or river flow data for these paddles.</div>
          )}
        </div>

        {/* per-500 splits over the section */}
        {boundaries.length > 0 && (
          <>
            <div className="text-[10px] text-muted tracking-widest">SPLITS</div>
            <div className="text-[10px] text-muted mb-2">Time at each 500 m of the section.</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular border-collapse">
                <thead>
                  <tr className="text-[10px] text-muted tracking-widest">
                    <th className="text-left font-normal py-1 pr-3">500 m</th>
                    {racers.map((r, i) => (
                      <th key={r.sessionId} className="text-right font-normal py-1 pl-3 whitespace-nowrap">
                        <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: colorFor(racers, i) }} />{fmtDate(r.paddledAt).replace(/ \d{4}$/, '')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {boundaries.map(d => (
                    <tr key={d} className="border-t border-border">
                      <td className="text-left py-1 pr-3 text-muted">{d < 1000 ? `${d} m` : `${(d / 1000).toFixed(1)} km`}</td>
                      {racers.map(r => { const e = splitAt(r, d); return <td key={r.sessionId} className="text-right py-1 pl-3">{e != null ? fmtDur(e) : '—'}</td> })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
