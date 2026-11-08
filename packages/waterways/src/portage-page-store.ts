// Loading a portage's page and the map's markers (server only). Built only from
// listPublicPortages and the dataset's mapped paths: a note waiting on its
// check, or held, has no public copy, so it can't appear here.
import { conditionsAlong } from './live-store'
import type { GaugeReading } from './live'
import { loadNational } from './national'
import { hasPortagePage, nearestAlong, portageFacts, portagePointsInArea, type PortageFacts, type PortagePoint } from './portage-page'
import { listPublicPortages } from './portage-store'

/** Far enough along the water to find a gauge. */
const REACH_M = 15_000
const LEVEL_WAIT_MS = 4000

export async function loadPortageFacts(id: string): Promise<PortageFacts | null> {
  const [ds, stored] = await Promise.all([loadNational(), listPublicPortages()])
  const feature = ds.features.find(f => f.id === id && hasPortagePage(f))
  return feature ? portageFacts(feature, ds.links, [...stored, ...ds.portages], REACH_M) : null
}

export async function loadPortagePoints(key: string): Promise<PortagePoint[]> {
  const [ds, stored] = await Promise.all([loadNational(), listPublicPortages()])
  return portagePointsInArea(ds.features, [...stored, ...ds.portages], key)
}

export type RiverLevelNow = { gauge?: GaugeReading; unavailable: boolean }

/** Today's reading at the nearest gauge. A slow source mustn't hold the page up. */
export async function loadLevelNear(facts: PortageFacts): Promise<RiverLevelNow> {
  if (facts.line.length < 2) return { unavailable: false }
  const reading = conditionsAlong(facts.line, facts.waterways, []).then(c => ({
    gauge: nearestAlong(c.gauges.filter(g => g.valueM !== undefined || g.flowM3s !== undefined), facts.alongM),
    unavailable: c.unavailable.length > 0,
  }), () => ({ unavailable: true }))
  const slow = new Promise<RiverLevelNow>(done => setTimeout(() => done({ unavailable: true }), LEVEL_WAIT_MS))
  return Promise.race([reading, slow])
}
