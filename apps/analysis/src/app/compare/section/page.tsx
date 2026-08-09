'use client'
import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { fmtDur, split500 } from '@/lib/analysis'
import type { Racer, SectionRace } from '@/lib/similar'
import SectionRaceMapClient from '@/components/map/SectionRaceMapClient'
import AppShell from '@paddlesnitch/ui/AppShell'
import AppAccountNav from '@/components/AppAccountNav'

// Palette: source is blue; the picked racers cycle through the rest.
const SOURCE_COLOR = '#38bdf8'
const RACER_COLORS = ['#22c55e', '#a78bfa', '#eab308', '#f472b6', '#fb923c', '#2dd4bf']
const colorFor = (racers: Racer[], i: number) => (racers[i].isSource ? SOURCE_COLOR : RACER_COLORS[racers.slice(0, i).filter(r => !r.isSource).length % RACER_COLORS.length])

function fmtDate(iso: string) { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) } catch { return iso.slice(0, 10) } }
const signed = (s: number) => (Math.abs(s) < 0.5 ? '—' : `${s < 0 ? '−' : '+'}${Math.abs(s) < 60 ? `${Math.abs(s).toFixed(0)}s` : fmtDur(Math.abs(s))}`)
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const compass = (d?: number | null) => (d == null ? '' : ` ${COMPASS[Math.round(d / 45) % 8]}`)

export default function SectionComparePage() {
  return <Suspense fallback={<div className="min-h-screen bg-[#0b1220]" />}><Inner /></Suspense>
}

