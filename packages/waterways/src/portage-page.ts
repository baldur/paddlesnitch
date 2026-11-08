// What the map's portage markers and a portage's own page need (pure). The page
// has no route behind it, so it finds the water through the lock itself and
// gives banks by compass heading, both ways.
import { AREA_DEG, areaKey } from './display'
import { along } from './along'
import { cumulative, project, slice } from './line'
import { snap } from './network'
import { SOURCES } from './sources'
import { portageOnRoute, portagesAt, type PortageOnRoute, type PublicPortage } from './portage'
import type { Feature, LatLng, NetLink } from './types'

/** Below this the markers would crowd the map. */
export const PORTAGE_MIN_ZOOM = 12

/** What a marker can say: landings described, a lock you can paddle through, or nothing yet. */
export type PortageMarkState = 'landings' | 'no_carry' | 'unknown'
export type PortagePoint = { id: string; at: LatLng; name: string; state: PortageMarkState }

export const KIND_NAME: Partial<Record<Feature['kind'], string>> = { lock: 'Lock', portage: 'Portage', weir: 'Weir' }
export const portageName = (f: Feature) => f.name ?? KIND_NAME[f.kind] ?? 'Portage'

/** A feature with a page: anything you carry round. */
export const hasPortagePage = (f: Feature) => f.kind === 'lock' || f.kind === 'portage' || f.kind === 'weir'

/** Locks and portages in one area. A weir shows only once someone has described a carry round it. */
export function portagePointsInArea(features: Feature[], portages: PublicPortage[], key: string): PortagePoint[] {
  return features.flatMap(f => {
    if (!hasPortagePage(f) || areaKey(Math.floor(f.at[0] / AREA_DEG), Math.floor(f.at[1] / AREA_DEG)) !== key) return []
    const state: PortageMarkState = portagesAt(f, portages).length ? 'landings' : f.noCarry ? 'no_carry' : 'unknown'
    return f.kind === 'weir' && state === 'unknown' ? [] : [{ id: f.id, at: f.at, name: portageName(f), state }]
  })
}

/** An id from the address. Null when it isn't valid percent-encoding, which is a 404, not a crash. */
export function decodePortageId(raw: string): string | null {
  try { return decodeURIComponent(raw) } catch { return null }
}

const nodes = new WeakMap<NetLink[], Map<string, NetLink[]>>()
function atNodes(links: NetLink[]) {
  let m = nodes.get(links)
  if (!m) {
    m = new Map()
    for (const l of links) for (const n of [l.from, l.to]) m.set(n, [...(m.get(n) ?? []), l])
    nodes.set(links, m)
  }
  return m
}

const bearing = (a: LatLng, b: LatLng) => {
  const k = Math.cos((a[0] * Math.PI) / 180)
  return Math.atan2((b[1] - a[1]) * k, b[0] - a[0])
}
const turn = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))

/** On from a node, taking the straightest paddleable link at each junction. */
function walk(links: NetLink[], from: LatLng[], node: string, came: string, reachM: number) {
  const index = atNodes(links)
  const pts: LatLng[] = [], names: string[] = []
  const seen = new Set([came])
  let here = from, at = node, left = reachM
  while (left > 0) {
    const next: { l: NetLink; line: LatLng[]; end: string } | undefined = (index.get(at) ?? [])
      .filter(l => !seen.has(l.id) && !l.culvert)
      .map(l => (l.from === at ? { l, line: l.line, end: l.to } : { l, line: [...l.line].reverse(), end: l.from }))
      .sort((a, b) => Number(a.l.boat === 'no') - Number(b.l.boat === 'no')
        || turn(bearing(here[here.length - 2], here[here.length - 1]), bearing(a.line[0], a.line[1]))
        - turn(bearing(here[here.length - 2], here[here.length - 1]), bearing(b.line[0], b.line[1])))[0]
    if (!next) break
    seen.add(next.l.id)
    pts.push(...next.line.slice(1))
    if (next.l.name) names.push(next.l.name)
    left -= next.l.lengthM
    here = next.line
    at = next.end
  }
  return { pts, names }
}

/** The water through a point, `reachM` or as far as it goes each way. */
export function lineThrough(links: NetLink[], at: LatLng, reachM: number): { line: LatLng[]; waterways: string[] } | null {
  const s = snap(links, at, 300)
  if (!s) return null
  const ahead = walk(links, s.link.line, s.link.to, s.link.id, reachM)
  const behind = walk(links, [...s.link.line].reverse(), s.link.from, s.link.id, reachM)
  return {
    line: [...[...behind.pts].reverse(), ...s.link.line, ...ahead.pts],
    waterways: [...new Set([s.link.name, ...ahead.names, ...behind.names].filter(Boolean))],
  }
}

const WINDS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']

/** Which way the line runs at a point on it, in words. */
export function headingAt(line: LatLng[], alongM: number, cum = cumulative(line)): string {
  const part = slice(line, Math.max(0, alongM - 40), alongM + 40, cum)
  const deg = (bearing(part[0], part[part.length - 1]) * 180) / Math.PI
  return WINDS[Math.round(((deg + 360) % 360) / 45) % 8]
}

/** OSM names short lengths after their locks ("Lock 50 (Top Lock)"): not waterways. */
export const realWaterways = (names: string[]) => names.filter(n => !/\block\b|\bweir\b/i.test(n) || /\b(canal|river|navigation)\b/i.test(n))

/** Where a way of travel leads: a place a paddler can picture. */
export type PortageTarget = { name: string; at: LatLng }

/** Short enough to read in a sentence: no "Lock 100," and no survey note after a colon. */
export const shortPlaceName = (name: string) => name.split(':')[0].replace(/^Lock \d+[A-Za-z]?,\s*/, '').trim()

