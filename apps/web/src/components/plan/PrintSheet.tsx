'use client'
import Link from 'next/link'
import { fmtDay, fmtDayTime, fmtTime } from '@paddlesnitch/core/format'
import { fmtDuration, timePlan, type ComputedPlan, type Stop } from '@paddlesnitch/waterways/plan'
import type { SavedPlan } from '@paddlesnitch/waterways/plan-store'
import { SOURCES } from '@paddlesnitch/waterways/sources'
import { buttonClass } from '@paddlesnitch/ui/Button'
import LoadingState from '@/components/LoadingState'
import Conditions from '@/components/plan/Conditions'
import PortageDrawing from '@/components/plan/PortageDrawing'
import { TIDES, useOfficialTides } from '@/lib/tides'
import { trpc } from '@/lib/trpc'
import {
  aerialPhotoUrl, crewLines, draftParams, groupOf, isCrewStop, PHOTO_CREDIT, printablePhotos, isDarkStop, km, portageLines, portageMap, printHref, shownGroups, stopLines, tideWindow, type PlanDraft,
} from '@/lib/plan-ui'

// The paper copy of a plan (docs/features/river-planner.md, "Print"): black on
// white, large enough to read in a map case, one block per stop. The crew
// sheet keeps only places a crew can reach, with postcodes and parking.

const KIND: Record<string, string> = {
  lock: 'Lock', portage: 'Portage', weir: 'Weir', access: 'Wharf', slipway: 'Slipway',
  facility: 'Facilities', crew_point: 'Towpath access', hazard: 'Hazard',
}
const CREDITED = (Object.keys(SOURCES) as (keyof typeof SOURCES)[]).filter(id => id !== 'contribution' && id !== 'curated')

