'use client'
import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { fmtClock, split500 } from '@paddlesnitch/analysis/analysis'
import { weeklyKm, weekStreak, monthKm, groupSameOuting, paddleTotals, isMotionOnly, paddleKm } from '@paddlesnitch/core/paddles'
import { fmtWeekday, fmtMonth } from '@paddlesnitch/core/format'
import { Page, PageHeader, Section, Eyebrow } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { Card, Chevron, Stat, EmptyState, cardClass } from '@paddlesnitch/ui/Card'
import type { SessionSummary } from '@paddlesnitch/analysis/analysis-store'
import { trpc } from '@/lib/trpc'
import { PREFILLED_FRESH_MS } from '@/lib/fresh'
import AppHeader from '@/components/AppHeader'
import LoadingState from '@/components/LoadingState'
import RouteThumb from '@paddlesnitch/ui/RouteThumb'
import NoGpsTag from './NoGpsTag'
import { StravaFirstImport } from '@/components/strava/StravaHistoryImport'

// PADDLES: every paddle you've saved, with your totals on top. This is also the
// signed-in home (/ redirects here). It replaces two near-copies: a dashboard at
// /paddles showing the latest four, and the full list at /paddles/library
// (both titled "MY PADDLES"; /paddles/library now redirects here).
//
// Design sprint (2026-10): each row is one tappable card with a chevron; Compare
// is a mode you turn on (it shows the tick boxes); delete lives inside the
// paddle, not on every row.

// Dates in the shared fixed format: the list is rendered on the server too, and
// the browser's own locale and timezone would write them differently.
const fmtDate = fmtWeekday
const fmtSince = fmtMonth

// Where a paddle came from, in sentence case for the row's first line.
const SOURCE: Record<string, string> = { strava: 'Strava', trial: 'Time trial', device: 'Tracker', file: 'File' }
const ALSO: Record<string, string> = { strava: 'Strava', trial: 'a time trial', device: 'the tracker', file: 'a file' }

// The last 12 weeks as bars, this week on the right and highlighted. A week
// without a paddle is a tick on the baseline, so an empty week reads as empty
// rather than as a broken chart.
function WeeksChart({ weeks }: { weeks: { week: string; km: number }[] }) {
  const max = Math.max(1, ...weeks.map(w => w.km))
  return (
    <div className="flex items-end gap-1 h-12 border-b border-border-strong" role="img" aria-label="Kilometres per week, last 12 weeks">
      {weeks.map((w, i) => (
        <div key={w.week} className="flex-1 flex flex-col justify-end h-full" title={`Week of ${w.week}: ${w.km} km`}>
          {w.km > 0 && (
            <div className={`rounded-t-[2px] ${i === weeks.length - 1 ? 'bg-primary-text' : 'bg-primary'}`}
              style={{ height: `${Math.max(8, (w.km / max) * 100)}%` }} />
          )}
        </div>
      ))}
    </div>
  )
}

type Summary = SessionSummary

// What a row shows, whether it opens the paddle or is being picked to compare.
function RowBody({ s, end }: { s: Summary; end?: ReactNode }) {
  return (
    <>
      {isMotionOnly(s) ? <NoGpsTag size={64} /> : <RouteThumb route={s.route} size={64} />}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-muted truncate">
          {fmtDate(s.paddledAt)}{s.source.type !== 'file' && SOURCE[s.source.type] ? ` · ${SOURCE[s.source.type]}` : ''}
          {s.boatClass ? <span className="text-split"> · {s.boatClass}</span> : ''}
        </p>
        <p className="text-lg font-semibold tabular text-fg">{paddleKm(s)} · {fmtClock(s.durationS)}</p>
        <p className="text-sm text-muted tabular">
          {isMotionOnly(s)
            ? <>{s.avgSR != null ? `${Math.round(s.avgSR)} spm` : ''}</>
            : <>{split500(s.cruiseSpeed)} /500{s.avgSR != null && <> · {Math.round(s.avgSR)} spm</>}</>}
        </p>
        {s.note?.trim() && <p className="text-sm text-split mt-0.5 truncate">{s.note}</p>}
      </div>
      {end}
    </>
  )
}