export type PortageWay = { towards: string; portage: PortageOnRoute }

/** One described portage, seen each way along the water. */
export type PortageBothWays = { id: string; ways: [PortageWay, PortageWay] }

export type PortageFacts = {
  feature: Feature
  name: string
  line: LatLng[]                // through the lock, the way `ways[0]` is travelled
  waterways: string[]           // every name along `line`, for finding gauges
  alongM: number                // the lock's place on `line`
  portages: PortageBothWays[]
}

const LOCK_NEAR_M = 150, TOWN_NEAR_M = 1500, SKIP_M = 60

/** The next named place each way along the line: a lock if there is one, else a town, else a compass point. */
function placesEachWay(line: LatLng[], alongM: number, locks: PortageTarget[], towns: PortageTarget[]): [string, string] {
  const cum = cumulative(line), total = cum[cum.length - 1]
  const onLine = (items: PortageTarget[], near: number) => along(line, items, t => t.at, () => near)
  const next = (items: PortageTarget[], near: number, dir: 1 | -1) => onLine(items, near)
    .filter(a => (a.chainageM - alongM) * dir > SKIP_M)
    .sort((a, b) => (a.chainageM - b.chainageM) * dir)[0]?.item.name
  const way = (dir: 1 | -1) => {
    const name = next(locks, LOCK_NEAR_M, dir) ?? next(towns, TOWN_NEAR_M, dir)
    if (name) return shortPlaceName(name)
    const from = dir === 1 ? alongM : total - alongM
    return `the ${headingAt(dir === 1 ? line : [...line].reverse(), from)}`
  }
  return [way(1), way(-1)]
}

/** Everything we know about one portage. `portages` are public ones only. */
export function portageFacts(feature: Feature, links: NetLink[], portages: PublicPortage[], reachM: number, locks: PortageTarget[] = [], towns: PortageTarget[] = []): PortageFacts {
  const through = lineThrough(links, feature.at, reachM)
  const line = through?.line ?? []
  const here = portagesAt(feature, portages)
  const drawable = line.length > 1
  const cum = drawable ? cumulative(line) : []
  const alongM = drawable ? project(line, feature.at, cum).along : 0
  const back = [...line].reverse(), backCum = drawable ? cumulative(back) : []
  const [ahead, behind] = drawable && here.length ? placesEachWay(line, alongM, locks, towns) : ['', '']
  return {
    feature, name: portageName(feature), line, waterways: through?.waterways ?? [], alongM,
    portages: drawable ? here.map(c => ({
      id: c.id,
      ways: [
        { towards: ahead, portage: portageOnRoute(line, c, cum) },
        { towards: behind, portage: portageOnRoute(back, c, backCum) },
      ],
    })) : [],
  }
}

/** The gauge nearest along the water, not in a straight line. */
export function nearestAlong<T extends { chainageM: number }>(gauges: T[], alongM: number): T | undefined {
  return [...gauges].sort((a, b) => Math.abs(a.chainageM - alongM) - Math.abs(b.chainageM - alongM))[0]
}

/** How old a reading can be and still say how the river is now. */
export const GAUGE_STALE_MIN = 6 * 60

/** "40 minutes" or "3 hours": a reading's age, the same for every reader wherever they are. */
export function ageText(minutes: number): string {
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} ${Math.round(minutes) <= 1 ? 'minute' : 'minutes'}`
  const h = Math.round(minutes / 60)
  if (h < 48) return `${h} ${h === 1 ? 'hour' : 'hours'}`
  return `${Math.round(h / 24)} days`
}

/** Roughly where each gauge source covers, as [south, west, north, east]. Generous
 *  at borders: near one, a failed neighbour says "couldn't read", which is the safe way to be wrong. */
const GAUGE_SOURCE_AREA: Record<string, [number, number, number, number]> = {
  'Environment Agency': [49.8, -6.5, 55.9, 2],
  SEPA: [54.5, -8, 61, 0],
  OPW: [51.2, -11, 55.6, -5.3],
  Rijkswaterstaat: [50.6, 3.2, 53.7, 7.3],
  'waterinfo.be': [50.6, 2.4, 51.6, 6],
  PEGELONLINE: [47.2, 5.8, 55.2, 15.2],
  BAFU: [45.7, 5.8, 47.9, 10.6],
  SMHI: [55, 10.9, 69.2, 24.3],
}

/** Whether a source that failed could have had a gauge at this place. */
export const gaugeSourceCovers = (source: string, at: LatLng) => {
  const a = GAUGE_SOURCE_AREA[source]
  return !!a && at[0] >= a[0] && at[1] >= a[1] && at[0] <= a[2] && at[1] <= a[3]
}

const GAUGE_OWNERS: Record<string, string> = {
  ea: 'Environment Agency', sepa: 'SEPA', opw: 'OPW', rws: 'Rijkswaterstaat', waterinfo: 'waterinfo.be', pegelonline: 'PEGELONLINE', bafu: 'BAFU', smhi: 'SMHI',
}
export const gaugeOwner = (source: string) => GAUGE_OWNERS[source] ?? source

/** Every source a portage's page draws on, for screen and print. */
export function portageCredits(f: Pick<PortageFacts, 'feature' | 'line'>, gaugeSource?: string): string[] {
  const id = f.feature.source.source
  const source = SOURCES[id]
  return [
    ...(id === 'curated' ? ['Details from a paddlesnitch survey.'] : source ? [`Details from ${source.name}.`] : []),
    ...(f.line.length > 1 ? [`Water: ${SOURCES.osm.attribution}.`] : []),
    ...(gaugeSource ? [`River level: ${gaugeOwner(gaugeSource)}.`] : []),
  ]
}
