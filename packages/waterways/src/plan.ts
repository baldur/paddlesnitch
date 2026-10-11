// A plan: two clicks on the water, one-way or there and back, turned into the
// route and every stop along it with arrival times at the paddler's pace.
// Pure, so the browser computes it as you click and the server can too.
//
// A plan stores the clicks, not network ids: OSM way ids change when a region
// is rebuilt, a click on the map doesn't.
import { featuresAlong } from './along'
import { reverseRoute, route, snap, type Snap } from './network'
import type { Feature, FeatureKind, LatLng, RegionDataset } from './types'

export type PlanShape = 'one_way' | 'return'

export type PlanInput = {
  start: LatLng
  finish: LatLng
  shape: PlanShape
  startAt?: string        // ISO; with it, every stop gets a clock time
  paceKmh: number         // moving pace
  portageMinutes: number  // added at every portage
}

export const DEFAULT_PACE_KMH = 8
export const DEFAULT_PORTAGE_MINUTES = 3
/** A click further than this from any river or canal we cover isn't on the water. */
export const SNAP_MAX_M = 1000
/** Start and finish closer than this aren't a trip. */
export const MIN_TRIP_M = 100

/** Kinds you get out of the boat for. */
const PORTAGE_KINDS: ReadonlySet<FeatureKind> = new Set(['lock', 'portage'])

export type Stop = {
  feature: Feature
  leg: 'out' | 'back'
  chainageM: number        // metres from the start of the whole trip
  fromPrevM: number        // metres from the previous stop (or the start)
  bank?: 'left' | 'right'  // looking downstream of the paddler, i.e. in the direction of travel
  portage: boolean
  portagesBefore: number   // portages already done when you get here
  elapsedS: number         // from the start, moving time plus portages so far
  eta?: string             // ISO, when startAt is set
}

export type Spot = { at: LatLng; waterway: string }

export type ComputedPlan = {
  start: Spot
  finish: Spot
  line: LatLng[]           // the whole trip; a return goes out and back on it
  turnM?: number           // a return turns here (metres from the start)
  lengthM: number
  portages: number
  movingS: number
  totalS: number
  finishAt?: string
  stops: Stop[]
}

export type PlanError = 'start_off_water' | 'finish_off_water' | 'too_short' | 'not_connected'

export function snapClick(dataset: RegionDataset, p: LatLng): Snap | null {
  const s = snap(dataset.links, p)
  return s && s.dist <= SNAP_MAX_M ? s : null
}

export function computePlan(dataset: RegionDataset, input: PlanInput): ComputedPlan | PlanError {
  const s = snapClick(dataset, input.start)
  if (!s) return 'start_off_water'
  const f = snapClick(dataset, input.finish)
  if (!f) return 'finish_off_water'
  const out = route(dataset.links, s, f)
  if (!out) return 'not_connected'
  if (out.lengthM < MIN_TRIP_M) return 'too_short'

  const legs: { leg: Stop['leg']; line: LatLng[]; offsetM: number }[] = [{ leg: 'out', line: out.line, offsetM: 0 }]
  if (input.shape === 'return') legs.push({ leg: 'back', line: reverseRoute(out).line, offsetM: out.lengthM })
  const lengthM = out.lengthM * legs.length

  const mps = (input.paceKmh * 1000) / 3600
  const portageS = input.portageMinutes * 60
  const t0 = input.startAt ? Date.parse(input.startAt) : NaN

  const stops: Stop[] = []
  let prevM = 0, portages = 0
  for (const { leg, line, offsetM } of legs) {
    for (const a of featuresAlong(line, dataset.features)) {
      const chainageM = offsetM + a.chainageM
      const portage = PORTAGE_KINDS.has(a.item.kind)
      const elapsedS = chainageM / mps + portages * portageS
      stops.push({
        feature: a.item, leg, chainageM, fromPrevM: chainageM - prevM, bank: a.bank,
        portage, portagesBefore: portages, elapsedS,
        eta: Number.isFinite(t0) ? new Date(t0 + elapsedS * 1000).toISOString() : undefined,
      })
      prevM = chainageM
      if (portage) portages++
    }
  }

  const movingS = lengthM / mps
  const totalS = movingS + portages * portageS
  return {
    start: { at: s.at, waterway: s.link.name },
    finish: { at: f.at, waterway: f.link.name },
    line: out.line,
    turnM: input.shape === 'return' ? out.lengthM : undefined,
    lengthM,
    portages,
    movingS,
    totalS,
    finishAt: Number.isFinite(t0) ? new Date(t0 + totalS * 1000).toISOString() : undefined,
    stops,
  }
}

/** Hours and minutes, "3 h 05 min" / "45 min". */
export function fmtDuration(s: number): string {
  const m = Math.round(s / 60)
  const h = Math.floor(m / 60)
  return h ? `${h} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`
}
