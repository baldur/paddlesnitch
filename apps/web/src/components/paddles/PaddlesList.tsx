'use client'
import Link from 'next/link'
import { useState } from 'react'
import { fmtClock, split500 } from '@paddlesnitch/analysis/analysis'
import { sourceLabel, weeklyKm, weekStreak, monthKm, groupSameOuting, paddleTotals } from '@paddlesnitch/core/paddles'
import { fmtWeekday, fmtMonth } from '@paddlesnitch/core/format'
import { trpc } from '@/lib/trpc'
import { PREFILLED_FRESH_MS } from '@/lib/fresh'
import AppHeader from '@/components/AppHeader'
import RouteThumb from '@paddlesnitch/ui/RouteThumb'

// PADDLES: every paddle you've saved, with your totals on top. This is also the
// signed-in home (/ redirects here). It replaces two near-copies: a dashboard at
// /paddles showing the latest four, and the full list at /paddles/library
// (both titled "MY PADDLES"; /paddles/library now redirects here).

// Dates in the shared fixed format: the list is rendered on the server too, and
// the browser's own locale and timezone would write them differently.
const fmtDate = fmtWeekday
const fmtSince = fmtMonth

// The last 12 weeks as bars, this week on the right and highlighted.
function WeeksChart({ weeks }: { weeks: { week: string; km: number }[] }) {
  const max = Math.max(1, ...weeks.map(w => w.km))
  return (
    <div className="flex items-end gap-1 h-16" role="img" aria-label="Kilometres per week, last 12 weeks">
      {weeks.map((w, i) => (
        <div key={w.week} className="flex-1 flex flex-col justify-end h-full" title={`Week of ${w.week}: ${w.km} km`}>
          <div className={i === weeks.length - 1 ? 'bg-primary' : 'bg-surface-2'} style={{ height: `${Math.max(w.km > 0 ? 6 : 2, (w.km / max) * 100)}%` }} />
        </div>
      ))}
    </div>
  )
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <div className="text-[10px] text-muted tracking-widest">{label}</div>
      <div className="text-lg font-bold tabular">{value}</div>
      {note && <div className="text-[11px] text-muted">{note}</div>}
    </div>
  )
}

