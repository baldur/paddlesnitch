// OpenStreetMap (ODbL) via the Overpass API: the navigable network, plus the
// points paddlers care about (lock gates, weirs, slipways, portages, water,
// toilets, parking). Both stay in the OSM layer of the dataset, unmodified
// apart from selection — see "Licence layers" in docs/features/river-planner.md.
//
// OS Open Rivers was tried first for the network, but it only carries canals
// where they're part of the drainage network: most of the Kennet & Avon summit
// pound is missing. OSM's canals and rivers run continuously through locks.
import { lineLength, round6, simplify } from '../line'
import type { LatLng, NetLink, OsmElement } from '../types'

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
      })
      start = i
    }
  }
  return out
}

/** canoe=* says it for paddlers; failing that, boat=* (yes on navigations). */
function paddleable(tags: Record<string, string>): NetLink['boat'] {
  const v = tags.canoe ?? tags.boat
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