export default function PaddlesList() {
  const [comparing, setComparing] = useState(false)
  const [sel, setSel] = useState<string[]>([])
  // Ask who's signed in first: the paddle queries are protected, and firing them
  // signed out logged a 401 in the console on every visit.
  const me = trpc.me.useQuery(undefined, { staleTime: PREFILLED_FRESH_MS })
  const signedIn = !!me.data?.user
  const q = trpc.paddles.sessions.useQuery(undefined, { retry: false, enabled: signedIn, staleTime: PREFILLED_FRESH_MS })

  // Pick up to two to compare; a third replaces the older pick.
  const toggle = (id: string) => setSel(s => s.includes(id) ? s.filter(x => x !== id) : s.length < 2 ? [...s, id] : [s[1], id])
  const stopComparing = () => { setComparing(false); setSel([]) }

  const header = <AppHeader breadcrumb={null} />

  if (me.data && !me.data.user) return (
    <main className="flex-1 flex flex-col">
      {header}
      <Page width="narrow">
        <PageHeader title="Paddles" />
        <EmptyState title="Sign in to see your paddles" body="Add a paddle from a GPS file, Strava or a tracker, and keep them all here."
          action={<a href="/signin?next=/paddles" className={buttonClass('primary')}>Sign in</a>} />
      </Page>
    </main>
  )

  const sessions = q.data
  // Worked out from the same list: a second request read every paddle again.
  const totals = sessions ? paddleTotals(sessions) : undefined
  const empty = sessions?.length === 0
  const canCompare = !!sessions && sessions.length > 1

  return (
    <main className="flex-1 flex flex-col">
      {header}
      <Page>
        <PageHeader title="Paddles"
          actions={!empty && <Link href="/paddles/new" className={buttonClass('primary')}>Add paddle</Link>} />

        {/* Connecting Strava brings in about the last month by itself (#415). */}
        <StravaFirstImport />

        {sessions && sessions.length > 0 && (() => {
          const now = new Date()
          const weeks = weeklyKm(sessions, now)
          const streak = weekStreak(sessions, now)
          const month = monthKm(sessions, now)
          const quiet = weeks.every(w => w.km === 0)
          return (
            <section className={`${cardClass} p-4 flex flex-col gap-4`} aria-label="Logbook">
              <div className="grid grid-cols-3 gap-3">
                <Stat label="This week" value={`${weeks[weeks.length - 1].km} km`} />
                <Stat label="This month" value={`${month.thisMonth} km`} sub={`${month.lastMonth} km last month`} />
                <Stat label="Streak" value={streak ? `${streak} wk` : '—'} sub={streak ? `week${streak === 1 ? '' : 's'} in a row` : 'start one this week'} />
              </div>
              <div className="flex flex-col gap-2">
                <Eyebrow>Last 12 weeks</Eyebrow>
                {quiet
                  ? <p className="text-sm text-muted">No paddles in the last 12 weeks.</p>
                  : <WeeksChart weeks={weeks} />}
              </div>
              {totals && (
                <p className="text-sm text-muted">
                  In all: {totals.count} paddle{totals.count === 1 ? '' : 's'}, {totals.totalKm.toFixed(1)} km, {fmtClock(totals.totalS)} on the water{totals.since ? `, since ${fmtSince(totals.since)}` : ''}.
                </p>
              )}
            </section>
          )
        })()}

        {sessions === undefined && <LoadingState label="Loading" className="py-10" />}
        {empty && (
          <EmptyState title="No paddles yet" body="Add one from a GPS file, Strava or a time trial. A tracker adds its own."
            action={<Link href="/paddles/new" className={buttonClass('primary')}>Add paddle</Link>} />
        )}

        {sessions && sessions.length > 0 && (
          <Section title={comparing ? 'Pick two to compare' : 'All paddles'}
            actions={!comparing && (
              <div className="flex gap-2">
                {canCompare && <button type="button" onClick={() => setComparing(true)} className={buttonClass('secondary', 'sm')}>Compare</button>}
                <Link href="/paddles/sections" className={buttonClass('secondary', 'sm')}>Sections</Link>
              </div>
            )}>
            {comparing && (
              <Card className="sticky top-2 z-10 flex flex-wrap items-center gap-3 justify-between shadow-lg">
                <p className="text-sm text-muted" role="status">
                  {sel.length === 2 ? 'Ready to compare.' : sel.length === 1 ? 'Pick one more.' : 'Tick two paddles.'}
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={stopComparing} className={buttonClass('quiet')}>Cancel</button>
                  {sel.length === 2
                    ? <Link href={`/paddles/compare?a=${sel[0]}&b=${sel[1]}`} className={buttonClass('primary')}>Compare these two</Link>
                    : <button type="button" disabled className={buttonClass('primary')}>Compare these two</button>}
                </div>
              </Card>
            )}

            <ul className="flex flex-col gap-2">
              {groupSameOuting(sessions).map(({ lead: s, others }) => (
                <li key={s.id} className={cardClass}>
                  {comparing ? (
                    // A paddle without a map (#414) isn't offered to compare.
                    isMotionOnly(s) ? (
                      <div className="flex gap-3 items-center p-3 opacity-50">
                        <span className="w-5 shrink-0" />
                        <RowBody s={s} />
                      </div>
                    ) : (
                      <label className={`flex gap-3 items-center p-3 cursor-pointer rounded-control ${sel.includes(s.id) ? 'bg-primary/15' : 'hover:bg-surface-2'}`}>
                        <input type="checkbox" checked={sel.includes(s.id)} onChange={() => toggle(s.id)} className="accent-primary w-5 h-5 shrink-0" aria-label="Compare" />
                        <RowBody s={s} />
                      </label>
                    )
                  ) : (
                    <Link href={`/paddles/${s.id}`} className="flex gap-3 items-center p-3 rounded-control transition-colors hover:bg-surface-2">
                      <RowBody s={s} end={<Chevron />} />
                    </Link>
                  )}
                  {/* The same outing from another source: shown once, with a way
                      to compare the two recordings. */}
                  {!comparing && others.map(o => (
                    <Link key={o.id} href={`/paddles/compare?a=${s.id}&b=${o.id}`}
                      className="flex items-center justify-between gap-3 border-t border-border px-3 min-h-11 text-sm text-muted hover:text-fg">
                      <span>Also recorded by {ALSO[o.source.type] ?? 'a file'}</span>
                      <span className="text-primary-text">Compare →</span>
                    </Link>
                  ))}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </Page>
    </main>
  )
}