export default function PaddlesList() {
  const [sel, setSel] = useState<string[]>([])
  const [confirming, setConfirming] = useState<string | null>(null)
  // Ask who's signed in first: the paddle queries are protected, and firing them
  // signed out logged a 401 in the console on every visit.
  const me = trpc.me.useQuery(undefined, { staleTime: PREFILLED_FRESH_MS })
  const signedIn = !!me.data?.user
  const q = trpc.paddles.sessions.useQuery(undefined, { retry: false, enabled: signedIn, staleTime: PREFILLED_FRESH_MS })
  const utils = trpc.useUtils()
  const delMut = trpc.paddles.delete.useMutation({
    onSuccess: () => { utils.paddles.sessions.invalidate() },
  })

  const del = async (id: string) => {
    await delMut.mutateAsync({ id })
    setConfirming(null)
    setSel(s => s.filter(x => x !== id))
  }
  // Pick up to two to compare; a third replaces the older pick.
  const toggle = (id: string) => setSel(s => s.includes(id) ? s.filter(x => x !== id) : s.length < 2 ? [...s, id] : [s[1], id])

  const header = <AppHeader breadcrumb={null} />

  if (me.data && !me.data.user) return (
    <main className="flex-1 flex flex-col">
      {header}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">
        <div className="bg-surface border border-border w-full max-w-md p-6 text-center">
          <h1 className="text-lg font-bold tracking-widest">PADDLES</h1>
          <p className="text-xs text-muted mt-2 mb-5">Sign in to analyse and save your paddles.</p>
          <a href="/signin?next=/paddles" className="inline-block px-6 py-2.5 bg-primary text-white text-xs font-bold tracking-widest hover:opacity-90">SIGN IN</a>
        </div>
      </div>
    </main>
  )

  const sessions = q.data
  // Worked out from the same list: a second request read every paddle again.
  const totals = sessions ? paddleTotals(sessions) : undefined

  return (
    <main className="flex-1 flex flex-col">
      {header}
      <div className="max-w-3xl mx-auto px-4 py-6 w-full">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-lg font-bold tracking-widest">PADDLES</h1>
          <Link href="/paddles/new" className="px-4 py-2 bg-primary text-white text-xs font-bold tracking-widest hover:opacity-90">+ ADD A PADDLE</Link>
        </div>

        {sessions && sessions.length > 0 && (() => {
          const now = new Date()
          const weeks = weeklyKm(sessions, now)
          const streak = weekStreak(sessions, now)
          const month = monthKm(sessions, now)
          return (
            <section className="bg-surface border border-border p-4 mb-6 flex flex-col gap-4" aria-label="Logbook">
              <div className="grid grid-cols-3 gap-3">
                <Figure label="THIS WEEK" value={`${weeks[weeks.length - 1].km} km`} />
                <Figure label="THIS MONTH" value={`${month.thisMonth} km`} note={`${month.lastMonth} km last month`} />
                <Figure label="STREAK" value={streak ? `${streak} week${streak === 1 ? '' : 's'}` : '—'} note={streak ? 'in a row with a paddle' : 'paddle this week to start one'} />
              </div>
              <WeeksChart weeks={weeks} />
              {totals && (
                <p className="text-[11px] text-muted tabular">
                  In all: {totals.count} paddle{totals.count === 1 ? '' : 's'}, {totals.totalKm.toFixed(1)} km, {fmtClock(totals.totalS)} on the water{totals.since ? `, since ${fmtSince(totals.since)}` : ''}.
                </p>
              )}
            </section>
          )
        })()}

        {sel.length === 2 && (
          <Link href={`/paddles/compare?a=${sel[0]}&b=${sel[1]}`}
            className="block mb-4 px-4 py-2 bg-primary text-white text-xs font-bold tracking-widest text-center">COMPARE THESE TWO →</Link>
        )}
        {sessions && sessions.length > 1 && sel.length < 2 && (
          <p className="text-[11px] text-muted mb-4">{sel.length === 1 ? 'Pick one more to compare.' : 'Tick two paddles to compare them.'}</p>
        )}

        {sessions === undefined && <p className="text-sm text-muted">Loading…</p>}
        {sessions && sessions.length === 0 && (
          <div className="bg-surface border border-border p-6 text-center">
            <p className="text-sm text-muted">No paddles yet.</p>
            <Link href="/paddles/new" className="mt-3 inline-block px-5 py-2.5 bg-primary text-white text-xs font-bold tracking-widest hover:opacity-90">ADD YOUR FIRST ONE →</Link>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {sessions && groupSameOuting(sessions).map(({ lead: s, others }) => (
            <div key={s.id} className="border border-border p-3 flex gap-3 items-center">
              <input type="checkbox" checked={sel.includes(s.id)} onChange={() => toggle(s.id)} className="accent-primary" aria-label="Compare" />
              <Link href={`/paddles/${s.id}`} className="flex gap-3 items-center flex-1 min-w-0 group">
                <RouteThumb route={s.route} size={64} />
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-muted tracking-widest">
                    {fmtDate(s.paddledAt).toUpperCase()}{sourceLabel(s.source.type)}{s.boatClass ? <span className="text-split"> · {s.boatClass}</span> : ''}
                  </div>
                  <div className="text-sm tabular mt-0.5 group-hover:text-primary transition-colors">
                    <b>{s.distanceKm.toFixed(2)} km</b> · {fmtClock(s.durationS)}
                  </div>
                  <div className="text-xs text-muted tabular mt-0.5">
                    {split500(s.cruiseSpeed)}/500{s.avgSR != null && <> · {Math.round(s.avgSR)} spm</>}
                  </div>
                  {s.note?.trim() && <div className="text-xs text-split mt-1 truncate">{s.note}</div>}
                </div>
              </Link>
              {/* The same outing from another source: shown once, with a way
                  to compare the two recordings. */}
              {others.map(o => (
                <Link key={o.id} href={`/paddles/compare?a=${s.id}&b=${o.id}`} className="shrink-0 text-[10px] tracking-widest text-muted border border-border px-2 py-1 hover:text-fg hover:border-primary">
                  +{sourceLabel(o.source.type).replace(' · ', ' ') || ' FILE'}
                </Link>
              ))}
              <div className="shrink-0 text-[10px] tracking-widest">
                {confirming === s.id ? (
                  <span className="flex gap-2 items-center">
                    <span className="text-muted">DELETE?</span>
                    <button onClick={() => del(s.id)} disabled={delMut.isPending} className="text-red hover:underline disabled:opacity-50">YES</button>
                    <button onClick={() => setConfirming(null)} className="text-muted hover:text-fg">NO</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirming(s.id)} className="text-muted hover:text-red">DELETE</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
