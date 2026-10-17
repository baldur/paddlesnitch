'use client'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { keepPreviousData } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { fmtDay, fmtDayTime, fmtTime } from '@paddlesnitch/core/format'
import manifest from '@paddlesnitch/waterways/data/manifest.json'
import { searchPlaces, type Place } from '@paddlesnitch/waterways/places'
import { fmtDuration, timePlan, type ComputedPlan, type Stop } from '@paddlesnitch/waterways/plan'
import type { SavedPlan } from '@paddlesnitch/waterways/plan-store'
import { NATIONAL } from '@paddlesnitch/waterways/regions'
import { SOURCES } from '@paddlesnitch/waterways/sources'
import type { LatLng } from '@paddlesnitch/waterways/types'
import PlanMapClient from '@/components/map/PlanMapClient'
import type { MapFocus } from '@/components/map/PlanMap'
import { trpc } from '@/lib/trpc'
import {
  asInput, COVERAGE_LEVELS, draftParams, groupOf, km, localInput, PICK_MIN_ZOOM, placeClick, PLAN_ERROR_TEXT, STOP_GROUPS, stopLines,
  type PlanDraft, type StopGroup, type View,
} from '@/lib/plan-ui'

// PLAN (docs/features/river-planner.md): click the water for a start and a
// finish, choose one-way or return, and get every stop between with arrival
// times. The server routes on the national network (plan.route); the browser
// works out the times, so pace and start time change instantly. Saving needs
// an account; an unsaved plan lives in the address bar.

const H2 = 'text-xs text-muted tracking-[0.2em] uppercase mb-2'
const BTN = 'text-xs tracking-widest px-3 py-1.5 border border-border hover:border-primary disabled:opacity-40'
const INPUT = 'bg-surface border border-border px-2 py-1 text-sm text-fg w-full'
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

