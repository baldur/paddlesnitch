// OpenStreetMap (ODbL) via the Overpass API: the navigable network, plus the
// points paddlers care about (lock gates, weirs, slipways, portages, water,
// toilets, parking). Both stay in the OSM layer of the dataset, unmodified
// apart from selection — see "Licence layers" in docs/features/river-planner.md.
//
// OS Open Rivers was tried first for the network, but it only carries canals
// where they're part of the drainage network: most of the Kennet & Avon summit
// pound is missing. OSM's canals and rivers run continuously through locks.
import { lineLength, round6, simplify } from '../line'
import { haversine } from '@paddlesnitch/timing/geo'
import type { Feature, LatLng, NetLink, OsmElement } from '../types'

type Bbox = [number, number, number, number]   // [south, west, north, east]

export const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

const bboxClause = ([s, w, n, e]: Bbox) => `[bbox:${s},${w},${n},${e}]`
// Overpass regexes: escape anything that isn't a letter/digit/space.
const reEscape = (s: string) => s.replace(/[^A-Za-z0-9 ]/g, c => `\\\\${c}`)

/** Rivers and canals with one of the given names, plus every lock chamber
 *  and lock cut in the box (lock cuts are often named "X Cut" or unnamed). */
export function networkQuery(bbox: Bbox, names: string[]): string {
  const re = names.map(n => `^${reEscape(n)}$`).join('|')
  return `[out:json][timeout:180]${bboxClause(bbox)};
(
  way["waterway"~"^(river|canal)$"]["name"~"${re}"];
  way["waterway"~"^(river|canal)$"]["name"~"Cut$"];
  way["waterway"~"^(river|canal)$"]["lock"="yes"];
);
out geom qt;`
}

/** The points we keep in the OSM layer. Parking is everywhere, so the build
 *  keeps only what's near the route. */
export function featureQuery(bbox: Bbox): string {
  return `[out:json][timeout:180]${bboxClause(bbox)};
(
  node["waterway"~"^(lock_gate|weir|dam)$"];
  way["waterway"~"^(weir|dam)$"];
  nwr["leisure"="slipway"];
  nwr["portage"];
  nwr["canoe"];
  node["amenity"~"^(drinking_water|water_point|toilets)$"];
  nwr["amenity"="parking"];
);
out center tags qt;`
}

type OverpassWay = {
  type: 'way'; id: number
  nodes: number[]
  geometry: { lat: number; lon: number }[]
  tags?: Record<string, string>
}
type OverpassElement =
  | OverpassWay
  | { type: 'node'; id: number; lat: number; lon: number; tags?: Record<string, string> }
  | { type: 'way' | 'relation'; id: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }

/** A waterway way with its node ids and coordinates, from Overpass or from
 *  the Geofabrik extract (scripts/waterways/osm_extract.py). */
export type OsmWay = { id: number; nodes: number[]; coords: LatLng[]; tags?: Record<string, string> }

export function linksFromOverpass(elements: OverpassElement[], simplifyM = 3): NetLink[] {
  const ways = elements.filter((e): e is OverpassWay => e.type === 'way' && 'nodes' in e && !!e.geometry)
  return linksFromWays(ways.map(w => ({ id: w.id, nodes: w.nodes, coords: w.geometry.map(g => [g.lat, g.lon]), tags: w.tags })), simplifyM)
}

/** Ways → network links, split wherever ways meet: OSM joins a side channel
 *  to the middle of the main river's way, so way ends alone aren't junctions. */
