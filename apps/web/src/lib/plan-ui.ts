// The planner page's wording and URL: what each stop says, which stops show by
// default, and how an unsaved plan lives in the address bar (so a reload, a
// sign-in round trip or a pasted link keeps it). Pure; tested in plan-ui.test.ts.
import type { PlanError, PlanInput, PlanShape, Stop } from '@paddlesnitch/waterways/plan'
import { DEFAULT_PACE_KMH, DEFAULT_PORTAGE_MINUTES } from '@paddlesnitch/waterways/plan'
import type { Facility, FeatureKind, LatLng } from '@paddlesnitch/waterways/types'

export type StopGroup = 'portage' | 'weir' | 'access' | 'facility' | 'crew'

export const STOP_GROUPS: { id: StopGroup; label: string; on: boolean; colour: string }[] = [
  { id: 'portage', label: 'PORTAGES', on: true, colour: '#f59e0b' },
  { id: 'weir', label: 'WEIRS', on: true, colour: '#f87171' },
  { id: 'access', label: 'GET IN / OUT', on: true, colour: '#22c55e' },
  { id: 'facility', label: 'WATER AND TOILETS', on: true, colour: '#38bdf8' },
  { id: 'crew', label: 'TOWPATH ACCESS', on: false, colour: '#94a3b8' },
]

export function groupOf(kind: FeatureKind): StopGroup {
  switch (kind) {
    case 'lock': case 'portage': return 'portage'
    case 'weir': case 'hazard': return 'weir'
    case 'access': case 'slipway': return 'access'
    case 'facility': return 'facility'
    case 'crew_point': return 'crew'
  }
}

const FACILITY: Record<Facility, string> = {
  toilet: 'toilet', shower: 'shower', drinking_water: 'drinking water', elsan: 'Elsan',
  refuse: 'rubbish', card_payment: 'card payment', electric_charging: 'electric charging', pump_out: 'pump-out',
}

/** The lines shown under a stop's name. Unknowns are said, never guessed. */
export function stopLines(stop: Stop): string[] {
  const f = stop.feature
  const out: string[] = []
  if (stop.portage) {
    out.push(f.portage?.side ? `Portage on the ${f.portage.side} bank.` : 'Portage side not known yet.')
    if (f.portage?.carryM) out.push(`Carry about ${Math.round(f.portage.carryM)} m.`)
  }
  if (f.lock?.notice) out.push(`Notice: ${f.lock.notice}`)
  if (f.kind === 'crew_point' && stop.bank) out.push(`On the ${stop.bank} bank.`)
  const crew = f.crew
  if (crew?.directions) out.push(crew.directions)
  if (crew?.parking) out.push(`Parking: ${crew.parking}`)
  const postcode = crew?.postcode ?? f.lock?.postcode
  if (postcode) out.push(`Postcode ${postcode}.`)
  const fac = f.facilities ?? f.lock?.facilities
  if (fac?.length) out.push(`Facilities: ${fac.map(x => FACILITY[x]).join(', ')}.`)
  return out
}

export const PLAN_ERROR_TEXT: Record<PlanError, string> = {
  start_off_water: "The start isn't on a river or canal we cover. Click on the water.",
  finish_off_water: "The finish isn't on a river or canal we cover. Click on the water.",
  too_short: 'Start and finish are in the same place. Click further along the water.',
  not_connected: "We can't find a way along the water between those two points.",
}

export const km = (m: number) => `${(m / 1000).toFixed(1)} km`

// --- The address bar ----------------------------------------------------------

export type PlanDraft = {
  start: LatLng | null
  finish: LatLng | null
  shape: PlanShape
  startAt?: string
  paceKmh: number
  portageMinutes: number
}

export type View = { at: LatLng; zoom: number }

const num = (s: string | undefined) => (s != null && s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : undefined)
function latLng(s: string | undefined): LatLng | null {
  const [a, b] = (s ?? '').split(',').map(num)
  return a != null && b != null && Math.abs(a) <= 90 && Math.abs(b) <= 180 ? [a, b] : null
}
const clamp = (v: number | undefined, lo: number, hi: number, d: number) => (v == null ? d : Math.min(hi, Math.max(lo, v)))

/** ?from=lat,lng&to=lat,lng&shape=return&at=ISO&pace=8&portage=3&view=lat,lng,zoom */
export function draftFromParams(p: Record<string, string | string[] | undefined>): { draft: PlanDraft; view?: View } {
  const one = (k: string) => { const v = p[k]; return Array.isArray(v) ? v[0] : v }
  const at = one('at')
  const view = (one('view') ?? '').split(',').map(num)
  return {
    draft: {
      start: latLng(one('from')),
      finish: latLng(one('to')),
      shape: one('shape') === 'return' ? 'return' : 'one_way',
      startAt: at && Number.isFinite(Date.parse(at)) ? new Date(at).toISOString() : undefined,
      paceKmh: clamp(num(one('pace')), 1, 30, DEFAULT_PACE_KMH),
      portageMinutes: clamp(num(one('portage')), 0, 120, DEFAULT_PORTAGE_MINUTES),
    },
    view: view.length === 3 && view.every(v => v != null) ? { at: [view[0]!, view[1]!], zoom: view[2]! } : undefined,
  }
}

const ll = (p: LatLng) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`

export function draftParams(d: PlanDraft): string {
  const q = new URLSearchParams()
  if (d.start) q.set('from', ll(d.start))
  if (d.finish) q.set('to', ll(d.finish))
  if (d.shape === 'return') q.set('shape', 'return')
  if (d.startAt) q.set('at', d.startAt)
  if (d.paceKmh !== DEFAULT_PACE_KMH) q.set('pace', String(d.paceKmh))
  if (d.portageMinutes !== DEFAULT_PORTAGE_MINUTES) q.set('portage', String(d.portageMinutes))
  return q.toString().replace(/%2C/g, ',').replace(/%3A/g, ':')
}

/** A complete draft as the plan to compute. */
export function asInput(d: PlanDraft): PlanInput | null {
  return d.start && d.finish ? { ...d, start: d.start, finish: d.finish } : null
}

/** Where a new click goes: start first, then finish, then whichever is nearer. */
export function placeClick(d: PlanDraft, p: LatLng): PlanDraft {
  if (!d.start) return { ...d, start: p }
  if (!d.finish) return { ...d, finish: p }
  const dist = (a: LatLng) => (a[0] - p[0]) ** 2 + ((a[1] - p[1]) * Math.cos((p[0] * Math.PI) / 180)) ** 2
  return dist(d.start) < dist(d.finish) ? { ...d, start: p } : { ...d, finish: p }
}

/** An ISO time as a <input type="datetime-local"> value, in the browser's zone. */
export function localInput(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
