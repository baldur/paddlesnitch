// Honest gaps: for each lock along a route, which of the facts a paddler and
// their crew need do we actually know? Computed from the data, never typed in.
import type { Along } from './along'
import { haversine } from '@paddlesnitch/timing/geo'
import { portagesAt, type PublicPortage } from './portage'
import type { Feature, OsmElement } from './types'

export const LOCK_FACTS = ['portageSide', 'takeOut', 'putIn', 'carry', 'crewAccess', 'parking', 'facilities'] as const
export type LockFact = (typeof LOCK_FACTS)[number]

export type LockCoverage = {
  lock: Feature
  chainageM: number
  known: Record<LockFact, boolean>
  sources: string[]            // where the known facts came from
}

const CREW_NEAR_M = 400
const PORTAGE_NEAR_M = 150
const FACILITY_NEAR_M = 300

/** Score every lock in `along` against what the rest of the data says.
 *  `portages` are landings at either end of a carry: paddlers' contributions
 *  (CC0) and OSM portage paths (`osmPortages`), matched as the planner does. */
export function lockCoverage(
  along: Along<Feature>[],
  osm: OsmElement[],
  portages: PublicPortage[] = [],
): LockCoverage[] {
  const features = along.map(a => a.item)
  const near = <T>(items: T[], at: (t: T) => [number, number], p: [number, number], m: number) =>
    items.filter(i => haversine(at(i), p) <= m)

  return along.filter(a => a.item.kind === 'lock').map(({ item: lock, chainageM }) => {
    const osmPortage = near(osm.filter(o => o.tags.portage || o.tags.canoe === 'portage'), o => o.at, lock.at, PORTAGE_NEAR_M)
    const osmParking = near(osm.filter(o => o.tags.amenity === 'parking'), o => o.at, lock.at, CREW_NEAR_M)
    const crewPoints = near(features.filter(f => f.kind === 'crew_point'), f => f.at, lock.at, CREW_NEAR_M)
    const facilityPoints = near(features.filter(f => f.kind === 'facility'), f => f.at, lock.at, FACILITY_NEAR_M)
    const p = lock.portage
    const atLock = portagesAt(lock, portages)
    const landed = atLock.length > 0
    const sources = new Set<string>([lock.source.source])
    for (const c of atLock) sources.add(c.licence === 'ODbL-1.0' ? 'osm' : 'contribution')
    if (lock.crew) sources.add('ea-thames-site-guides')
    if (osmPortage.length || osmParking.length) sources.add('osm')
    if (crewPoints.length) sources.add('crt')

    return {
      lock,
      chainageM,
      known: {
        portageSide: !!p?.side || landed,
        takeOut: !!p?.takeOut || landed,
        putIn: !!p?.putIn || landed,
        carry: !!p?.carryM || osmPortage.length > 0 || landed,
        crewAccess: !!lock.crew?.directions || crewPoints.length > 0,
        parking: !!lock.crew?.parking || osmParking.length > 0,
        facilities: lock.lock?.facilities !== undefined || facilityPoints.length > 0,
      },
      sources: [...sources],
    }
  })
}

/** Share of locks with each fact known, 0–1. */
export function coverageSummary(rows: LockCoverage[]): Record<LockFact, number> {
  const out = {} as Record<LockFact, number>
  for (const f of LOCK_FACTS) out[f] = rows.length ? rows.filter(r => r.known[f]).length / rows.length : 0
  return out
}