function Inner() {
  const sp = useSearchParams()
  const src = sp.get('src'), a = sp.get('a'), b = sp.get('b'), ids = sp.get('ids')
  const [race, setRace] = useState<SectionRace | null | undefined>(undefined)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!src || a == null || b == null) { setRace(null); return }
    fetch('/analyse/api/analyse/similar/compare', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: src, aIdx: Number(a), bIdx: Number(b), sessionIds: (ids ?? '').split(',').filter(Boolean) }),
    })
      .then(async r => { if (!r.ok) { const e = await r.json().catch(() => ({})); setErr(e?.reason === 'section_too_short' ? 'That section is too short to race.' : 'Could not build the race.'); setRace(null); return }; const d = await r.json(); setRace(d.race) })
      .catch(() => { setErr('Could not build the race.'); setRace(null) })
  }, [src, a, b, ids])

  if (race === undefined) return <div className="min-h-screen bg-[#0b1220] text-[#64748b] flex items-center justify-center text-sm">Building the race…</div>
  if (!race || race.racers.length === 0) return (
    <div className="min-h-screen bg-[#0b1220] text-[#e2e8f0] flex flex-col items-center justify-center gap-3">
      <p className="text-sm text-[#64748b]">{err || 'Nothing to race here.'}</p>
      <Link href="/library" className="text-xs tracking-widest text-[#0369a1]">← MY PADDLES</Link>
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
    <div className="min-h-screen bg-[#0b1220] text-[#e2e8f0]">
      <AppShell active="analyse" account={<AppAccountNav />} />
      <div className="h-[46vh] w-full relative">
        <SectionRaceMapClient racers={overlay} startLine={race.startLine} finishLine={race.finishLine} />
        <div className="absolute top-3 left-3 z-[1000] bg-[#0f172a]/95 border border-[#1e293b] rounded px-3 py-2 text-xs">
          <div className="text-[10px] text-[#64748b] tracking-widest">SECTION RACE</div>
          <div className="tabular text-sm font-bold">{(race.sectionM / 1000).toFixed(2)} km · {racers.length} paddles</div>
        </div>
        <Link href={src ? `/${src}` : '/library'} className="absolute top-3 right-3 z-[1000] bg-[#0f172a]/95 border border-[#1e293b] rounded px-3 py-2 text-[10px] tracking-widest text-[#94a3b8] hover:text-[#e2e8f0]">← BACK</Link>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5">
        {/* coach narrative — reasons about whether conditions explain the gap */}
        {race.insight && (
          <div className="mb-6">
            <div className="text-[10px] text-[#64748b] tracking-widest mb-1">WHAT THE NUMBERS SAY</div>
            <p className="text-sm leading-relaxed border-l-2 border-[#0369a1] pl-3">{race.insight}</p>
            {race.insightModel && <div className="text-[10px] text-[#64748b] mt-1">narrated by {race.insightModel}</div>}
          </div>
        )}

        {/* comparison table — dates across the top, metrics down the side */}
        <div className="text-[10px] text-[#64748b] tracking-widest mb-2">COMPARISON · zeroed at the start line</div>
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-sm tabular border-collapse">
            <thead>
              <tr className="text-[10px] text-[#64748b] tracking-widest">
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
              <tr className="border-t border-[#1e293b]">
                <td className="text-left py-1.5 pr-3 text-[#64748b]">time</td>
                {racers.map(r => <td key={r.sessionId} className={`text-right py-1.5 pl-3 font-bold ${r.elapsedS === fastest ? 'text-[#22c55e]' : 'text-[#e2e8f0]'}`}>{fmtDur(r.elapsedS)}</td>)}
              </tr>
              <tr className="border-t border-[#1e293b]">
                <td className="text-left py-1 pr-3 text-[#64748b]">vs you</td>
                {racers.map(r => { const d = r.elapsedS - source.elapsedS; return <td key={r.sessionId} className={`text-right py-1 pl-3 ${r.isSource ? 'text-[#64748b]' : d < 0 ? 'text-[#22c55e]' : d > 0 ? 'text-[#f87171]' : 'text-[#64748b]'}`}>{r.isSource ? '—' : signed(d)}</td> })}
              </tr>
              <tr className="border-t border-[#1e293b]">
                <td className="text-left py-1 pr-3 text-[#64748b]">pace /500</td>
                {racers.map(r => <td key={r.sessionId} className="text-right py-1 pl-3 text-[#94a3b8]">{split500(r.cruiseSpeed)}</td>)}
              </tr>
              <tr className="border-t border-[#1e293b]">
                <td className="text-left py-1 pr-3 text-[#64748b]">stroke rate</td>
                {racers.map(r => <td key={r.sessionId} className="text-right py-1 pl-3 text-[#94a3b8]">{r.avgSR != null ? `${Math.round(r.avgSR)} spm` : '—'}</td>)}
              </tr>
              <tr className="border-t border-[#1e293b]">
                <td className="text-left py-1 pr-3 text-[#64748b]">dist / stroke</td>
                {racers.map(r => <td key={r.sessionId} className="text-right py-1 pl-3 text-[#94a3b8]">{r.avgDps != null ? `${r.avgDps.toFixed(1)} m` : '—'}</td>)}
              </tr>
              <tr className="border-t border-[#1e293b]">
                <td className="text-left py-1 pr-3 text-[#64748b]">wind</td>
                {racers.map(r => <td key={r.sessionId} className="text-right py-1 pl-3 text-[#94a3b8] whitespace-nowrap">{r.conditions?.windKmh != null ? `${Math.round(r.conditions.windKmh)} km/h${compass(r.conditions.windDir)}` : '—'}</td>)}
              </tr>
              <tr className="border-t border-[#1e293b]">
                <td className="text-left py-1 pr-3 text-[#64748b]">flow</td>
                {racers.map(r => <td key={r.sessionId} className="text-right py-1 pl-3 text-[#22d3ee] whitespace-nowrap">{r.conditions?.flowM3s != null ? `${r.conditions.flowM3s.toFixed(1)} m³/s` : '—'}</td>)}
              </tr>
            </tbody>
          </table>
          {racers.every(r => !r.conditions?.windKmh && !r.conditions?.flowM3s) && (
            <div className="text-[11px] text-[#64748b] mt-1">No wind/flow captured for these paddles — re-analyse with a network connection to add it.</div>
          )}
        </div>

        {/* per-500 splits over the section */}
        {boundaries.length > 0 && (
          <>
            <div className="text-[10px] text-[#64748b] tracking-widest mb-2">SPLITS · elapsed at each 500 m of the section</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular border-collapse">
                <thead>
                  <tr className="text-[10px] text-[#64748b] tracking-widest">
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
                    <tr key={d} className="border-t border-[#1e293b]">
                      <td className="text-left py-1 pr-3 text-[#64748b]">{d < 1000 ? `${d} m` : `${(d / 1000).toFixed(1)} km`}</td>
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
