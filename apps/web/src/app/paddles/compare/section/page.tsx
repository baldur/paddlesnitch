'use client'
import Link from 'next/link'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { fmtDur, split500 } from '@paddlesnitch/analysis/analysis'
import type { Racer } from '@paddlesnitch/analysis/similar'
import { trpc } from '@/lib/trpc'
import SectionRaceMapClient from '@/components/map/SectionRaceMapClient'
import AppHeader from '@/components/AppHeader'
import { fmtDay } from '@paddlesnitch/core/format'
import { Page, PageHeader, eyebrowClass } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { EmptyState } from '@paddlesnitch/ui/Card'
import LoadingState from '@/components/LoadingState'

// Palette: source is blue; the picked racers cycle through the rest.
const SOURCE_COLOR = '#38bdf8'
const RACER_COLORS = ['#22c55e', '#a78bfa', '#eab308', '#f472b6', '#fb923c', '#2dd4bf']
const colorFor = (racers: Racer[], i: number) => (racers[i].isSource ? SOURCE_COLOR : RACER_COLORS[racers.slice(0, i).filter(r => !r.isSource).length % RACER_COLORS.length])

const fmtDate = fmtDay
const signed = (s: number) => (Math.abs(s) < 0.5 ? '—' : `${s < 0 ? '−' : '+'}${Math.abs(s) < 60 ? `${Math.abs(s).toFixed(0)}s` : fmtDur(Math.abs(s))}`)
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const compass = (d?: number | null) => (d == null ? '' : ` ${COMPASS[Math.round(d / 45) % 8]}`)

export default function SectionComparePage() {
  return <Suspense fallback={<main className="flex-1 flex"><LoadingState label="Loading" /></main>}><Inner /></Suspense>
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

  const back = src ? { href: `/paddles/${src}`, label: 'Paddle' } : { href: '/paddles', label: 'Paddles' }
  if (race === undefined) return <main className="flex-1 flex"><LoadingState label="Loading" /></main>
  if (!race || race.racers.length === 0) return (
    <main className="flex-1 flex flex-col">
      <AppHeader breadcrumb={<Link href={back.href} className="tt-nav-link text-sm shrink-0">← {back.label}</Link>} />
      <Page width="narrow">
        <EmptyState title={err || 'Nothing to compare here'}
          action={<Link href={back.href} className={buttonClass('secondary')}>Back to the {back.label.toLowerCase()}</Link>} />
      </Page>
    </main>
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
    <main className="flex-1 flex flex-col">
      <AppHeader breadcrumb={<Link href={back.href} className="tt-nav-link text-sm shrink-0">← {back.label}</Link>} />
      <div className="h-[46vh] min-h-[280px] w-full relative border-b border-border">
        <SectionRaceMapClient racers={overlay} startLine={race.startLine} finishLine={race.finishLine} />
      </div>

      <Page>
        <PageHeader title="Compare a section" description={<span className="tabular">{(race.sectionM / 1000).toFixed(2)} km · {racers.length} paddle{racers.length === 1 ? '' : 's'}</span>} />

        {/* coach narrative — reasons about whether conditions explain the gap */}
        {race.insight && <p className="text-base leading-relaxed border-l-2 border-primary pl-4">{race.insight}</p>}

        {/* comparison table — dates across the top, metrics down the side */}
        <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-fg">Times from the start line</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular border-collapse">
            <thead>
              <tr className={eyebrowClass}>
                <th className="text-left font-normal py-1 pr-3"></th>
                {racers.map((r, i) => (
                  <th key={r.sessionId} className="text-right font-normal py-1 pl-3 whitespace-nowrap">
                    <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: colorFor(racers, i) }} />
                    {fmtDate(r.paddledAt).replace(/ \d{4}$/, '')}{r.isSource && <span className="text-you"> · you</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border">
                <td className="text-left py-2 pr-3 text-muted font-sans whitespace-nowrap">Time</td>
                {racers.map(r => <td key={r.sessionId} className={`text-right py-1.5 pl-3 font-bold ${r.elapsedS === fastest ? 'text-green' : 'text-fg'}`}>{fmtDur(r.elapsedS)}</td>)}
              </tr>
              <tr className="border-t border-border">
                <td className="text-left py-2 pr-3 text-muted font-sans whitespace-nowrap">Vs you</td>
                {racers.map(r => { const d = r.elapsedS - source.elapsedS; return <td key={r.sessionId} className={`text-right py-1 pl-3 ${r.isSource ? 'text-muted' : d < 0 ? 'text-green' : d > 0 ? 'text-red' : 'text-muted'}`}>{r.isSource ? '—' : signed(d)}</td> })}
              </tr>
              <tr className="border-t border-border">
                <td className="text-left py-2 pr-3 text-muted font-sans whitespace-nowrap">Pace /500</td>
                {racers.map(r => <td key={r.sessionId} className="text-right py-1 pl-3 text-muted">{split500(r.cruiseSpeed)}</td>)}
              </tr>
              <tr className="border-t border-border">
                <td className="text-left py-2 pr-3 text-muted font-sans whitespace-nowrap">Stroke rate</td>
                {racers.map(r => <td key={r.sessionId} className="text-right py-1 pl-3 text-muted">{r.avgSR != null ? `${Math.round(r.avgSR)} spm` : '—'}</td>)}
              </tr>
              <tr className="border-t border-border">
                <td className="text-left py-2 pr-3 text-muted font-sans whitespace-nowrap">Per stroke</td>
                {racers.map(r => <td key={r.sessionId} className="text-right py-1 pl-3 text-muted">{r.avgDps != null ? `${r.avgDps.toFixed(1)} m` : '—'}</td>)}
              </tr>
              <tr className="border-t border-border">
                <td className="text-left py-2 pr-3 text-muted font-sans whitespace-nowrap">Wind</td>
                {racers.map(r => <td key={r.sessionId} className="text-right py-1 pl-3 text-muted whitespace-nowrap">{r.conditions?.windKmh != null ? `${Math.round(r.conditions.windKmh)} km/h${compass(r.conditions.windDir)}` : '—'}</td>)}
              </tr>
              <tr className="border-t border-border">
                <td className="text-left py-2 pr-3 text-muted font-sans whitespace-nowrap">River flow</td>
                {racers.map(r => <td key={r.sessionId} className="text-right py-1 pl-3 text-flow whitespace-nowrap">{r.conditions?.flowM3s != null ? `${r.conditions.flowM3s.toFixed(1)} m³/s` : '—'}</td>)}
              </tr>
            </tbody>
          </table>
          {racers.every(r => !r.conditions?.windKmh && !r.conditions?.flowM3s) && (
            <p className="text-sm text-muted mt-2">No wind or river flow data for these paddles.</p>
          )}
        </div>
        </section>

        {/* per-500 splits over the section */}
        {boundaries.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-fg">Splits</h2>
            <p className="text-sm text-muted">Time at each 500 m of the section.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular border-collapse">
                <thead>
                  <tr className={eyebrowClass}>
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
                      <td className="text-left py-2 pr-3 text-muted font-sans whitespace-nowrap">{d < 1000 ? `${d} m` : `${(d / 1000).toFixed(1)} km`}</td>
                      {racers.map(r => { const e = splitAt(r, d); return <td key={r.sessionId} className="text-right py-1 pl-3">{e != null ? fmtDur(e) : '—'}</td> })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </Page>
    </main>
  )
}
