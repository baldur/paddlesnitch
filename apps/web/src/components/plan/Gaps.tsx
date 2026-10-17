'use client'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import manifest from '@paddlesnitch/waterways/data/manifest.json'
import type { CoverageLevel, WaterwayCoverage } from '@paddlesnitch/waterways/waterway-coverage'
import LoadingState from '@/components/LoadingState'
import { COVERAGE_LEVELS } from '@/lib/plan-ui'

// The gaps table: every scored waterway with what we know, filterable. The
// scores come from /plan/data/{version}/coverage (computed from the live data).

const VERSION = manifest.version ?? 'none'
const PAGE = 100
const BTN = 'text-xs tracking-widest px-3 py-1.5 border border-border hover:border-primary'
const KINDS = [['canal', 'CANALS'], ['navigation', 'NAVIGATIONS'], ['river', 'RIVERS']] as const

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

  if (failed) return <p className="p-6 text-red">Couldn&apos;t load the coverage. Please try again.</p>
  if (!rows) return <LoadingState label="Working out what we know…" />

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <section className="space-y-2">
        <h1 className="text-sm tracking-[0.2em] uppercase text-fg">Gaps</h1>
        <p className="text-sm text-muted max-w-3xl">
          Every canal, navigation and river over 10 km we cover in the UK and Ireland, and what we know about it, worked out from the data.
          We&apos;d rather show a gap than guess. The biggest one: we know which bank to land on at {totals.sides} of {totals.locks.toLocaleString()} locks.
          No open source records portage sides; paddlers will be able to add them.
        </p>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm" data-testid="gaps-totals">
          {COVERAGE_LEVELS.map(l => (
            <div key={l.id}><dt className="inline text-xs tracking-widest" style={{ color: l.colour }}>{l.label} </dt><dd className="inline tabular">{Math.round(totals.km[l.id]).toLocaleString()} km</dd></div>
          ))}
        </dl>
        <ul className="text-xs text-muted space-y-0.5">
          {COVERAGE_LEVELS.map(l => <li key={l.id}><span style={{ color: l.colour }}>{l.label}</span>: {l.says}</li>)}
        </ul>
      </section>

      <section className="flex flex-wrap gap-2 items-center">
        {COVERAGE_LEVELS.map(l => (
          <button key={l.id} type="button" aria-pressed={levels.has(l.id)} className={`${BTN} ${levels.has(l.id) ? 'text-fg' : 'text-muted'}`}
            style={levels.has(l.id) ? { borderColor: l.colour } : undefined} onClick={() => { setLevels(s => toggle(s, l.id)); setShown(PAGE) }}>{l.label}</button>
        ))}
        {KINDS.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={kinds.has(k)} className={`${BTN} ${kinds.has(k) ? 'border-primary text-fg' : 'text-muted'}`}
            onClick={() => { setKinds(s => toggle(s, k)); setShown(PAGE) }}>{label}</button>
        ))}
        <input className="bg-surface border border-border px-2 py-1 text-sm text-fg" placeholder="Find a waterway" aria-label="Find a waterway"
          value={q} onChange={e => { setQ(e.target.value); setShown(PAGE) }} />
        <span className="text-xs text-muted">{filtered.length.toLocaleString()} waterways</span>
      </section>

      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular" data-testid="gaps-table">
          <thead className="text-xs text-muted tracking-widest text-left">
            <tr className="border-b border-border">
              <th className="py-2 pr-3">WATERWAY</th><th className="pr-3">KM</th><th className="pr-3">LOCKS</th><th className="pr-3">SIDE KNOWN</th>
              <th className="pr-3">WEIRS</th><th className="pr-3">GET IN / OUT</th><th className="pr-3">CREW ACCESS</th><th className="pr-3">FACILITIES</th><th>COVERAGE</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, shown).map(r => {
              const level = COVERAGE_LEVELS.find(l => l.id === r.level)!
              return (
                <tr key={r.id} className="border-b border-border">
                  <td className="py-1.5 pr-3">
                    <Link className="tt-link" href={`/plan?view=${r.at[0].toFixed(4)},${r.at[1].toFixed(4)},12`}>{r.name}</Link>
                    <span className="text-xs text-muted"> · {r.kind}</span>
                  </td>
                  <td className="pr-3">{r.km}</td>
                  <td className="pr-3">{r.locks}</td>
                  <td className={`pr-3 ${r.locks && r.locksWithSide < r.locks ? 'text-red' : ''}`}>{r.locks ? `${r.locksWithSide} / ${r.locks}` : '—'}</td>
                  <td className="pr-3">{r.weirs}</td>
                  <td className={`pr-3 ${r.access ? '' : 'text-red'}`}>{r.access}</td>
                  <td className="pr-3">{r.crew}</td>
                  <td className="pr-3">{r.facilities}</td>
                  <td style={{ color: level.colour }} className="text-xs tracking-widest">{level.label}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {shown < filtered.length && <button type="button" className={BTN} onClick={() => setShown(n => n + PAGE)}>SHOW MORE</button>}
      <p className="text-xs text-muted">Click a waterway to open it in the planner. Counts are from the data we hold; a lock&apos;s own weir is counted as a weir here.</p>
    </main>
  )
}
