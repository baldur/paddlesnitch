// Loading a portage's page and the map's markers (server only). Built only from
// listPublicPortages and the dataset's mapped paths: a note waiting on its
// check, or held, has no public copy, so it can't appear here.
import { conditionsAlong } from './live-store'
import type { GaugeReading } from './live'
import { loadNational } from './national'
import { GAUGE_STALE_MIN, gaugeSourceCovers, hasPortagePage, nearestAlong, portageFacts, portagePointsInArea, type PortageFacts, type PortagePoint } from './portage-page'
import { listPublicPortages } from './portage-store'

/** Far enough along the water to find a gauge. */
const REACH_M = 15_000
const LEVEL_WAIT_MS = 4000
/** After a source fails, say so at once for this long rather than ask it on every view. */
const OUTAGE_MS = 60_000

const TOWN_KINDS = new Set(['city', 'town', 'village'])

export async function loadPortageFacts(id: string): Promise<PortageFacts | null> {
  const [ds, stored] = await Promise.all([loadNational(), listPublicPortages()])
  const feature = ds.features.find(f => f.id === id && hasPortagePage(f))
  if (!feature) return null
  const locks = ds.features.filter(f => f.id !== id && f.name && (f.kind === 'lock' || f.kind === 'portage')).map(f => ({ name: f.name!, at: f.at }))
  const towns = ds.places.filter(p => TOWN_KINDS.has(p.kind))
  return portageFacts(feature, ds.links, [...stored, ...ds.portages], REACH_M, locks, towns)
}

export async function loadPortagePoints(key: string): Promise<PortagePoint[]> {
  const [ds, stored] = await Promise.all([loadNational(), listPublicPortages()])
  return portagePointsInArea(ds.features, [...stored, ...ds.portages], key)
}

export type GaugeNear = {
  gauge?: GaugeReading
  awayM?: number               // along the water
  ageMin?: number              // how old the reading is
  stale?: boolean
  unavailable: boolean         // a source that covers this place couldn't be read
}

/** Sources that answered with a failure, and until when to believe it. Per source: one
 *  country's outage says nothing about another's. A slow answer isn't an outage. */
const failedUntil = new Map<string, number>()
export const clearLevelOutage = () => failedUntil.clear()

/** The nearest gauge's latest reading. A slow or failing source mustn't hold the page up. */
export async function loadGaugeNear(facts: PortageFacts, waitMs = LEVEL_WAIT_MS): Promise<GaugeNear> {
  if (facts.line.length < 2) return { unavailable: false }
  const at = facts.feature.at
  if ([...failedUntil].some(([s, until]) => Date.now() < until && gaugeSourceCovers(s, at))) return { unavailable: true }
  const reading = conditionsAlong(facts.line, facts.waterways, []).then((c): GaugeNear => {
    for (const s of c.unavailable) failedUntil.set(s, Date.now() + OUTAGE_MS)
    const gauge = nearestAlong(c.gauges.filter(g => g.valueM !== undefined || g.flowM3s !== undefined), facts.alongM)
    if (!gauge) return { unavailable: c.unavailable.some(s => gaugeSourceCovers(s, at)) }
    const ageMin = gauge.readAt ? (Date.now() - Date.parse(gauge.readAt)) / 60_000 : undefined
    return { gauge, awayM: Math.abs(gauge.chainageM - facts.alongM), ageMin, stale: ageMin !== undefined && ageMin > GAUGE_STALE_MIN, unavailable: false }
  }, (): GaugeNear => ({ unavailable: true }))
  let timer: ReturnType<typeof setTimeout>
  const slow = new Promise<GaugeNear>(done => { timer = setTimeout(() => done({ unavailable: true }), waitMs) })
  const result = await Promise.race([reading, slow])
  clearTimeout(timer!)
  return result
}
