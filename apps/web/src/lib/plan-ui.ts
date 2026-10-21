// The planner page's wording and URL: what each stop says, which stops show by
// default, and how an unsaved plan lives in the address bar (so a reload, a
// sign-in round trip or a pasted link keeps it). Pure; tested in plan-ui.test.ts.
import type { ComputedPlan, PlanError, PlanInput, PlanShape, Stop } from '@paddlesnitch/waterways/plan'
import { inDark, sunTimes } from '@paddlesnitch/waterways/sun'
import { showable, tideExtremes, type TideExtreme, type TidesFile } from '@paddlesnitch/waterways/tide'
import type { PortageOnRoute } from '@paddlesnitch/waterways/portage'
import { cumulative, slice } from '@paddlesnitch/waterways/line'
import { haversine } from '@paddlesnitch/timing/geo'
import { DEFAULT_PACE_KMH, DEFAULT_PORTAGE_MINUTES } from '@paddlesnitch/waterways/plan'
import type { Facility, FeatureKind, LatLng } from '@paddlesnitch/waterways/types'

export type StopGroup = 'portage' | 'weir' | 'access' | 'facility' | 'crew'

export const STOP_GROUPS: { id: StopGroup; label: string; on: boolean; colour: string }[] = [
  { id: 'portage', label: 'Portages', on: true, colour: '#f59e0b' },
  { id: 'weir', label: 'Weirs', on: true, colour: '#f87171' },
  { id: 'access', label: 'Get in / out', on: true, colour: '#22c55e' },
  { id: 'facility', label: 'Water and toilets', on: true, colour: '#38bdf8' },
  { id: 'crew', label: 'Towpath access', on: false, colour: '#94a3b8' },
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

/** A stop's id in the page, stable across loads: its leg and feature id
 *  (e.g. stop-out-crt-locks-OX-076-001), for links and tools (#510). */
export const stopId = (s: Pick<Stop, 'leg' | 'feature'>) => `stop-${s.leg}-${s.feature.id.replace(/[^A-Za-z0-9_-]+/g, '-')}`

/** The lines shown under a stop's name. Unknowns are said, never guessed. */
export function stopLines(stop: Stop): string[] {
  const f = stop.feature
  const out: string[] = []
  if (stop.portage && !stop.portages?.length) {
    out.push(f.portage?.side ? `Portage on the ${f.portage.side} bank.` : 'Portage side not known yet.')
    if (f.portage?.carryM) out.push(`Carry about ${Math.round(f.portage.carryM)} m.`)
  }
  if (f.lock?.notice) out.push(`Notice: ${f.lock.notice}`)
  if (f.weir?.heightM) out.push(`About ${f.weir.heightM} m high.`)
  if (stop.beside) out.push('Beside the canal, not across it: nothing to portage.')
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

/** A paddler's portage details as met on this route (OpenPortage). */
export function portageLines(p: PortageOnRoute): string[] {
  const out = [p.takeOut.bank === p.putIn.bank
    ? `Get out on the ${p.takeOut.bank} bank; back in about ${p.carryM} m on.`
    : `Get out on the ${p.takeOut.bank} bank; back in on the ${p.putIn.bank} bank, about ${p.carryM} m on.`]
  if (p.rollers) out.push('Rollers.')
  if (p.notes) out.push(`“${p.notes}”`)
  return out
}

// --- Adding portage details from a link (the gaps page) ------------------------------

export type LockLink = { id: string; name?: string; at: LatLng }

/** /plan opened straight into adding portage details at one lock. */
export function addPortageHref(l: LockLink): string {
  const q = new URLSearchParams({ lock: l.id, lockAt: `${l.at[0].toFixed(6)},${l.at[1].toFixed(6)}` })
  if (l.name) q.set('lockName', l.name)
  return `/plan?${q.toString().replace(/%2C/g, ',').replace(/%3A/g, ':')}&view=${l.at[0].toFixed(6)},${l.at[1].toFixed(6)},18`
}

export function lockFromParams(p: Record<string, string | string[] | undefined>): LockLink | undefined {
  const one = (k: string) => { const v = p[k]; return Array.isArray(v) ? v[0] : v }
  const id = one('lock'), at = latLng(one('lockAt'))
  if (!id || !at || id.length > 200) return undefined
  return { id, name: one('lockName')?.slice(0, 120), at }
}

// --- Daylight and conditions ---------------------------------------------------------

/** Reached in the dark: needs a start time to know. */
export const isDarkStop = (s: Stop): boolean => !!s.eta && inDark(s.eta, s.feature.at)

/** Sunrise and sunset on the day you start, where you start, and how many
 *  stops (each at its own place and time) fall in the dark. */
export function daylightSummary(plan: ComputedPlan, startAt?: string): { sunrise?: string; sunset?: string; darkStops: number } | null {
  if (!startAt) return null
  const s = sunTimes(startAt, plan.start.at)
  return { sunrise: s?.sunrise, sunset: s?.sunset, darkStops: plan.stops.filter(isDarkStop).length }
}

export const GAUGE_STATE_TEXT = { high: 'above its usual range', normal: 'in its usual range', low: 'below its usual range' } as const

/** A Thames reach's board in a few words, and how loudly to show it. */
export const BOARD_TEXT = { none: 'No stream warnings', caution: 'Caution (yellow boards)', strong: 'Strong stream (red boards)', other: '' } as const

// --- Tides -------------------------------------------------------------------------

export type TideWindow = {
  reachAt: string                // when you reach tidal water (Teddington on the Thames)
  gauges: { id: string; label: string; datum?: 'NAP'; extremes: TideExtreme[]; medianMin: number; p95Min: number }[]   // nearest first
  /** How your reaching tidal water sits against the nearest high water at the
   *  first gauge with highs (Richmond on the Thames): minutes after (+) or before (−). */
  afterHigh?: { gauge: string; minutes: number; at: string }
}

/** The tide around when a plan reaches tidal water, from our own fits. Null
 *  when the route stays in fresh water or there's no start time. */
export function tideWindow(plan: ComputedPlan, pace: { paceKmh: number; portageMinutes: number; startAt?: string }, file: TidesFile): TideWindow | null {
  if (plan.tidalFromM === undefined || !pace.startAt) return null
  const portagesBefore = plan.stops.filter(s => s.leg === 'out' && s.portage && s.chainageM < plan.tidalFromM!).length
  const elapsedS = plan.tidalFromM / ((pace.paceKmh * 1000) / 3600) + portagesBefore * pace.portageMinutes * 60
  const reach = Date.parse(pace.startAt) + elapsedS * 1000
  // Only gauges near where this route meets tidal water: the Thames gauges say
  // nothing about the Severn (or Zeeland).
  const meets = (plan.line.length > 1 ? slice(plan.line, plan.tidalFromM, plan.tidalFromM + 1)[0] : undefined) ?? plan.finish.at
  // Nearest first (coming down the Thames to Teddington: Richmond, Westminster, Tower Pier).
  const near = Object.entries(file.gauges).filter(([, g]) => showable(g) && haversine(g.at, meets) <= TIDE_GAUGE_NEAR_M)
    .sort(([, a], [, b]) => haversine(a.at, meets) - haversine(b.at, meets))
  const gauges = near.map(([id, g]) => ({
    id, label: g.label, datum: g.datum, medianMin: g.backtest.medianMin, p95Min: g.backtest.p95Min,
    extremes: tideExtremes(g.model, reach - 6 * 3_600_000, reach + 9 * 3_600_000).filter(e => g.lows || e.type === 'high'),
  }))
  let afterHigh: TideWindow['afterHigh']
  for (const g of gauges) {
    const highs = g.extremes.filter(e => e.type === 'high')
    if (!highs.length) continue
    const near = highs.reduce((a, b) => (Math.abs(Date.parse(b.at) - reach) < Math.abs(Date.parse(a.at) - reach) ? b : a))
    afterHigh = { gauge: g.label, minutes: Math.round((reach - Date.parse(near.at)) / 60_000), at: near.at }
    break
  }
  if (!gauges.length) return null
  return { reachAt: new Date(reach).toISOString(), gauges, afterHigh }
}

/** A tide gauge further than this from where a route meets tidal water isn't its tide. */
export const TIDE_GAUGE_NEAR_M = 25_000

/** What the tide prediction is and isn't, and whose readings it's fitted to. */
export function tideNote(w: TideWindow): string {
  return w.gauges.some(g => g.datum === 'NAP')
    ? 'Predicted astronomical tide only. Wind and storm surge can move times by tens of minutes and heights by a metre or more on the Dutch coast. Not for navigation: check Rijkswaterstaat (waterinfo.rws.nl) on the day. Our own fit of Rijkswaterstaat gauge readings; heights above NAP.'
    : `${TIDE_CAVEAT} Our own fit of Environment Agency gauge readings (OGL); heights above Ordnance Datum.`
}

export const TIDE_CAVEAT = 'Predicted astronomical tide only. Surge, wind, pressure and the flow over Teddington weir can move times by tens of minutes, and low water above Westminster is unreliable. Not for navigation: check the PLA and Thames VTS on the day.'

// --- Print -----------------------------------------------------------------------

/** The stop kinds named in ?show= (unknown ones ignored), or the defaults. */
export function shownGroups(param: string | undefined): Set<StopGroup> {
  const known = new Set(STOP_GROUPS.map(g => g.id))
  const asked = (param ?? '').split(',').filter((g): g is StopGroup => known.has(g as StopGroup))
  return new Set(param !== undefined ? asked : STOP_GROUPS.filter(g => g.on).map(g => g.id))
}

/** On the crew sheet: places a crew can drive to and reach the bank. Towpath
 *  access points are left off (hundreds on a canal); locks only when we know
 *  how to get there. */
export function isCrewStop(stop: Stop): boolean {
  const f = stop.feature
  if (f.kind === 'access' || f.kind === 'slipway') return true
  if (f.kind === 'lock' || f.kind === 'portage') return !!(f.crew?.postcode || f.crew?.directions || f.crew?.parking || f.lock?.postcode)
  return false
}

/** What a crew needs at a stop: postcode, parking, how to get there. */
export function crewLines(stop: Stop): { postcode?: string; lines: string[] } {
  const f = stop.feature
  const lines: string[] = []
  if (f.crew?.parking) lines.push(`Parking: ${f.crew.parking}`)
  if (f.crew?.directions) lines.push(f.crew.directions)
  return { postcode: f.crew?.postcode ?? f.lock?.postcode, lines }
}

/** The print page for what's on screen. The route and timing travel in the
 *  address (as on /plan); a saved or shared plan adds its title and notes;
 *  `show` carries the stop kinds switched on in the planner. */
export function printHref(d: PlanDraft, opts: { id?: string; share?: string; crew?: boolean; show?: StopGroup[] } = {}): string {
  const extra = new URLSearchParams()
  if (opts.show) extra.set('show', opts.show.join(','))
  if (opts.id) extra.set('id', opts.id)
  if (opts.share) extra.set('share', opts.share)
  if (opts.crew) extra.set('crew', '1')
  const q = [draftParams(d), extra.toString().replace(/%2C/g, ',')].filter(Boolean).join('&')
  return `/plan/print${q ? `?${q}` : ''}`
}

export const PLAN_ERROR_TEXT: Record<PlanError, string> = {
  start_off_water: "The start isn't on a river or canal we cover. Zoom in and click on the water to move it.",
  finish_off_water: "The finish isn't on a river or canal we cover. Zoom in and click on the water to move it.",
  too_short: 'Start and finish are in the same place. Click further along the water.',
  not_connected: "We can't find a way along the water between those two points.",
}

export const km = (m: number) => `${(m / 1000).toFixed(1)} km`

/** How well we know a waterway (see waterwayCoverage), as the map and /plan/gaps show it. */
export const COVERAGE_LEVELS = [
  { id: 'good', label: 'Good', colour: '#22c55e', says: 'Places to get in and out, crew access, and every portage side known.' },
  { id: 'some', label: 'Some', colour: '#f59e0b', says: 'Some locks, weirs, access or facilities; gaps remain (most often portage sides).' },
  { id: 'thin', label: 'Thin', colour: '#f87171', says: 'Only the line of the water so far.' },
] as const

// --- The map's tiles -----------------------------------------------------------

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services'
const DATA_ATTR = 'Waterways &copy; OpenStreetMap contributors, Canal &amp; River Trust, Environment Agency'

/** The dark map, or aerial imagery for seeing where you can land. Esri's terms
 *  allow viewing and tracing over the imagery, never storing it, never printing
 *  it, never training on it (docs/features/river-planner.md). */
export function mapTiles(satellite: boolean) {
  return satellite ? {
    base: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    baseNativeZoom: 19,
    labels: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
    labelsNativeZoom: 19,
    attribution: `Imagery: Esri, Vantor, Earthstar Geographics, and the GIS User Community · ${DATA_ATTR}`,
  } : {
    base: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    baseNativeZoom: 16,
    labels: `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
    labelsNativeZoom: 16,
    attribution: `Tiles &copy; Esri · ${DATA_ATTR}`,
  }
}

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

/** Zoomed out further than this, one pixel is hundreds of metres and a click
 *  can't be "on the water": it zooms in on the spot instead of placing an end. */
export const PICK_MIN_ZOOM = 11

/** `px` screen pixels as metres on the ground, at this zoom and latitude
 *  (Web Mercator): how near a click is "on" a line. */
export function pixelsToMetres(lat: number, zoom: number, px = 10): number {
  return (px * 156_543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom
}

/** Where a new click goes: to an end that missed the water, so a bad click
 *  can be fixed by clicking again; else start first, then finish, then
 *  whichever is nearer. */
export function placeClick(d: PlanDraft, p: LatLng, offWater: 'start' | 'finish' | null = null): PlanDraft {
  if (offWater) return { ...d, [offWater]: p }
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

/** A north-up drawing of one portage for the printed sheet, from our own
 *  data (no map tiles: the satellite imagery may not be printed): the route
 *  near it, which way you're going, the take-out and put-in, and a scale.
 *  SVG coordinates, `size` pixels square, centred on the lock. */
export type PortageMap = {
  size: number
  route: string                                 // SVG path
  lock: [number, number]
  takeOut: [number, number]
  putIn: [number, number]
  arrow: { x: number; y: number; deg: number }  // deg clockwise from north
  scale: { px: number; m: number }
}

const NICE_M = [10, 20, 25, 50, 100, 200, 250, 500]

export function portageMap(line: LatLng[], stop: Pick<Stop, 'chainageM' | 'leg' | 'feature'>, p: PortageOnRoute, size = 220): PortageMap {
  const c = stop.feature.at
  const kx = Math.cos((c[0] * Math.PI) / 180) * 111_320, ky = 110_540
  const m = (q: LatLng): [number, number] => [(q[1] - c[1]) * kx, (q[0] - c[0]) * ky]   // metres east, north
  const reach = Math.max(...[p.takeOut.at, p.putIn.at].map(q => Math.hypot(...m(q))))
  const r = Math.min(400, Math.max(80, reach * 1.4))                                    // metres from centre to edge
  const k = size / (2 * r)
  const xy = (q: LatLng): [number, number] => { const [e, n] = m(q); return [Math.round((size / 2 + e * k) * 10) / 10, Math.round((size / 2 - n * k) * 10) / 10] }

  // Where the stop is on the drawn line: the back leg runs it in reverse.
  const cum = cumulative(line), len = cum[cum.length - 1]
  const pos = stop.leg === 'back' ? 2 * len - stop.chainageM : stop.chainageM
  const dir = stop.leg === 'back' ? -1 : 1
  const route = slice(line, pos - 2 * r, pos + 2 * r, cum).map(xy)
  // The arrow sits upstream of the stop, pointing the way you're going.
  const a = Math.min(len - 1, Math.max(1, pos - dir * 0.6 * r))
  const [p0, p1] = [slice(line, a - 10, a - 9, cum)[0], slice(line, a + 9, a + 10, cum)[0]].map(m)
  const deg = (Math.atan2((p1[0] - p0[0]) * dir, (p1[1] - p0[1]) * dir) * 180) / Math.PI
  const [ax, ay] = xy(slice(line, a, a + 1, cum)[0])
  const want = r / 2
  const scaleM = [...NICE_M].reverse().find(n => n <= want) ?? NICE_M[0]
  return {
    size,
    route: route.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(''),
    lock: xy(c), takeOut: xy(p.takeOut.at), putIn: xy(p.putIn.at),
    arrow: { x: ax, y: ay, deg: Math.round((deg + 360) % 360) },
    scale: { px: Math.round(scaleM * k), m: scaleM },
  }
}