export default function Planner({ initial, view, saved, shared }: { initial: PlanDraft; view?: View; saved?: SavedPlan; shared?: SharedView }) {
  const router = useRouter()
  const [draft, setDraft] = useState<PlanDraft>(initial)
  const [shown, setShown] = useState<Set<StopGroup>>(() => new Set(STOP_GROUPS.filter(g => g.on).map(g => g.id)))
  const [focus, setFocus] = useState<MapFocus | null>(null)
  const [satellite, setSatellite] = useState(false)
  const [coverage, setCoverage] = useState(false)
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
  const visible = plan?.stops.filter(s => shown.has(groupOf(s.feature.kind))) ?? []

  return (
    <div className="flex flex-col lg:flex-row lg:h-[calc(100vh-49px)]">
      <div className="h-[50vh] lg:h-auto lg:flex-1 relative">
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
            view={view}
            satellite={satellite}
            coverage={coverage}
            onPick={(p, zoom) => {
              if (zoom < PICK_MIN_ZOOM) { setFocus({ at: p, zoom: Math.min(zoom + 4, 14) }); return }
              if (!shared) setDraft(d => placeClick(d, p, error === 'start_off_water' ? 'start' : error === 'finish_off_water' ? 'finish' : null))
            }}
          />
        {/* Aerial imagery, to see which bank you can land on. */}
        <button type="button" aria-pressed={satellite} onClick={() => setSatellite(v => !v)}
          className={`absolute top-[5.5rem] left-[10px] z-[500] bg-bg/85 ${BTN} ${satellite ? 'border-primary text-fg' : 'text-muted'}`}>
          SATELLITE
        </button>
        <button type="button" aria-pressed={coverage} onClick={() => setCoverage(v => !v)}
          className={`absolute top-[8.25rem] left-[10px] z-[500] bg-bg/85 ${BTN} ${coverage ? 'border-primary text-fg' : 'text-muted'}`}>
          COVERAGE
        </button>
        {coverage && (
          <div className="absolute bottom-8 left-2 z-[500] max-w-[18rem] bg-bg/90 border border-border px-3 py-2 text-xs space-y-1" data-testid="coverage-legend">
            <p className="text-muted">How well we know each waterway:</p>
            {COVERAGE_LEVELS.map(l => (
              <p key={l.id}><span className="inline-block w-3 h-1 mr-2 align-middle" style={{ background: l.colour }} /><span className="text-fg">{l.label}</span> <span className="text-muted">{l.says}</span></p>
            ))}
            <p><Link className="underline hover:text-fg" href="/plan/gaps">Every waterway and its gaps →</Link></p>
          </div>
        )}
        <p className="absolute top-2 right-2 z-[500] max-w-[16rem] bg-bg/85 border border-border px-2 py-1 text-xs text-muted pointer-events-none">
          {manifest.version
            ? 'Rivers and canals of the UK and Ireland. Switch on COVERAGE to see how well we know each.'
            : 'River data so far: Devizes to Westminster.'}
        </p>
      </div>

      <aside className="lg:w-[30rem] lg:overflow-y-auto border-t lg:border-t-0 lg:border-l border-border px-4 py-4 space-y-6">
        <section>
          <h1 className="text-sm tracking-[0.2em] uppercase text-fg mb-1">{shared ? initialTitle(initial) : saved ? saved.title : 'Plan a paddle'}</h1>
          {shared ? (
            <p className="text-xs text-muted">
              {shared.mine ? <>This is your plan. <a className="underline hover:text-fg" href={`/plan/${shared.planId}`}>Open it to change it</a>.</>
                : <>Shared by {shared.owner}. Try your own pace and start time here, or <a className="underline hover:text-fg" href={`/plan?${draftParams(draft)}`}>make your own copy</a>.</>}
            </p>
          ) : (
            <p className="text-xs text-muted">
              {!draft.start ? 'Click the water to set your start.' : !draft.finish ? 'Now click the water where you finish.' : 'Click again to move the nearer end.'}
              {!draft.finish && ' Zoomed out, a click zooms in first.'}
            </p>
          )}
          <PlaceSearch version={VERSION} near={draft.start ?? undefined}
            onPick={p => setFocus({ at: p.at, zoom: p.kind === 'lock' || p.kind === 'weir' ? 16 : 14 })} />
          <dl className="mt-3 grid grid-cols-[5rem_1fr] gap-y-1 text-sm">
            <dt className="text-muted text-xs tracking-widest pt-0.5">START</dt>
            <dd>{!draft.start ? 'not set' : current?.start ? current.start.waterway || 'unnamed water' : '—'}</dd>
            <dt className="text-muted text-xs tracking-widest pt-0.5">FINISH</dt>
            <dd>{!draft.finish ? 'not set' : plan ? plan.finish.waterway || 'unnamed water' : '—'}</dd>
          </dl>
          {error && <p className="mt-2 text-sm text-red">{PLAN_ERROR_TEXT[error]}</p>}
          {routed.isError && <p className="mt-2 text-sm text-red">Couldn&apos;t work out the route. Please try again.</p>}
          {draft.finish && routed.isFetching && <p className="mt-2 text-xs text-muted">Finding the route…</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {(['one_way', 'return'] as const).map(sh => (
              <button key={sh} type="button" aria-pressed={draft.shape === sh} onClick={() => setDraft(d => ({ ...d, shape: sh }))}
                className={`${BTN} ${draft.shape === sh ? 'border-primary text-fg' : 'text-muted'}`}>
                {sh === 'one_way' ? 'ONE-WAY' : 'RETURN'}
              </button>
            ))}
            <button type="button" className={BTN} disabled={!!shared || !draft.start || !draft.finish}
              onClick={() => setDraft(d => ({ ...d, start: d.finish, finish: d.start }))}>SWAP</button>
            <button type="button" className={BTN} disabled={!!shared || !draft.start}
              onClick={() => setDraft(d => ({ ...d, start: null, finish: null }))}>CLEAR</button>
          </div>
        </section>

        <section className="grid grid-cols-3 gap-3">
          <label className="col-span-3 sm:col-span-1 block">
            <span className="block text-xs text-muted tracking-widest mb-1">START TIME</span>
            <input type="datetime-local" className={INPUT} value={mounted ? localInput(draft.startAt) : ''}
              onChange={e => setDraft(d => ({ ...d, startAt: e.target.value ? new Date(e.target.value).toISOString() : undefined }))} />
          </label>
          <label className="block">
            <span className="block text-xs text-muted tracking-widest mb-1">PACE KM/H</span>
            <input type="number" min={1} max={30} step={0.5} className={INPUT} value={draft.paceKmh}
              onChange={e => { const v = Number(e.target.value); if (v >= 1 && v <= 30) setDraft(d => ({ ...d, paceKmh: v })) }} />
          </label>
          <label className="block">
            <span className="block text-xs text-muted tracking-widest mb-1">MIN / PORTAGE</span>
            <input type="number" min={0} max={120} step={1} className={INPUT} value={draft.portageMinutes}
              onChange={e => { const v = Number(e.target.value); if (v >= 0 && v <= 120) setDraft(d => ({ ...d, portageMinutes: v })) }} />
          </label>
        </section>

        {plan && <Summary plan={plan} />}

        {plan && (
          <section>
            <h2 className={H2}>Stops</h2>
            <div className="flex flex-wrap gap-2 mb-3">
              {STOP_GROUPS.map(g => {
                const n = plan.stops.filter(s => groupOf(s.feature.kind) === g.id).length
                const on = shown.has(g.id)
                return (
                  <button key={g.id} type="button" aria-pressed={on} className={`${BTN} ${on ? 'text-fg' : 'text-muted'}`}
                    style={on ? { borderColor: g.colour } : undefined}
                    onClick={() => setShown(s => { const t = new Set(s); if (on) t.delete(g.id); else t.add(g.id); return t })}>
                    {g.label} {n}
                  </button>
                )
              })}
            </div>
            <StopList plan={plan} stops={visible} startAt={draft.startAt} onFocus={at => setFocus({ at, zoom: 15 })} />
            <p className="mt-3 text-xs text-muted">
              Portage sides and landing points are missing for most locks. An unknown side is shown as unknown, never guessed.
            </p>
          </section>
        )}

        {!shared && <SaveBox draft={draft} saved={saved} canSave={!!plan} onSaved={p => { if (!saved) router.push(`/plan/${p.id}`) }} />}

        <section className="text-xs text-muted space-y-2">
          <p>Where our data is thin, and what paddlers could add: <Link className="underline hover:text-fg" href="/plan/gaps">gaps</Link>.</p>
          <p>This plan is not a navigation authority. Check stream warnings, lock notices and, below Teddington, the tide before you go.</p>
          <p>
            Data:{' '}
            {CREDITED.map((id, i) => (
              <span key={id}>{i > 0 && ' · '}<a className="underline hover:text-fg" href={SOURCES[id].url} target="_blank" rel="noreferrer">{SOURCES[id].attribution}</a></span>
            ))}
          </p>
        </section>
      </aside>
    </div>
  )
}

function Summary({ plan }: { plan: ComputedPlan }) {
  const row = (label: string, value: string) => (
    <div><dt className="text-xs text-muted tracking-widest">{label}</dt><dd className="text-lg tabular text-fg">{value}</dd></div>
  )
  return (
    <section>
      <h2 className="sr-only">Summary</h2>
      <dl className="grid grid-cols-2 gap-3" data-testid="plan-summary">
        {row('DISTANCE', km(plan.lengthM))}
        {row('PORTAGES', String(plan.portages))}
        {row('PADDLING', fmtDuration(plan.movingS))}
        {row('WITH PORTAGES', fmtDuration(plan.totalS))}
        {plan.finishAt && row('FINISH AT', fmtDayTime(plan.finishAt))}
      </dl>
    </section>
  )
}

// Local calendar days between two times, for the "+1" beside an arrival after midnight.
function dayOffset(from: string, to: string): number {
  const a = new Date(from), b = new Date(to)
  return Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() - new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()) / 86_400_000)
}

