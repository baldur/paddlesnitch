'use client'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import manifest from '@paddlesnitch/waterways/data/manifest.json'
import type { NeededLock } from '@paddlesnitch/waterways/national'
import type { CoverageLevel, WaterwayCoverage } from '@paddlesnitch/waterways/waterway-coverage'
import LoadingState from '@/components/LoadingState'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { inputClass } from '@paddlesnitch/ui/Form'
import { PageHeader, eyebrowClass } from '@paddlesnitch/ui/Layout'
import { addPortageHref, COVERAGE_LEVELS } from '@/lib/plan-ui'

// The gaps table: every scored waterway with what we know, filterable, the
// most-planned first. The scores come from /plan/data/{version}/coverage
// (computed from the live data and people's saved plans).

const VERSION = manifest.version ?? 'none'
const PAGE = 100
const BTN = buttonClass('secondary', 'sm')
const KINDS = [['canal', 'Canals'], ['navigation', 'Navigations'], ['river', 'Rivers']] as const

export default function Gaps() {
  const [rows, setRows] = useState<WaterwayCoverage[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [levels, setLevels] = useState<Set<CoverageLevel>>(new Set(['good', 'some', 'thin']))
  const [kinds, setKinds] = useState<Set<string>>(new Set(['canal', 'navigation', 'river']))
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(PAGE)

  useEffect(() => {
    fetch(`/plan/data/${VERSION}/coverage`).then(r => (r.ok ? r.json() : Promise.reject())).then(setRows, () => setFailed(true))
  }, [])

  const filtered = useMemo(() => (rows ?? []).filter(r =>
    levels.has(r.level) && kinds.has(r.kind) && (!q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()))), [rows, levels, kinds, q])
  const totals = useMemo(() => {
    const t = { km: { good: 0, some: 0, thin: 0 }, locks: 0, sides: 0 }
    for (const r of rows ?? []) { t.km[r.level] += r.km; t.locks += r.locks; t.sides += r.locksWithSide }
    return t
  }, [rows])

  const toggle = <T,>(set: Set<T>, v: T) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n }

  if (failed) return <p className="p-6 text-base text-red">Couldn&apos;t load the coverage. Please try again.</p>
  if (!rows) return <LoadingState label="Working out what we know…" />

  return (
    <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-6 sm:py-10 flex flex-col gap-6">
      <PageHeader
        title="Gaps"
        description={<>
          Every canal, navigation and river over 10 km we cover in the UK and Ireland, and what we know about it, worked out from the data.
          We&apos;d rather show a gap than guess. The biggest one: we know which bank to land on at {totals.sides} of {totals.locks.toLocaleString()} locks.
          Hardly any open data records portage sides (OpenStreetMap has a few, mostly on the Caledonian Canal), so paddlers add them: start with the locks below, or any lock on a route you plan.
        </>}
      />
      <section className="flex flex-col gap-3">
        <dl className="flex flex-wrap gap-x-8 gap-y-2" data-testid="gaps-totals">
          {COVERAGE_LEVELS.map(l => (
            <div key={l.id} className="flex flex-col gap-1">
              <dt className={eyebrowClass} style={{ color: l.colour }}>{l.label} </dt>
              <dd className="tabular text-xl font-semibold text-fg">{Math.round(totals.km[l.id]).toLocaleString()} km</dd>
            </div>
          ))}
        </dl>
        <ul className="text-sm text-muted space-y-1">
          {COVERAGE_LEVELS.map(l => <li key={l.id}><span className="font-medium" style={{ color: l.colour }}>{l.label}</span>: {l.says}</li>)}
        </ul>
      </section>

      <MostNeeded />

      <section className="flex flex-wrap gap-2 items-center">
        {COVERAGE_LEVELS.map(l => (
          <button key={l.id} type="button" aria-pressed={levels.has(l.id)} className={`${BTN} ${levels.has(l.id) ? 'text-fg' : 'text-muted!'}`}
            style={levels.has(l.id) ? { borderColor: l.colour } : undefined} onClick={() => { setLevels(s => toggle(s, l.id)); setShown(PAGE) }}>{l.label}</button>
        ))}
        {KINDS.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={kinds.has(k)} className={`${BTN} ${kinds.has(k) ? 'border-primary-text! bg-surface-2! text-fg' : 'text-muted!'}`}
            onClick={() => { setKinds(s => toggle(s, k)); setShown(PAGE) }}>{label}</button>
        ))}
        <input className={`${inputClass} sm:w-64`} placeholder="Find a waterway" aria-label="Find a waterway"
          value={q} onChange={e => { setQ(e.target.value); setShown(PAGE) }} />
        <span className="text-sm text-muted tabular">{filtered.length.toLocaleString()} waterways</span>
      </section>

      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular" data-testid="gaps-table">
          <thead className={`${eyebrowClass} text-left`}>
            <tr className="border-b border-border whitespace-nowrap">
              <th className="py-2 pr-3 font-normal">Waterway</th><th className="pr-3 font-normal">km</th><th className="pr-3 font-normal">Locks</th><th className="pr-3 font-normal">Side known</th>
              <th className="pr-3 font-normal">Weirs</th><th className="pr-3 font-normal">Get in / out</th><th className="pr-3 font-normal">Crew access</th><th className="pr-3 font-normal">Facilities</th><th className="pr-3 font-normal">Coverage</th><th className="font-normal">Plans</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, shown).map(r => {
              const level = COVERAGE_LEVELS.find(l => l.id === r.level)!
              return (
                <tr key={r.id} className="border-b border-border">
                  <td className="py-2 pr-3 font-sans whitespace-nowrap">
                    <Link className="tt-link" href={`/plan?view=${r.at[0].toFixed(4)},${r.at[1].toFixed(4)},12`}>{r.name}</Link>
                    <span className="text-sm text-muted"> · {r.kind}</span>
                  </td>
                  <td className="pr-3">{r.km}</td>
                  <td className="pr-3">{r.locks}</td>
                  <td className={`pr-3 ${r.locks && r.locksWithSide < r.locks ? 'text-red' : ''}`}>{r.locks ? `${r.locksWithSide} / ${r.locks}` : '—'}</td>
                  <td className="pr-3">{r.weirs}</td>
                  <td className={`pr-3 ${r.access ? '' : 'text-red'}`}>{r.access}</td>
                  <td className="pr-3">{r.crew}</td>
                  <td className="pr-3">{r.facilities}</td>
                  <td className="pr-3" style={{ color: level.colour }}>{level.label}</td>
                  <td>{r.plans || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {shown < filtered.length && <button type="button" className={`${BTN} self-start`} onClick={() => setShown(n => n + PAGE)}>Show more</button>}
      <p className="text-sm text-muted">Click a waterway to open it in the planner. Counts are from the data we hold; a lock&apos;s own weir is counted as a weir here. Plans: how many saved plans travel some of it; the most-planned come first.</p>
    </main>
  )
}

/** Locks with no landing details yet that people's saved plans pass most. */
function MostNeeded() {
  const [locks, setLocks] = useState<NeededLock[] | null>(null)
  useEffect(() => {
    fetch(`/plan/data/${VERSION}/needed`).then(r => (r.ok ? r.json() : Promise.reject())).then(setLocks, () => setLocks([]))
  }, [])
  if (!locks?.length) return null
  return (
    <section className="flex flex-col gap-3" data-testid="most-needed">
      <h2 className="text-lg font-semibold text-fg">Most needed</h2>
      <p className="text-sm text-muted">Locks with no landing details yet, most-planned first. Know one? It takes a minute: two clicks on the satellite map.</p>
      <ul className="divide-y divide-border border-y border-border">
        {locks.slice(0, 15).map(l => (
          <li key={l.id} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0">
              <span className="text-fg">{l.name ?? 'Lock'}</span>
              <span className="text-sm text-muted tabular"> · in {l.plans} plan{l.plans === 1 ? '' : 's'}</span>
            </span>
            <Link className={buttonClass('secondary', 'sm')} href={addPortageHref(l)}>Add details</Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
