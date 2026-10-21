'use client'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { keepPreviousData } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { fmtDay, fmtDayTime, fmtTime } from '@paddlesnitch/core/format'
import manifest from '@paddlesnitch/waterways/data/manifest.json'
import { searchPlaces, type Place } from '@paddlesnitch/waterways/places'
import { fmtDuration, timePlan, type ComputedPlan, type Spot, type Stop } from '@paddlesnitch/waterways/plan'
import type { SavedPlan } from '@paddlesnitch/waterways/plan-store'
import { NATIONAL } from '@paddlesnitch/waterways/regions'
import { SOURCES } from '@paddlesnitch/waterways/sources'
import type { LatLng } from '@paddlesnitch/waterways/types'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { Field, inputClass } from '@paddlesnitch/ui/Form'
import { eyebrowClass } from '@paddlesnitch/ui/Layout'
import { Stat } from '@paddlesnitch/ui/Card'
import PlanMapClient from '@/components/map/PlanMapClient'
import Conditions from '@/components/plan/Conditions'
import EndSearch from '@/components/plan/EndSearch'
import { TIDES, useOfficialTides } from '@/lib/tides'
import type { MapFocus } from '@/components/map/PlanMap'
import { trpc } from '@/lib/trpc'
import {
  addPortageHref, asInput, COVERAGE_LEVELS, draftParams, groupOf, isDarkStop, km, localInput, PICK_MIN_ZOOM, stopId, pixelsToMetres, placeClick, PLAN_ERROR_TEXT, portageLines, printHref, STOP_GROUPS, stopLines, tideWindow,
  type LockLink, type PlanDraft, type StopGroup, type View,
} from '@/lib/plan-ui'

// PLAN (docs/features/river-planner.md): click the water for a start and a
// finish, choose one-way or return, and get every stop between with arrival
// times. The server routes on the national network (plan.route); the browser
// works out the times, so pace and start time change instantly. Saving needs
// an account; an unsaved plan lives in the address bar.

const H2 = 'text-base font-semibold text-fg mb-2'
const BTN = buttonClass('secondary', 'sm')
// A toggle (aria-pressed): on reads as selected, off as available.
const toggleClass = (on: boolean) => `${BTN} ${on ? 'border-primary-text! bg-surface-2! text-fg!' : 'text-muted!'}`
const INPUT = `${inputClass} [color-scheme:dark]`
// Where /plan opens with nothing to show: the Thames and Kennet at Reading,
// close enough that a click sets the start (PICK_MIN_ZOOM). A link's view=,
// from= or to= wins.
const FIRST_VIEW: View = { at: [51.462, -0.975], zoom: 13 }
const KIND: Record<string, string> = {
  lock: 'Lock', portage: 'Portage', weir: 'Weir', access: 'Wharf', slipway: 'Slipway',
  facility: 'Facilities', crew_point: 'Towpath access', hazard: 'Hazard',
}

/** Someone's shared plan, seen from its link: the route can't be changed or
 *  saved here, but pace, start time and one-way/return can be tried. */
export type SharedView = { owner: string; mine: boolean; planId: string }

// Every outside source we show data from, credited under the plan.
const CREDITED = (Object.keys(SOURCES) as (keyof typeof SOURCES)[]).filter(id => id !== 'contribution' && id !== 'curated')

// The live dataset's version: the map's network and places URLs carry it.
const VERSION = manifest.version ?? 'none'

