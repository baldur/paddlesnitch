'use client'
import { fmtDayTime, fmtTime } from '@paddlesnitch/core/format'
import type { ComputedPlan } from '@paddlesnitch/waterways/plan'
import type { RouteConditions } from '@paddlesnitch/waterways/live-store'
import { fmtDuration } from '@paddlesnitch/waterways/plan'
import { BOARD_TEXT, daylightSummary, GAUGE_STATE_TEXT, km, tideNote, type TideWindow } from '@/lib/plan-ui'

// "Conditions now" for a plan (docs/features/river-planner.md, P5): daylight
// at the finish, the Thames boards on your reaches, and the river gauges along
// the way. Live and best-effort: a source that can't be read says so; nothing
// unread is ever shown as "no warning".

export default function Conditions({ plan, startAt, tide, data, loading, failed, print = false }: {
  plan: ComputedPlan
  startAt?: string
  tide: TideWindow | null
  data: RouteConditions | null | undefined
  loading: boolean
  failed: boolean
  print?: boolean
}) {
  const day = daylightSummary(plan, startAt)
  const h2 = print ? 'font-semibold' : 'text-base font-semibold text-fg mb-2'
  const muted = print ? 'text-gray-700' : 'text-muted'
  const warn = print ? 'font-semibold' : 'text-red'
  const raised = data?.thames?.reaches.filter(r => r.level !== 'none') ?? []
  return (
    <section className={print ? 'avoid-break mb-4 text-sm space-y-2' : 'space-y-3'} data-testid="conditions">
      <h2 className={h2}>Conditions now</h2>

      {day && (
        <p data-testid="daylight">
          {day.sunrise && day.sunset ? <>Sunrise {fmtTime(day.sunrise)}, sunset {fmtTime(day.sunset)} on your start day. </> : null}
          {day.darkStops ? <span className={warn}>{day.darkStops} stop{day.darkStops === 1 ? '' : 's'} reached in the dark.</span> : 'You finish in daylight.'}
        </p>
      )}
      {!day && <p className={muted}>Set a start time to see where you&apos;ll be at sunset.</p>}

      {plan.tidalFromM !== undefined && !startAt && <p className={muted}>Your route reaches tidal water: set a start time to see the tide when you get there.</p>}
      {tide && (
        <div data-testid="tide">
          <p className="font-medium">Tide when you reach tidal water</p>
          <p>
            You reach it at <span className="tabular">{fmtDayTime(tide.reachAt)}</span>
            {tide.afterHigh && <>, {Math.abs(tide.afterHigh.minutes) < 5 ? 'at high water' : `${fmtDuration(Math.abs(tide.afterHigh.minutes) * 60)} ${tide.afterHigh.minutes > 0 ? 'after' : 'before'} high water`} at {tide.afterHigh.gauge} ({fmtTime(tide.afterHigh.at)})</>}.
          </p>
          <ul className="space-y-0.5">
            {tide.gauges.map(g => (
              <li key={g.id}>
                <span className="font-medium">{g.label}</span>:{' '}
                {g.extremes.map((e, i) => <span key={i} className="tabular">{i > 0 && ', '}{e.type === 'high' ? 'HW' : 'LW'} {fmtTime(e.at)} ({e.height.toFixed(1)} m)</span>)}
                <span className={muted}> · within {g.p95Min} min in 95% of last month&apos;s highs</span>
              </li>
            ))}
          </ul>
          <p className={`text-sm ${muted}`}>{tideNote(tide)}</p>
        </div>
      )}
      {plan.tidalFromM !== undefined && startAt && !tide?.gauges.length && <p className={muted}>Tide predictions aren&apos;t ready yet for this stretch.</p>}

      {loading && <p className={muted}>Reading the river gauges…</p>}
      {failed && <p className={warn}>Couldn&apos;t read river conditions just now: levels and stream warnings unknown.</p>}

      {data?.thames && (
        <div>
          <p className="font-medium">
            Thames stream warnings{data.thames.updated ? <span className={muted}> (updated {data.thames.updated})</span> : null}
          </p>
          {raised.length
            ? <ul>{raised.map(r => <li key={`${r.from}-${r.to}`} className={warn}>{r.from}{r.to ? ` to ${r.to}` : ''}: {BOARD_TEXT[r.level] || r.condition}</li>)}</ul>
            : <p>No stream warnings on your reaches ({data.thames.reaches.length}).</p>}
          {!print && <a className="tt-link text-sm" href={data.thames.url} target="_blank" rel="noreferrer">Check the boards on GOV.UK</a>}
        </div>
      )}

      {data && (data.gauges.length ? (
        <div>
          <p className="font-medium">River levels</p>
          <ul className="space-y-0.5" data-testid="gauges">
            {data.gauges.map(g => (
              <li key={`${g.source}-${g.id}`}>
                <span className="tabular">{km(g.chainageM)}</span>{' '}
                {print ? g.name : <a className="tt-link" href={g.url} target="_blank" rel="noreferrer">{g.name}</a>}
                {g.river ? <span className={muted}> · {g.river}</span> : null}
                {': '}
                {g.valueM === undefined ? <span className={muted}>no recent reading</span> : <>
                  <span className="tabular">{g.valueM.toFixed(2)} m{g.datum === 'nap' ? ' NAP' : ''}</span>
                  {g.state && <span className={g.state === 'normal' ? muted : warn}> {GAUGE_STATE_TEXT[g.state]}</span>}
                  {g.readAt && <span className={muted}> at {fmtTime(g.readAt)}</span>}
                </>}
              </li>
            ))}
          </ul>
        </div>
      ) : <p className={muted}>No river gauges on this route.</p>)}

      {!!data?.unavailable.length && (
        <p className={warn}>Couldn&apos;t read {data.unavailable.join(', ')} just now: conditions from {data.unavailable.length === 1 ? 'it' : 'them'} unknown.</p>
      )}
      <p className={`text-sm ${muted}`}>
        Live readings{data ? ` at ${fmtTime(data.fetchedAt)}` : ''}: check again on the day, and the boards and lock staff on the water. Not for safety-critical use.
      </p>
    </section>
  )
}