function StopList({ plan, stops, startAt, onFocus }: { plan: ComputedPlan; stops: Stop[]; startAt?: string; onFocus: (p: LatLng) => void }) {
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
          <li key={`${s.leg}-${s.feature.id}-${i}`}>
            {turn && <div className="py-1.5 text-xs tracking-widest text-primary border-b border-border">TURN AT {km(plan.turnM!)}</div>}
            <button type="button" onClick={() => onFocus(s.feature.at)}
              className="w-full text-left grid grid-cols-[4.5rem_1fr] gap-3 py-2 border-b border-border hover:bg-surface-2">
              <span className="tabular text-xs">
                <span className="block text-fg">{km(s.chainageM)}</span>
                <span className="block text-primary">{when(s)}</span>
              </span>
              <span className="min-w-0">
                <span className="block text-sm text-fg">
                  <span className="inline-block w-2 h-2 mr-2 align-middle" style={{ background: STOP_GROUPS.find(g => g.id === groupOf(s.feature.kind))!.colour }} />
                  {s.feature.name ?? KIND[s.feature.kind]}
                  {s.feature.name && s.feature.kind !== 'crew_point' && <span className="text-muted text-xs"> · {KIND[s.feature.kind]}</span>}
                </span>
                {stopLines(s).map((l, j) => <span key={j} className="block text-xs text-muted">{l}</span>)}
              </span>
            </button>
          </li>
        )
      })}
      {stops.length === 0 && <li className="py-2 text-sm text-muted">No stops of these kinds on this stretch.</li>}
    </ol>
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
      <label className="flex items-center gap-2">
        <span className="text-xs text-muted tracking-widest shrink-0">GO TO</span>
        <input className={INPUT} value={q} placeholder="Town, village or lock" aria-label="Go to a place"
          role="combobox" aria-expanded={open && hits.length > 0} aria-controls="place-results" autoComplete="off"
          onFocus={() => { load(); setOpen(true) }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={e => { setQ(e.target.value); setOpen(true) }}
          onKeyDown={e => { if (e.key === 'Enter' && hits[0]) { e.preventDefault(); pick(hits[0]) } if (e.key === 'Escape') setOpen(false) }} />
      </label>
      {open && hits.length > 0 && (
        <ul id="place-results" role="listbox" className="absolute z-[600] left-14 right-0 mt-1 bg-surface border border-border max-h-72 overflow-y-auto">
          {hits.map(p => (
            <li key={`${p.name}@${p.at}`} role="option" aria-selected={false}>
              <button type="button" className="w-full text-left px-2 py-1.5 text-sm hover:bg-surface-2" onMouseDown={e => e.preventDefault()} onClick={() => pick(p)}>
                {p.name} <span className="text-muted text-xs">· {p.kind}</span>
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
          <button type="button" className={BTN} disabled={share.isPending} onClick={() => share.mutate({ id: plan.id })}>{share.isPending ? 'SHARING…' : 'SHARE'}</button>
          <p className="mt-1 text-xs text-muted">Anyone with the link can see this plan. Your buddies see it in their list.</p>
        </>
      ) : (
        <>
          <p className="text-xs text-muted break-all" data-testid="share-link">{url}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className={BTN} onClick={copy}>{copied ? 'COPIED' : 'COPY LINK'}</button>
            <button type="button" className={BTN} disabled={unshare.isPending} onClick={() => unshare.mutate({ id: plan.id })}>{unshare.isPending ? 'STOPPING…' : 'STOP SHARING'}</button>
          </div>
          <p className="mt-1 text-xs text-muted">Stopping sharing breaks the link and takes it off your buddies&apos; lists.</p>
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
        <p className="text-sm text-muted"><a className="underline hover:text-fg" href={`/signin?next=${encodeURIComponent(here)}`}>Sign in</a> to save this plan.</p>
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
        <button type="button" className={BTN} disabled={!canSave || !input || !changed || save.isPending}
          onClick={() => input && save.mutate({ ...input, title, region: NATIONAL, id: saved?.id })}>
          {save.isPending ? 'SAVING…' : saved ? 'SAVE CHANGES' : 'SAVE'}
        </button>
      </div>
      {save.error && <p className="mt-2 text-sm text-red">Couldn&apos;t save this plan. Please try again.</p>}
      {saved && <ShareBox plan={saved} />}
      {saved && (
        <div className="mt-4 flex gap-2 items-center text-xs">
          {!confirming
            ? <button type="button" className={`${BTN} text-red`} onClick={() => setConfirming(true)}>DELETE PLAN</button>
            : <>
                <span className="text-muted">Delete this plan?</span>
                <button type="button" className={`${BTN} text-red`} disabled={del.isPending} onClick={() => del.mutate({ id: saved.id })}>{del.isPending ? 'DELETING…' : 'DELETE'}</button>
                <button type="button" className={BTN} onClick={() => setConfirming(false)}>KEEP</button>
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
                <span className="text-muted text-xs"> · {p.shape === 'return' ? 'return' : 'one-way'}{p.shareId ? ' · shared' : ''} · {fmtDay(p.updatedAt)}</span>
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
                <span className="text-muted text-xs"> · {p.owner} · {p.shape === 'return' ? 'return' : 'one-way'} · {fmtDay(p.updatedAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