export default function Planner({ initial, view, saved, shared, lock, unfound = [] }: {
  initial: PlanDraft; view?: View; saved?: SavedPlan; shared?: SharedView
  unfound?: { end: 'start' | 'finish'; name: string }[]   // place names in the link we couldn't find on the water
  lock?: LockLink   // opened from /plan/gaps: add portage details here
}) {
  const router = useRouter()
  const [draft, setDraft] = useState<PlanDraft>(initial)
  const [shown, setShown] = useState<Set<StopGroup>>(() => new Set(STOP_GROUPS.filter(g => g.on).map(g => g.id)))
  const [focus, setFocus] = useState<MapFocus | null>(null)
  const [satellite, setSatellite] = useState(!!lock)
  const [coverage, setCoverage] = useState(false)
  // Adding portage details at a stop: the landings clicked so far (OpenPortage).
  const [adding, setAdding] = useState<{ stop: Stop; landings: LatLng[] } | null>(() => (lock ? { stop: stopAt(lock), landings: [] } : null))
  const [flagged, setFlagged] = useState<Set<string>>(new Set())
  // A click about as near to two waterways: which one did you mean? (#505)
  const [choosing, setChoosing] = useState<{ choices: Spot[]; offWater: 'start' | 'finish' | null } | null>(null)
  const me = trpc.me.useQuery(undefined, { retry: false })
  const signedIn = !!me.data?.user
  const mine = trpc.portage.mine.useQuery(undefined, { enabled: signedIn, retry: false })
  const utils = trpc.useUtils()
  const refreshPortages = () => { void utils.plan.route.invalidate(); void utils.portage.mine.invalidate() }
  const flag = trpc.portage.flag.useMutation({ onSuccess: (_, v) => { setFlagged(f => new Set(f).add(v.id)); refreshPortages() } })
  const withdraw = trpc.portage.delete.useMutation({ onSuccess: refreshPortages })
  const startAdding = (stop: Stop) => {
    setAdding({ stop, landings: [] })
    setSatellite(true)
    setFocus({ at: stop.feature.at, zoom: 18 })
  }
  // The paddler's own notes (saved plans; a shared plan shows its owner's).
  const own = (saved ?? (shared ? initial : undefined)) as Partial<SavedPlan> | undefined
  const [notes, setNotes] = useState<{ plan: string; stops: Record<string, string> }>({ plan: own?.notes ?? '', stops: own?.stopNotes ?? {} })
  const setNotesMut = trpc.plan.setNotes.useMutation({ onSuccess: p => setNotes({ plan: p.notes ?? '', stops: p.stopNotes ?? {} }) })
  const saveStopNote = saved ? (featureId: string, text: string) => setNotesMut.mutateAsync({ id: saved.id, stop: { featureId, text } }) : undefined
  // The start time box shows the browser's zone, so it stays empty until hydrated.
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false)

  // An unsaved plan lives in the address bar, so a reload or a link keeps it.
  useEffect(() => {
    if (saved || shared) return
    const q = draftParams(draft)
    window.history.replaceState(null, '', `/plan${q ? `?${q}` : ''}`)
  }, [draft, saved, shared])

  const routed = trpc.plan.route.useQuery(
    { start: draft.start ?? [0, 0], finish: draft.finish, shape: draft.shape },
    { enabled: !!draft.start, placeholderData: keepPreviousData, staleTime: Infinity },
  )
  const current = draft.start ? routed.data : undefined
  const error = !draft.start ? null : current && !current.start ? 'start_off_water' as const : typeof current?.plan === 'string' ? current.plan : null
  const plan = useMemo(
    () => (current?.plan && typeof current.plan !== 'string' && draft.finish ? timePlan(current.plan, draft) : null),
    [current, draft],
  )
  const officialTides = useOfficialTides(plan)
  const visible = plan?.stops.filter(s => shown.has(groupOf(s.feature.kind))) ?? []
  const conditions = trpc.plan.conditions.useQuery(
    { start: draft.start ?? [0, 0], finish: draft.finish ?? [0, 0] },
    { enabled: !!plan && !!draft.start && !!draft.finish, staleTime: 10 * 60_000, retry: false },
  )

  return (
    <main className="flex flex-col lg:flex-row lg:h-[calc(100vh-57px)]">
      <div className="h-[50vh] lg:h-auto lg:flex-1 relative" role="region" aria-label="Map. Every stop on it is also in the list of stops.">
        <PlanMapClient
            version={VERSION}
            route={plan?.line ?? []}
            start={draft.start}
            finish={draft.finish}
            stops={visible.filter(s => s.leg === 'out').map(s => ({
              id: s.feature.id, at: s.feature.at, name: s.feature.name ?? KIND[s.feature.kind],
              colour: STOP_GROUPS.find(g => g.id === groupOf(s.feature.kind))!.colour,
            }))}
            focus={focus}
            view={view ?? (initial.start || saved || shared ? undefined : FIRST_VIEW)}
            satellite={satellite}
            coverage={coverage}
            marks={adding?.landings}
            choices={choosing?.choices.map(c => ({ at: c.at, label: c.waterway || 'Unnamed water' }))}
            onPick={(p, zoom) => {
              if (zoom < PICK_MIN_ZOOM) { setFocus({ at: p, zoom: Math.min(zoom + 4, 14) }); return }
              // While adding portage details, clicks place the two landings (a third moves the second).
              if (adding) { setAdding(a => a && ({ ...a, landings: a.landings.length < 2 ? [...a.landings, p] : [a.landings[0], p] })); return }
              if (shared) return
              const offWater = error === 'start_off_water' ? 'start' : error === 'finish_off_water' ? 'finish' : null
              const place = (q: LatLng) => setDraft(d => placeClick(d, q, offWater))
              setChoosing(null)
              utils.plan.choices.fetch({ at: p, radiusM: Math.round(pixelsToMetres(p[0], zoom)) })
                .then(c => (c.length > 1 ? setChoosing({ choices: c, offWater }) : place(p)), () => place(p))
            }}
          />
        {/* Aerial imagery, to see which bank you can land on. */}
        <div className="absolute top-[5.5rem] left-[10px] z-[500] flex flex-col items-start gap-2">
          <button type="button" aria-pressed={satellite} onClick={() => setSatellite(v => !v)}
            className={`${toggleClass(satellite)} bg-bg/90`}>
            Satellite
          </button>
          <button type="button" aria-pressed={coverage} onClick={() => setCoverage(v => !v)}
            className={`${toggleClass(coverage)} bg-bg/90`}>
            Coverage
          </button>
        </div>
        {choosing && (
          <div role="dialog" aria-labelledby="which-water" className="absolute bottom-8 left-2 right-2 sm:right-auto z-[600] sm:max-w-[20rem] rounded-control bg-bg/95 border border-border-strong px-3 py-2 space-y-2" data-testid="which-water">
            <p id="which-water" className="text-base text-fg">Which water did you mean?</p>
            <div className="flex flex-wrap gap-2">
              {choosing.choices.map(c => (
                <button key={`${c.at}`} type="button" className={BTN}
                  onClick={() => { const { offWater } = choosing; setChoosing(null); setDraft(d => placeClick(d, c.at, offWater)) }}>
                  {c.waterway || 'Unnamed water'}
                </button>
              ))}
              <button type="button" className={buttonClass('quiet', 'sm')} onClick={() => setChoosing(null)}>Cancel</button>
            </div>
          </div>
        )}
        {coverage && (
          <div className="absolute bottom-8 left-2 right-2 sm:right-auto z-[500] sm:max-w-[20rem] rounded-control bg-bg/95 border border-border px-3 py-2 text-sm space-y-1" data-testid="coverage-legend">
            <p className="text-muted">How well we know each waterway:</p>
            {COVERAGE_LEVELS.map(l => (
              <p key={l.id}><span className="inline-block w-3 h-1 mr-2 align-middle" style={{ background: l.colour }} /><span className="text-fg">{l.label}</span> <span className="text-muted">{l.says}</span></p>
            ))}
            <p><Link className="tt-link" href="/plan/gaps">Every waterway and its gaps</Link></p>
          </div>
        )}
        <p className="hidden sm:block absolute top-2 right-2 z-[500] max-w-[16rem] rounded-control bg-bg/90 border border-border px-2 py-1 text-sm text-muted pointer-events-none">
          {manifest.version
            ? 'Rivers and canals of the UK, Ireland, the Netherlands, Belgium and France. Switch on Coverage to see how well we know each.'
            : 'River data so far: Devizes to Westminster.'}
        </p>
      </div>

      <aside className="lg:w-[30rem] lg:overflow-y-auto border-t lg:border-t-0 lg:border-l border-border px-4 py-4 space-y-6">
        {adding && <AddPortage stop={adding.stop} landings={adding.landings} signedIn={signedIn} here={lock ? addPortageHref(lock) : `/plan?${draftParams(draft)}`} onCancel={() => setAdding(null)}
          onSaved={() => { setAdding(null); refreshPortages() }} />}
        <section>
          <h1 className="text-2xl font-semibold text-fg mb-1 text-balance">{shared ? initialTitle(initial) : saved ? saved.title : 'Plan a paddle'}</h1>
          {shared ? (
            <p className="text-base text-muted">
              {shared.mine ? <>This is your plan. <a className="tt-link" href={`/plan/${shared.planId}`}>Open it to change it</a>.</>
                : <>Shared by {shared.owner}. Try your own pace and start time here, or <a className="tt-link" href={`/plan?${draftParams(draft)}`}>make your own copy</a>.</>}
            </p>
          ) : (
            <p className="text-base text-muted">
              {!draft.start ? 'Click the water to set your start.' : !draft.finish ? 'Now click the water where you finish.' : 'Click again to move the nearer end.'}
              {!draft.finish && ' Zoomed out, a click zooms in first.'}
            </p>
          )}
          {shared ? (
            <dl className="mt-4 grid grid-cols-[5rem_1fr] gap-y-1 text-base">
              <dt className={`${eyebrowClass} pt-1`}>Start</dt>
              <dd>{!draft.start ? 'not set' : current?.start ? current.start.waterway || 'unnamed water' : '—'}</dd>
              <dt className={`${eyebrowClass} pt-1`}>Finish</dt>
              <dd>{!draft.finish ? 'not set' : current?.finish ? current.finish.waterway || 'unnamed water' : '—'}</dd>
            </dl>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              {(['start', 'finish'] as const).map(end => (
                <EndSearch key={end} label={end === 'start' ? 'Start' : 'Finish'} at={draft[end]}
                  waterway={!draft[end] ? null : current ? current[end]?.waterway ?? null : null}
                  near={draft.start ?? draft.finish ?? undefined}
                  onPick={h => { setChoosing(null); setDraft(d => ({ ...d, [end]: h.at })); setFocus({ at: h.at, zoom: 15 }) }} />
              ))}
            </div>
          )}
          <PlaceSearch version={VERSION} near={draft.start ?? undefined}
            onPick={p => setFocus({ at: p.at, zoom: p.kind === 'lock' || p.kind === 'weir' ? 16 : 14 })} />
          {unfound.filter(u => !draft[u.end]).map(u => (
            <p key={u.end} className="mt-2 text-sm text-red">We couldn&apos;t find &ldquo;{u.name}&rdquo; on the water. Type the {u.end} in its box above, or click the map.</p>
          ))}
          {error && <p className="mt-2 text-sm text-red">{PLAN_ERROR_TEXT[error]}</p>}
          {routed.isError && <p className="mt-2 text-sm text-red">Couldn&apos;t work out the route. Please try again.</p>}
          {draft.finish && routed.isFetching && <p className="mt-2 text-sm text-muted">Finding the route…</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {(['one_way', 'return'] as const).map(sh => (
              <button key={sh} type="button" aria-pressed={draft.shape === sh} onClick={() => setDraft(d => ({ ...d, shape: sh }))}
                className={toggleClass(draft.shape === sh)}>
                {sh === 'one_way' ? 'One-way' : 'Return'}
              </button>
            ))}
            <button type="button" className={BTN} disabled={!!shared || !draft.start || !draft.finish}
              onClick={() => setDraft(d => ({ ...d, start: d.finish, finish: d.start }))}>Swap ends</button>
            <button type="button" className={BTN} disabled={!!shared || !draft.start}
              onClick={() => setDraft(d => ({ ...d, start: null, finish: null }))}>Clear</button>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3">
          <Field label="Start time" htmlFor="plan-start-at" help="Optional: gives a clock time at every stop." className="col-span-2">
            <input id="plan-start-at" type="datetime-local" className={INPUT} value={mounted ? localInput(draft.startAt) : ''}
              onChange={e => setDraft(d => ({ ...d, startAt: e.target.value ? new Date(e.target.value).toISOString() : undefined }))} />
          </Field>
          <Field label="Pace (km/h)" htmlFor="plan-pace">
            <input id="plan-pace" type="number" inputMode="decimal" min={1} max={30} step={0.5} className={INPUT} value={draft.paceKmh}
              onChange={e => { const v = Number(e.target.value); if (v >= 1 && v <= 30) setDraft(d => ({ ...d, paceKmh: v })) }} />
          </Field>
          <Field label="Minutes per portage" htmlFor="plan-portage">
            <input id="plan-portage" type="number" inputMode="numeric" min={0} max={120} step={1} className={INPUT} value={draft.portageMinutes}
              onChange={e => { const v = Number(e.target.value); if (v >= 0 && v <= 120) setDraft(d => ({ ...d, portageMinutes: v })) }} />
          </Field>
        </section>

        {plan && <Summary plan={plan} />}
        {plan && (
          <div className="flex flex-wrap gap-2 -mt-2">
            <Link className={BTN} href={printHref(draft, { id: saved?.id, share: shared ? (initial as Partial<SavedPlan>).shareId : undefined, show: [...shown] })}>Print route sheet</Link>
            <Link className={buttonClass('quiet', 'sm')} href={printHref(draft, { id: saved?.id, share: shared ? (initial as Partial<SavedPlan>).shareId : undefined, crew: true })}>Crew sheet</Link>
          </div>
        )}

        {plan && <Conditions plan={plan} startAt={draft.startAt} tide={tideWindow(plan, draft, TIDES, officialTides)} data={conditions.data} loading={conditions.isLoading} failed={conditions.isError} />}

        {plan && (
          <section>
            <h2 className={H2}>Stops</h2>
            <div className="flex flex-wrap gap-2 mb-3">
              {STOP_GROUPS.map(g => {
                const n = plan.stops.filter(s => groupOf(s.feature.kind) === g.id).length
                const on = shown.has(g.id)
                return (
                  <button key={g.id} type="button" aria-pressed={on} className={`${BTN} ${on ? 'text-fg' : 'text-muted!'}`}
                    style={on ? { borderColor: g.colour } : undefined}
                    onClick={() => setShown(s => { const t = new Set(s); if (on) t.delete(g.id); else t.add(g.id); return t })}>
                    {g.label} <span className="tabular">{n}</span>
                  </button>
                )
              })}
            </div>
            <StopList plan={plan} stops={visible} startAt={draft.startAt} onFocus={at => setFocus({ at, zoom: 15 })}
              stopNotes={notes.stops} onSaveNote={saveStopNote} actions={{
              signedIn, mine: new Set(mine.data?.map(c => c.id)), flagged,
              here: saved ? `/plan/${saved.id}` : `/plan?${draftParams(draft)}`,
              onAdd: startAdding,
              onFlag: id => flag.mutate({ id }),
              onDelete: id => withdraw.mutate({ id }),
            }} />
            <p className="mt-3 text-sm text-muted">
              Portage sides and landing points are missing for most locks. An unknown side is shown as unknown, never guessed.
            </p>
            {!saved && !shared && signedIn && <p className="mt-1 text-sm text-muted">Save the plan to add your own notes to it and its stops.</p>}
            <MissingSides stops={plan.stops} signedIn={signedIn} here={saved ? `/plan/${saved.id}` : `/plan?${draftParams(draft)}`} onStart={startAdding} />
          </section>
        )}

        {saved && plan && <PlanNotes text={notes.plan} saving={setNotesMut.isPending} failed={!!setNotesMut.error}
          onSave={text => setNotesMut.mutate({ id: saved.id, notes: text })} />}
        {shared && notes.plan && (
          <section>
            <h2 className={H2}>Notes</h2>
            <p className="text-base whitespace-pre-line">{notes.plan}</p>
          </section>
        )}

        {!shared && <SaveBox draft={draft} saved={saved} canSave={!!plan} onSaved={p => { if (!saved) router.push(`/plan/${p.id}`) }} />}

        <section className="text-sm text-muted space-y-2 border-t border-border pt-4">
          <p>This plan is not a navigation authority. Check stream warnings, lock notices and, below Teddington, the tide before you go.</p>
          <p>Where our data is thin, and what paddlers could add: <Link className="tt-link" href="/plan/gaps">gaps</Link>.</p>
          <details className="group">
            <summary className="cursor-pointer min-h-11 flex items-center gap-1 hover:text-fg list-none [&::-webkit-details-marker]:hidden">
              Data sources <span aria-hidden className="transition-transform group-open:rotate-90">›</span>
            </summary>
            <ul className="space-y-1 pb-2">
              {CREDITED.map(id => (
                <li key={id}><a className="tt-link" href={SOURCES[id].url} target="_blank" rel="noreferrer">{SOURCES[id].attribution}</a></li>
              ))}
            </ul>
          </details>
        </section>
      </aside>
    </main>
  )
}