export function linksFromWays(ways: OsmWay[], simplifyM = 3): NetLink[] {
  const uses = new Map<number, number>()
  for (const w of ways) for (const n of new Set(w.nodes)) uses.set(n, (uses.get(n) ?? 0) + 1)

  const out: NetLink[] = []
  for (const w of ways) {
    const name = w.tags?.name ?? ''
    const form: NetLink['form'] = w.tags?.waterway === 'canal' ? 'canal' : w.tags?.tidal === 'yes' ? 'tidalRiver' : 'inlandRiver'
    const boat = paddleable(w.tags ?? {})
    const culvert = w.tags?.tunnel === 'culvert'
    const canoeRoute = w.tags?.canoe_route
    let start = 0
    for (let i = 1; i < w.nodes.length; i++) {
      if (i < w.nodes.length - 1 && (uses.get(w.nodes[i]) ?? 0) < 2) continue
      const line = simplify(w.coords.slice(start, i + 1), simplifyM).map(round6)
      out.push({
        id: `w${w.id}:${start}`,
        name,
        form,
        from: `n${w.nodes[start]}`,
        to: `n${w.nodes[i]}`,
        line,
        lengthM: Math.round(lineLength(line)),
        ...(boat ? { boat } : {}),
        ...(culvert ? { culvert: true as const } : {}),
        ...(canoeRoute ? { canoeRoute } : {}),
      })
      start = i
    }
  }
  return out
}

/** canoe=* says it for paddlers; failing that, being on a mapped canoe route
 *  (canoe_route, set by osm_extract.py from route=canoe relations); failing
 *  that, boat=* (yes on navigations). */
function paddleable(tags: Record<string, string>): NetLink['boat'] {
  const v = tags.canoe ?? (tags.canoe_route ? 'yes' : undefined) ?? tags.boat
  if (v === 'yes' || v === 'designated' || v === 'permissive') return 'yes'
  if (v === 'no' || v === 'private') return 'no'
  return undefined
}

/** Tagged points → OSM layer elements (a way or relation sits at its centre). */
export function osmElementsFromOverpass(elements: OverpassElement[]): OsmElement[] {
  const out: OsmElement[] = []
  for (const e of elements) {
    if (!e.tags) continue
    const at: LatLng | null =
      e.type === 'node' && 'lat' in e ? [e.lat, e.lon]
      : 'center' in e && e.center ? [e.center.lat, e.center.lon]
      : null
    if (at) out.push({ id: `${e.type}/${e.id}`, at: round6(at), tags: e.tags })
  }
  return out
}

/** Lock chambers from OSM ways tagged lock=yes, one per chamber (a chamber
 *  drawn as several ways is merged), at the chamber's middle. These are OSM
 *  data (ODbL): the national build publishes them in their own file and they
 *  only fill gaps where no authority lists the lock. */
export function osmLocks(ways: OsmWay[], fetchedAt: string, mergeM = 50): Feature[] {
  const chambers: { ids: number[]; at: LatLng; name?: string }[] = []
  for (const w of ways) {
    // Boat rollers are tagged as chambers (Teddington, Richmond): a portage aid,
    // not a lock. Private locks are marina entrances, not on anyone's way.
    if (w.tags?.lock !== 'yes' || !w.coords.length || /roller/i.test(w.tags.lock_name ?? '')) continue
    if (w.tags.access === 'private' || w.tags.access === 'no') continue
    const at = w.coords[Math.floor(w.coords.length / 2)]
    const name = w.tags.lock_name ?? (/\block\b/i.test(w.tags.name ?? '') ? w.tags.name : undefined)
    const same = chambers.find(c => haversine(c.at, at) <= mergeM)
    if (same) { same.ids.push(w.id); same.name ??= name; continue }
    chambers.push({ ids: [w.id], at, name })
  }
  return chambers.map(c => ({
    id: `osm:lock:way/${Math.min(...c.ids)}`,
    kind: 'lock' as const,
    name: c.name,
    at: round6(c.at),
    source: { source: 'osm' as const, sourceId: `way/${Math.min(...c.ids)}`, fetchedAt },
  }))
}

/** Locks mapped only as their gates: two or more waterway=lock_gate nodes
 *  within pairM of each other, with no chamber way within gapM (most of the
 *  Medway's locks are drawn like this). One gate alone is left out: it could
 *  be a flood or tide gate. Gates drawn as lines are left out too: on the
 *  tidal Thames they're dock and marina entrances (St Katharine, Surrey Docks,
 *  Chelsea Harbour), not locks on anyone's way. Same licence and gap rule as
 *  osmLocks. */