export default function PrintSheet({ draft, id, share, crew, show }: { draft: PlanDraft; id?: string; share?: string; crew: boolean; show?: string }) {
  const groups = shownGroups(show)
  const me = trpc.me.useQuery(undefined, { retry: false })
  const mine = trpc.plan.get.useQuery({ id: id ?? '' }, { enabled: !!id && !!me.data?.user, retry: false })
  const shared = trpc.plan.shared.useQuery({ shareId: share ?? '' }, { enabled: !!share, retry: false })
  const saved: SavedPlan | undefined = mine.data ?? shared.data?.plan
  const routed = trpc.plan.route.useQuery(
    { start: draft.start ?? [0, 0], finish: draft.finish, shape: draft.shape },
    { enabled: !!draft.start && !!draft.finish, staleTime: Infinity },
  )
  const result = routed.data?.plan
  const officialTides = useOfficialTides(typeof result === 'string' ? null : result)
  const conditions = trpc.plan.conditions.useQuery(
    { start: draft.start ?? [0, 0], finish: draft.finish ?? [0, 0] },
    { enabled: !!draft.start && !!draft.finish, staleTime: 10 * 60_000, retry: false },
  )
  if (!draft.start || !draft.finish) return <Message>Plan a route first: this page prints the one on screen.</Message>
  if (routed.isError || typeof result === 'string') return <Message>Couldn&apos;t work out the route. Please try again.</Message>
  if (!result || (id && me.isLoading) || (id && me.data?.user && mine.isLoading) || (share && shared.isLoading)) return <LoadingState label="Preparing the sheet…" />
  const plan = timePlan(result, draft)
  const title = saved?.title ?? 'River plan'
  const notes = saved?.notes, stopNotes = saved?.stopNotes ?? {}
  const stops = plan.stops.filter(s => (crew ? isCrewStop(s) : groups.has(groupOf(s.feature.kind))))
  const back = id ? `/plan/${id}` : share ? `/plan/shared/${share}` : `/plan?${draftParams(draft)}`

  return (
    <div className="py-6 px-4">
      <article className="print-sheet mx-auto max-w-[210mm] bg-white text-black rounded-control shadow-lg p-6 sm:p-8 text-[15px] leading-snug" data-testid="print-sheet">
        <div className="no-print flex flex-wrap gap-2 mb-6">
          <button type="button" className={buttonClass('primary')} onClick={() => window.print()}>Print</button>
          <Link className={buttonClass('secondary')} href={back}>Back to the plan</Link>
          <Link className={buttonClass('secondary')} href={printHref(draft, { id, share, crew: !crew, show: [...groups] })}>
            {crew ? 'Route sheet instead' : 'Crew sheet instead'}
          </Link>
        </div>

        <header className="avoid-break border-b-2 border-black pb-3 mb-4">
          <p className="text-xs font-mono uppercase tracking-[0.15em]">{crew ? 'Crew sheet' : 'Route sheet'} · paddlesnitch.com/plan</p>
          <h1 className="text-2xl font-semibold mt-1">{title}</h1>
          <p className="mt-1">
            {plan.start.waterway || 'unnamed water'} to {plan.finish.waterway || 'unnamed water'} · {draft.shape === 'return' ? 'return' : 'one-way'}
            {draft.startAt && <> · {fmtDay(draft.startAt)}</>}
            {plan.canoeRoutes?.length ? <> · on {plan.canoeRoutes.join(', ')}</> : null}
          </p>
          <dl className="mt-3 grid grid-cols-3 sm:grid-cols-6 gap-3 font-mono">
            <Fact label="Distance" value={km(plan.lengthM)} />
            <Fact label="Portages" value={String(plan.portages)} />
            <Fact label="Paddling" value={fmtDuration(plan.movingS)} />
            <Fact label="With portages" value={fmtDuration(plan.totalS)} />
            <Fact label="Start" value={draft.startAt ? fmtTime(draft.startAt) : '—'} />
            <Fact label="Finish" value={plan.finishAt ? fmtDayTime(plan.finishAt) : '—'} />
          </dl>
          <p className="mt-2 text-sm">Pace {draft.paceKmh} km/h, {draft.portageMinutes} min per portage.</p>
        </header>

        {notes && (
          <section className="avoid-break mb-4">
            <h2 className="font-semibold">Notes</h2>
            <p className="whitespace-pre-line">{notes}</p>
          </section>
        )}

        <Conditions plan={plan} startAt={draft.startAt} tide={tideWindow(plan, draft, TIDES, officialTides)} data={conditions.data} loading={conditions.isLoading} failed={conditions.isError} print />

        {crew
          ? <CrewTable plan={plan} stops={stops} startAt={draft.startAt} notes={stopNotes} />
          : <RouteTable plan={plan} stops={stops} startAt={draft.startAt} notes={stopNotes} />}

        <footer className="mt-6 pt-3 border-t border-black text-xs space-y-1">
          <p><strong>Not a navigation authority.</strong> Check stream warnings, lock notices and, below Teddington, the tide before you go. Portage sides marked unknown are unknown: look before you land.</p>
          <p>Data: {CREDITED.map(c => SOURCES[c].attribution).join(' · ')}. Portage details from paddlers, CC0.{photoCredits(stops)}</p>
          <p>Printed from paddlesnitch.com/plan.</p>
        </footer>
      </article>
    </div>
  )
}

function Message({ children }: { children: React.ReactNode }) {
  return <p className="p-6 text-base text-muted max-w-xl mx-auto">{children}</p>
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-[11px] uppercase tracking-[0.1em]">{label}</dt><dd className="text-base font-semibold">{value}</dd></div>
}

// Local calendar days between two times, for "+1" after midnight.
function dayOffset(from: string, to: string): number {
  const a = new Date(from), b = new Date(to)
  return Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() - new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()) / 86_400_000)
}
const when = (s: Stop, startAt?: string) => {
  if (!s.eta || !startAt) return fmtDuration(s.elapsedS)
  const d = dayOffset(startAt, s.eta)
  return `${fmtTime(s.eta)}${d > 0 ? ` +${d}` : ''}`
}
const turnIndex = (plan: ComputedPlan, stops: Stop[]) => (plan.turnM != null ? stops.findIndex(s => s.leg === 'back') : -1)