const listOf = (xs: string[]) => (xs.length < 2 ? xs[0] : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)

function Summary({ plan }: { plan: ComputedPlan }) {
  return (
    <section>
      <h2 className="sr-only">Summary</h2>
      <div className="grid grid-cols-2 gap-4" data-testid="plan-summary">
        <Stat label="Distance" value={km(plan.lengthM)} />
        <Stat label="Portages" value={String(plan.portages)} />
        <Stat label="Paddling" value={fmtDuration(plan.movingS)} />
        <Stat label="With portages" value={fmtDuration(plan.totalS)} />
        {plan.finishAt && <Stat label="Finish at" value={fmtDayTime(plan.finishAt)} tone="primary" />}
      </div>
      {plan.canoeRoutes?.length ? <p className="mt-3 text-sm text-muted" data-testid="canoe-routes">On {listOf(plan.canoeRoutes)}, a marked canoe route.</p> : null}
    </section>
  )
}

// Local calendar days between two times, for the "+1" beside an arrival after midnight.
function dayOffset(from: string, to: string): number {
  const a = new Date(from), b = new Date(to)
  return Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() - new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()) / 86_400_000)
}

/** Stops where portage details can be added: locks, portages and weirs
 *  across the way (not a canal's bywash beside it, #509). */
const canAddPortage = (s: Stop) => s.portage || (s.feature.kind === 'weir' && !s.beside)