export function osmGateLocks(points: OsmElement[], chambers: Feature[], fetchedAt: string, pairM = 60, gapM = 120): Feature[] {
  const gates = points.filter(p => p.id.startsWith('node/') && p.tags.waterway === 'lock_gate' && p.tags.access !== 'private')
  const group = gates.map((_, i) => i)
  const root = (i: number): number => (group[i] === i ? i : (group[i] = root(group[i])))
  for (let i = 0; i < gates.length; i++) {
    for (let j = i + 1; j < gates.length; j++) {
      if (Math.abs(gates[i].at[0] - gates[j].at[0]) < 0.001 && haversine(gates[i].at, gates[j].at) <= pairM) group[root(i)] = root(j)
    }
  }
  const clusters = new Map<number, OsmElement[]>()
  gates.forEach((g, i) => clusters.set(root(i), [...(clusters.get(root(i)) ?? []), g]))
  return [...clusters.values()].flatMap(c => {
    if (c.length < 2) return []
    const at = round6([c.reduce((n, g) => n + g.at[0], 0) / c.length, c.reduce((n, g) => n + g.at[1], 0) / c.length])
    if (chambers.some(ch => haversine(ch.at, at) <= gapM)) return []
    const id = c.map(g => g.id).sort((a, b) => Number(a.split('/')[1]) - Number(b.split('/')[1]))[0]
    const name = c.map(g => g.tags.lock_name ?? (/\block\b/i.test(g.tags.name ?? '') ? g.tags.name : undefined)).find(Boolean)
    return [{ id: `osm:lock:${id}`, kind: 'lock' as const, name, at, source: { source: 'osm' as const, sourceId: id, fetchedAt } }]
  })
}

/** Public slipways and canoe put-ins mapped in OpenStreetMap: places to get on
 *  and off the water where no authority lists one (the build applies the gap
 *  rule). Private, customers-only and closed ones are left out. ODbL, published
 *  with the OSM locks in osm-features. */
export function osmAccess(points: OsmElement[], fetchedAt: string): Feature[] {
  const closed = new Set(['private', 'no', 'customers', 'members', 'customers;private', 'emergency'])
  return points.flatMap(p => {
    const t = p.tags
    if (closed.has(t.access ?? '') || closed.has(t.canoe ?? '')) return []
    const slipway = t.leisure === 'slipway'
    const putIn = t.canoe === 'put_in' || (t.waterway === 'access_point' && ['yes', 'designated', 'permissive', 'permit'].includes(t.canoe ?? 'yes'))
    if (!slipway && !putIn) return []
    return [{
      id: `osm:access:${p.id}`,
      kind: slipway ? 'slipway' as const : 'access' as const,
      name: t.name,
      at: p.at,
      source: { source: 'osm' as const, sourceId: p.id, fetchedAt },
    }]
  })
}

/** Public toilets and drinking water mapped in OpenStreetMap, as facilities
 *  (the build keeps those beside the water with none of ours nearby). Car parks
 *  are left out: there are hundreds of thousands, and a supermarket's says
 *  nothing about reaching the bank. ODbL, published in osm-features. */
export function osmFacilities(points: OsmElement[], fetchedAt: string): Feature[] {
  const closed = new Set(['private', 'no', 'customers', 'members', 'permit'])
  return points.flatMap(p => {
    const t = p.tags
    const kind = t.amenity === 'toilets' ? 'toilet' as const : t.amenity === 'drinking_water' || t.amenity === 'water_point' ? 'drinking_water' as const : null
    if (!kind || closed.has(t.access ?? '') || t.drinking_water === 'no') return []
    return [{ id: `osm:facility:${p.id}`, kind: 'facility' as const, name: t.name, at: p.at, facilities: [kind], source: { source: 'osm' as const, sourceId: p.id, fetchedAt } }]
  })
}

/** Britain and Ireland's most easterly water is at Lowestoft (1.76° E). The
 *  Geofabrik extract clips in a little of the North Sea; a way lying wholly
 *  east of this (the Maasgeul, Rotterdam's shipping channel) isn't ours. */
export const EAST_LIMIT = 1.8
export const isOurs = (w: OsmWay) => w.coords.some(c => c[1] <= EAST_LIMIT)