function RouteTable({ plan, stops, startAt, notes }: { plan: ComputedPlan; stops: Stop[]; startAt?: string; notes: Record<string, string> }) {
  const turn = turnIndex(plan, stops)
  return (
    <table className="w-full border-collapse" data-testid="print-stops">
      <thead>
        <tr className="border-b border-black text-left text-[11px] uppercase tracking-[0.1em] font-mono">
          <th className="py-1 pr-2 w-14">km</th><th className="py-1 pr-2 w-16">{startAt ? 'Time' : 'After'}</th><th className="py-1">Stop</th>
        </tr>
      </thead>
      <tbody>
        {stops.map((s, i) => (
          <tr key={`${s.leg}-${s.feature.id}-${i}`} className={`border-b border-gray-400 align-top ${i === turn ? 'border-t-2 border-t-black' : ''}`}>
            <td className="py-1.5 pr-2 font-mono">{km(s.chainageM).replace(' km', '')}</td>
            <td className="py-1.5 pr-2 font-mono font-semibold">{when(s, startAt)}{isDarkStop(s) && <span className="block text-[11px] font-normal">dark</span>}</td>
            <td className="py-1.5">
              {drawn(s) && <PrintedPortage line={plan.line} stop={s} />}
              {i === turn && <p className="font-mono text-[11px] uppercase tracking-[0.1em]">Turn at {km(plan.turnM!)}</p>}
              <p className="font-semibold">{s.feature.name ?? KIND[s.feature.kind]}<span className="font-normal"> · {KIND[s.feature.kind]}</span></p>
              {s.portages?.flatMap(p => portageLines(p).map((l, j) => <p key={`${p.id}-${j}`}>{l} <span className="text-gray-600">({p.by})</span></p>))}
              {stopLines(s).map((l, j) => <p key={j}>{l}</p>)}
              {notes[s.feature.id] && <p className="mt-0.5 italic">Note: {notes[s.feature.id]}</p>}
            </td>
          </tr>
        ))}
        {stops.length === 0 && <tr><td colSpan={3} className="py-2">No stops on this stretch.</td></tr>}
      </tbody>
    </table>
  )
}

/** Where to land at a portage, drawn from our data (the satellite imagery
 *  may not be printed): route, direction, take-out (T), put-in (P), carry. */
function PrintedPortage({ line, stop }: { line: ComputedPlan['line']; stop: Stop }) {
  const map = portageMap(line, stop, stop.portages?.[0])
  const region = printablePhotos(stop.feature.at)
  return <PortageDrawing map={map} id={`${stop.leg}-${stop.feature.id}`} name={stop.feature.name}
    photo={region ? aerialPhotoUrl(map, region) : undefined}
    className="avoid-break float-right ml-3 mb-1 w-[38mm] h-[38mm]" />
}

/** A drawing beside a stop: where paddlers described the landings, and where
 *  there's a printable aerial photo (the Netherlands, Flanders, France) at every lock. */
const photoCredits = (stops: Stop[]) => {
  const regions = [...new Set(stops.filter(drawn).map(s => printablePhotos(s.feature.at)).filter((r): r is 'nl' | 'vl' | 'fr' => !!r))]
  return regions.length ? ` Aerial photos: ${regions.map(r => PHOTO_CREDIT[r]).join('; ')}.` : ''
}

const drawn = (s: Stop) => !!s.portages?.[0] || (s.portage && !!printablePhotos(s.feature.at))

function CrewTable({ plan, stops, startAt, notes }: { plan: ComputedPlan; stops: Stop[]; startAt?: string; notes: Record<string, string> }) {
  const turn = turnIndex(plan, stops)
  return (
    <table className="w-full border-collapse" data-testid="print-stops">
      <thead>
        <tr className="border-b border-black text-left text-[11px] uppercase tracking-[0.1em] font-mono">
          <th className="py-1 pr-2 w-16">{startAt ? 'Paddler at' : 'After'}</th><th className="py-1 pr-2">Where</th><th className="py-1 pr-2 w-24">Postcode</th>
        </tr>
      </thead>
      <tbody>
        {stops.map((s, i) => {
          const c = crewLines(s)
          return (
            <tr key={`${s.leg}-${s.feature.id}-${i}`} className={`border-b border-gray-400 align-top ${i === turn ? 'border-t-2 border-t-black' : ''}`}>
              <td className="py-1.5 pr-2 font-mono font-semibold">{when(s, startAt)}</td>
              <td className="py-1.5 pr-2">
                <p className="font-semibold">{s.feature.name ?? KIND[s.feature.kind]}<span className="font-normal"> · {km(s.chainageM)}</span></p>
                {c.lines.map((l, j) => <p key={j}>{l}</p>)}
                {notes[s.feature.id] && <p className="mt-0.5 italic">Note: {notes[s.feature.id]}</p>}
              </td>
              <td className="py-1.5 pr-2 font-mono font-semibold">{c.postcode ?? '—'}</td>
            </tr>
          )
        })}
        {stops.length === 0 && <tr><td colSpan={3} className="py-2">We don&apos;t know of anywhere a crew can reach on this stretch yet.</td></tr>}
      </tbody>
    </table>
  )
}