type PortageActions = {
  signedIn: boolean
  mine: Set<string>
  here: string                       // this page, for the sign-in round trip
  onAdd?: (s: Stop) => void          // unset when adding isn't possible here (a shared plan)
  onFlag: (id: string) => void
  onDelete: (id: string) => void
  flagged: Set<string>
}

function StopList({ plan, stops, startAt, onFocus, actions, stopNotes, onSaveNote }: {
  plan: ComputedPlan; stops: Stop[]; startAt?: string; onFocus: (p: LatLng) => void; actions: PortageActions
  stopNotes: Record<string, string>
  onSaveNote?: (featureId: string, text: string) => Promise<unknown>   // set when it's your saved plan
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const when = (s: Stop) => {
    if (!s.eta || !startAt) return fmtDuration(s.elapsedS)
    const d = dayOffset(startAt, s.eta)
    return `${fmtTime(s.eta)}${d > 0 ? ` +${d}` : ''}`
  }
  const turnAt = plan.turnM != null ? stops.findIndex(s => s.leg === 'back') : -1
  return (
    <ol className="border-t border-border" data-testid="stop-list">
      {stops.map((s, i) => {
        const turn = i === turnAt
        return (
          <li key={`${s.leg}-${s.feature.id}-${i}`} id={stopId(s)} data-feature-id={s.feature.id} data-kind={s.feature.kind}
            data-km={(s.chainageM / 1000).toFixed(2)} data-eta={s.eta}>
            {turn && <div className={`py-2 border-b border-border ${eyebrowClass} text-primary-text!`}>Turn at {km(plan.turnM!)}</div>}
            <button type="button" onClick={() => onFocus(s.feature.at)}
              className="w-full text-left grid grid-cols-[4.5rem_1fr] gap-3 py-2 min-h-11 border-b border-border hover:bg-surface-2">
              <span className="tabular text-sm">
                <span className="block text-fg">{km(s.chainageM)}</span>
                {s.eta ? <time className="block text-primary-text" dateTime={s.eta}>{when(s)}</time> : <span className="block text-primary-text">{when(s)}</span>}
                {isDarkStop(s) && <span className="block text-xs text-red">after dark</span>}
              </span>
              <span className="min-w-0">
                <span className="block text-base text-fg">
                  <span className="inline-block w-2 h-2 mr-2 align-middle" style={{ background: STOP_GROUPS.find(g => g.id === groupOf(s.feature.kind))!.colour }} />
                  {s.feature.name ?? KIND[s.feature.kind]}
                  {s.feature.name && s.feature.kind !== 'crew_point' && <span className="text-muted text-sm"> · {KIND[s.feature.kind]}</span>}
                </span>
                {stopLines(s).map((l, j) => <span key={j} className="block text-sm text-muted">{l}</span>)}
              </span>
            </button>
            {(stopNotes[s.feature.id] || (onSaveNote && editing === `${s.leg}-${i}`)) && (
              <div className="pl-[5.25rem] pb-2 -mt-1 border-b border-border text-sm" data-testid="stop-note">
                {editing === `${s.leg}-${i}` && onSaveNote
                  ? <NoteEditor initial={stopNotes[s.feature.id] ?? ''} label={`Your note on ${s.feature.name ?? KIND[s.feature.kind]}`}
                      onCancel={() => setEditing(null)}
                      onSave={async text => { await onSaveNote(s.feature.id, text); setEditing(null) }} />
                  : <p className="text-fg whitespace-pre-line"><span className="text-muted">{onSaveNote ? 'Your note: ' : 'Note: '}</span>{stopNotes[s.feature.id]}</p>}
              </div>
            )}
            {onSaveNote && editing !== `${s.leg}-${i}` && (
              <div className="pl-[5.25rem] -mt-1 border-b border-border">
                <button type="button" className="min-h-11 text-sm text-muted hover:text-fg" onClick={() => setEditing(`${s.leg}-${i}`)}>
                  {stopNotes[s.feature.id] ? 'Edit your note' : '+ Add a note'}
                </button>
              </div>
            )}
            {canAddPortage(s) && (
              <div className="pl-[5.25rem] pb-2 -mt-1 border-b border-border space-y-1 text-sm" data-testid="portage-block">
                {s.portages?.map(p => (
                  <div key={p.id}>
                    {portageLines(p).map((l, j) => <span key={j} className="block text-fg">{l}</span>)}
                    {p.osm
                      ? <span className="text-muted">Mapped in OpenStreetMap · ODbL</span>
                      : <span className="text-muted">Added by {p.by} · CC0 · </span>}
                    {p.osm ? null : actions.mine.has(p.id)
                      ? <button type="button" className="underline text-muted hover:text-red" onClick={() => actions.onDelete(p.id)}>delete</button>
                      : actions.signedIn && (actions.flagged.has(p.id)
                        ? <span className="text-muted">flagged, thanks</span>
                        : <button type="button" className="underline text-muted hover:text-fg" onClick={() => actions.onFlag(p.id)}>flag as wrong</button>)}
                  </div>
                ))}
                {actions.onAdd && (actions.signedIn
                  ? <button type="button" className="min-h-11 text-primary-text hover:underline" onClick={() => actions.onAdd!(s)}>{s.portages?.length ? '+ Add yours' : '+ Add portage details'}</button>
                  : <a className="text-muted underline hover:text-fg" href={`/signin?next=${encodeURIComponent(actions.here)}`}>Sign in to add portage details</a>)}
              </div>
            )}
          </li>
        )
      })}
      {stops.length === 0 && <li className="py-2 text-sm text-muted">No stops of these kinds on this stretch.</li>}
    </ol>
  )
}

/** A lock opened from a link: enough of a stop for the add-details panel. */
const stopAt = (l: LockLink): Stop => ({
  feature: { id: l.id, kind: 'lock', name: l.name, at: l.at, source: { source: 'curated', fetchedAt: '' } },
  leg: 'out', chainageM: 0, fromPrevM: 0, portage: true, portagesBefore: 0, elapsedS: 0,
})

/** The nudge: locks on this route with no landing details yet. */
function MissingSides({ stops, signedIn, here, onStart }: { stops: Stop[]; signedIn: boolean; here: string; onStart: (s: Stop) => void }) {
  const seen = new Set<string>()
  const missing = stops.filter(s => s.leg === 'out' && s.portage && !s.portages?.length && !s.feature.portage?.side && !seen.has(s.feature.id) && seen.add(s.feature.id))
  if (!missing.length) return null
  const first = missing[0]
  return (
    <div className="mt-4 rounded-control border border-border bg-surface p-3 text-sm space-y-2" data-testid="missing-sides">
      <p className="text-fg">
        {missing.length === 1 ? '1 lock' : `${missing.length} locks`} on this route {missing.length === 1 ? 'has' : 'have'} no landing details yet.
        Paddled it? Which bank you got out on helps the next paddler.
      </p>
      {signedIn
        ? <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => onStart(first)}>Start with {first.feature.name ?? KIND[first.feature.kind]}</button>
        : <a className="tt-link" href={`/signin?next=${encodeURIComponent(here)}`}>Sign in to add what you know</a>}
    </div>
  )
}

/** A small private-note editor: a stop's note, inline in the list. */
function NoteEditor({ initial, label, onSave, onCancel }: { initial: string; label: string; onSave: (text: string) => Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <div className="space-y-2 pt-1">
      <textarea className={`${INPUT} h-20`} maxLength={500} value={text} onChange={e => setText(e.target.value)} aria-label={label}
        placeholder="Crew meets here with food, refill water, phone signal is poor…" autoFocus />
      <div className="flex gap-2">
        <button type="button" className={buttonClass('primary', 'sm')} disabled={busy}
          onClick={async () => { setBusy(true); setFailed(false); try { await onSave(text) } catch { setFailed(true) } finally { setBusy(false) } }}>
          {busy ? 'Saving…' : 'Save note'}
        </button>
        <button type="button" className={buttonClass('quiet', 'sm')} onClick={onCancel}>Cancel</button>
      </div>
      {failed && <p className="text-sm text-red">Couldn&apos;t save the note. Please try again.</p>}
    </div>
  )
}

/** The plan's own notes (a saved plan, its owner). */
function PlanNotes({ text, saving, failed, onSave }: { text: string; saving: boolean; failed: boolean; onSave: (t: string) => void }) {
  const [value, setValue] = useState(text)
  return (
    <section>
      <Field label="Your notes for this plan" htmlFor="plan-notes" help="Kit, phone numbers, who drives. They're printed on the route sheet, and anyone you share the plan with sees them.">
        <textarea id="plan-notes" className={`${INPUT} h-28`} maxLength={2000} value={value} onChange={e => setValue(e.target.value)} />
      </Field>
      <button type="button" className={`${buttonClass('secondary', 'sm')} mt-2`} disabled={saving || value.trim() === text.trim()} onClick={() => onSave(value)}>
        {saving ? 'Saving…' : 'Save notes'}
      </button>
      {failed && <p className="mt-2 text-sm text-red">Couldn&apos;t save your notes. Please try again.</p>}
    </section>
  )
}

/** Adding portage details at a lock or weir: two clicks for the landings on
 *  the (satellite) map, notes, rollers, and an explicit CC0 release. */
function AddPortage({ stop, landings, signedIn, here, onCancel, onSaved }: {
  stop: Stop; landings: LatLng[]; signedIn: boolean; here: string; onCancel: () => void; onSaved: () => void
}) {
  const [notes, setNotes] = useState('')
  const [rollers, setRollers] = useState(false)
  const [cc0, setCc0] = useState(false)
  const add = trpc.portage.add.useMutation({ onSuccess: onSaved })
  const ready = landings.length === 2 && cc0
  const name = stop.feature.name ?? KIND[stop.feature.kind]
  if (!signedIn) return (
    <section className="rounded-control border border-primary p-4 space-y-2" data-testid="add-portage">
      <h2 className={H2}>Portage details: {name}</h2>
      <p className="text-sm text-muted"><a className="tt-link" href={`/signin?next=${encodeURIComponent(here)}`}>Sign in</a> to add where you get out and back in.</p>
      <button type="button" className={buttonClass('quiet', 'sm')} onClick={onCancel}>Not now</button>
    </section>
  )
  return (
    <section className="rounded-control border border-primary p-4 space-y-3" data-testid="add-portage">
      <h2 className={H2}>Portage details: {name}</h2>
      <p className="text-sm text-muted">
        {landings.length === 0 ? 'Click the map where you get out of the water.'
          : landings.length === 1 ? 'Now click where you get back in.'
          : 'Got both landings. Click again to move the second.'}
        {' '}Either order: the planner works out which is which for each direction.
      </p>
      <label className="block">
        <span className="block text-sm font-medium text-fg mb-1.5">Notes (optional)</span>
        <textarea className={`${INPUT} h-20`} maxLength={500} value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="Steps, a high landing, where the trolley path goes…" aria-label="Portage notes" />
      </label>
      <label className="flex gap-2 items-center min-h-11 text-sm">
        <input type="checkbox" checked={rollers} onChange={e => setRollers(e.target.checked)} /> There are boat rollers
      </label>
      <label className="flex gap-2 items-start text-sm text-muted">
        <input type="checkbox" className="mt-0.5" checked={cc0} onChange={e => setCc0(e.target.checked)} aria-label="Release under CC0" />
        <span>I release this under <a className="underline" href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noreferrer">CC0</a> (anyone may reuse it, including other open-data projects) and it&apos;s my own observation, not copied from a guidebook or map. It&apos;s public at once, with my display name.</span>
      </label>
      <div className="flex gap-2">
        <button type="button" className={buttonClass('primary', 'sm')} disabled={!ready || add.isPending}
          onClick={() => add.mutate({ featureId: stop.feature.id, at: stop.feature.at, landings: [landings[0], landings[1]], notes: notes || undefined, rollers: rollers || undefined, cc0: true })}>
          {add.isPending ? 'Publishing…' : 'Publish'}
        </button>
        <button type="button" className={buttonClass('quiet', 'sm')} onClick={onCancel}>Cancel</button>
      </div>
      {add.error && <p className="text-sm text-red">{
        add.error.message === 'landings_apart' ? 'Those two landings are too far apart (or the same spot). Click again.'
          : add.error.message === 'landings_far' ? `Both landings must be near ${name}.`
          : 'Couldn’t save. Please try again.'}</p>}
    </section>
  )
}

/** Type a town, village, lock or weir; pick one to move the map there. The
 *  index loads the first time the box gets focus. */
function PlaceSearch({ version, near, onPick }: { version: string; near?: LatLng; onPick: (p: Place) => void }) {
  const [places, setPlaces] = useState<Place[] | null>(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const asked = useRef(false)
  const load = () => {
    if (asked.current) return
    asked.current = true
    fetch(`/plan/data/${version}/places`).then(r => (r.ok ? r.json() : Promise.reject())).then(setPlaces, () => { asked.current = false })
  }
  const hits = places ? searchPlaces(places, q, near) : []
  const pick = (p: Place) => { onPick(p); setQ(p.name); setOpen(false) }
  return (
    <div className="mt-3 relative">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-fg">Go to</span>
        <input className={INPUT} value={q} placeholder="Town, village or lock" aria-label="Go to a place"
          role="combobox" aria-expanded={open && hits.length > 0} aria-controls="place-results" autoComplete="off"
          onFocus={() => { load(); setOpen(true) }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={e => { setQ(e.target.value); setOpen(true) }}
          onKeyDown={e => { if (e.key === 'Enter' && hits[0]) { e.preventDefault(); pick(hits[0]) } if (e.key === 'Escape') setOpen(false) }} />
      </label>
      {open && hits.length > 0 && (
        <ul id="place-results" role="listbox" className="absolute z-[600] left-0 right-0 mt-1 rounded-control bg-surface border border-border-strong shadow-lg max-h-72 overflow-y-auto">
          {hits.map(p => (
            <li key={`${p.name}@${p.at}`} role="option" aria-selected={false}>
              <button type="button" className="w-full text-left px-3 py-2 min-h-11 text-base hover:bg-surface-2" onMouseDown={e => e.preventDefault()} onClick={() => pick(p)}>
                {p.name} <span className="text-muted text-sm">· {p.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const initialTitle = (p: PlanDraft) => ('title' in p && typeof p.title === 'string' ? p.title : 'Shared plan')

function ShareBox({ plan }: { plan: SavedPlan }) {
  const utils = trpc.useUtils()
  const [copied, setCopied] = useState(false)
  const done = (p: SavedPlan) => utils.plan.get.setData({ id: p.id }, p)
  const share = trpc.plan.share.useMutation({ onSuccess: done })
  const unshare = trpc.plan.unshare.useMutation({ onSuccess: done })
  // The server doesn't know which host the page is on; the browser fills it in after hydrating.
  const origin = useSyncExternalStore(() => () => {}, () => window.location.origin, () => 'https://paddlesnitch.com')
  const url = plan.shareId ? `${origin}/plan/shared/${plan.shareId}` : null
  const copy = async () => {
    if (!url) return
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) }
    catch { /* clipboard blocked: the link is shown to copy by hand */ }
  }
  return (
    <div className="mt-4">
      <h2 className={H2}>Share</h2>
      {!url ? (
        <>
          <button type="button" className={BTN} disabled={share.isPending} onClick={() => share.mutate({ id: plan.id })}>{share.isPending ? 'Sharing…' : 'Share'}</button>
          <p className="mt-1 text-sm text-muted">Anyone with the link can see this plan. Your buddies see it in their list.</p>
        </>
      ) : (
        <>
          <p className="text-sm text-fg break-all tabular" data-testid="share-link">{url}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className={BTN} onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
            <button type="button" className={BTN} disabled={unshare.isPending} onClick={() => unshare.mutate({ id: plan.id })}>{unshare.isPending ? 'Stopping…' : 'Stop sharing'}</button>
          </div>
          <p className="mt-1 text-sm text-muted">Stopping sharing breaks the link and takes it off your buddies&apos; lists.</p>
        </>
      )}
      {(share.error || unshare.error) && <p className="mt-2 text-sm text-red">Couldn&apos;t change sharing. Please try again.</p>}
    </div>
  )
}

function SaveBox({ draft, saved, canSave, onSaved }: {
  draft: PlanDraft; saved?: SavedPlan; canSave: boolean; onSaved: (p: SavedPlan) => void
}) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const me = trpc.me.useQuery(undefined, { retry: false })
  const plans = trpc.plan.list.useQuery(undefined, { enabled: !!me.data?.user && !saved, retry: false })
  const buddyPlans = trpc.plan.buddies.useQuery(undefined, { enabled: !!me.data?.user && !saved, retry: false })
  const [title, setTitle] = useState(saved?.title ?? '')
  const [confirming, setConfirming] = useState(false)
  const q = draftParams(draft)
  const here = saved ? `/plan/${saved.id}` : `/plan${q ? `?${q}` : ''}`
  const save = trpc.plan.save.useMutation({
    onSuccess: p => { utils.plan.list.invalidate(); utils.plan.get.setData({ id: p.id }, p); onSaved(p) },
  })
  const del = trpc.plan.delete.useMutation({ onSuccess: () => { utils.plan.list.invalidate(); router.push('/plan') } })

  if (!me.data) return null
  if (!me.data.user) {
    return (
      <section>
        <h2 className={H2}>Save</h2>
        <p className="text-base text-muted"><a className="tt-link" href={`/signin?next=${encodeURIComponent(here)}`}>Sign in</a> to save this plan.</p>
      </section>
    )
  }

  const input = asInput(draft)
  const changed = !saved || title.trim() !== saved.title || !input || JSON.stringify([input.start, input.finish, input.shape, input.startAt, input.paceKmh, input.portageMinutes])
    !== JSON.stringify([saved.start, saved.finish, saved.shape, saved.startAt, saved.paceKmh, saved.portageMinutes])
  return (
    <section>
      <h2 className={H2}>Save</h2>
      <div className="flex gap-2">
        <input className={INPUT} placeholder="Name this plan" maxLength={80} value={title} onChange={e => setTitle(e.target.value)} aria-label="Plan name" />
        <button type="button" className={buttonClass('primary')} disabled={!canSave || !input || !changed || save.isPending}
          onClick={() => input && save.mutate({ ...input, title, region: NATIONAL, id: saved?.id })}>
          {save.isPending ? 'Saving…' : saved ? 'Save changes' : 'Save'}
        </button>
      </div>
      {save.error && <p className="mt-2 text-sm text-red">Couldn&apos;t save this plan. Please try again.</p>}
      {saved && <ShareBox plan={saved} />}
      {saved && (
        <div className="mt-6 flex flex-wrap gap-2 items-center text-sm">
          {!confirming
            ? <button type="button" className={buttonClass('danger', 'sm')} onClick={() => setConfirming(true)}>Delete plan</button>
            : <>
                <span className="text-muted">Delete this plan?</span>
                <button type="button" className={buttonClass('danger', 'sm')} disabled={del.isPending} onClick={() => del.mutate({ id: saved.id })}>{del.isPending ? 'Deleting…' : 'Delete'}</button>
                <button type="button" className={BTN} onClick={() => setConfirming(false)}>Keep</button>
              </>}
        </div>
      )}
      {!saved && !!plans.data?.length && (
        <div className="mt-4">
          <h2 className={H2}>Your plans</h2>
          <ul className="space-y-1">
            {plans.data.map(p => (
              <li key={p.id} className="text-sm">
                <a href={`/plan/${p.id}`} className="tt-link">{p.title}</a>
                <span className="text-muted text-sm"> · {p.shape === 'return' ? 'return' : 'one-way'}{p.shareId ? ' · shared' : ''} · {fmtDay(p.updatedAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!saved && !!buddyPlans.data?.length && (
        <div className="mt-4">
          <h2 className={H2}>Buddies&apos; plans</h2>
          <ul className="space-y-1">
            {buddyPlans.data.map(p => (
              <li key={p.shareId} className="text-sm">
                <a href={`/plan/shared/${p.shareId}`} className="tt-link">{p.title}</a>
                <span className="text-muted text-sm"> · {p.owner} · {p.shape === 'return' ? 'return' : 'one-way'} · {fmtDay(p.updatedAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
