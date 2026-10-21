// The Dutch water boards' structures (Waterschappen Kunstwerken IMWA, all
// boards in one national set via PDOK, CC BY-SA 4.0): what a paddler meets
// on polder water. Share-alike, so published in its own file (sa-features),
// like the OSM layer, and never fed into the CC0 contributions. Not every
// board delivers yet. See docs/features/waterways-netherlands.md.
import { round6 } from '../line'
import type { Feature, FeatureKind, LatLng } from '../types'

export const WATERBOARDS_WFS = 'https://service.pdok.nl/hwh/waterschappen-kunstwerken-imwa/wfs/v2_0'
/** PDOK serves at most this many features a page, and no page starting past
 *  50,000, so the country is read in quadrants (each well under that). */
export const WFS_PAGE = 1000
export const NL_QUADRANTS: [number, number, number, number][] = [   // [south, west, north, east]
  [50.7, 3.2, 52.2, 5.3], [50.7, 5.3, 52.2, 7.3], [52.2, 3.2, 53.7, 5.3], [52.2, 5.3, 53.7, 7.3],
]

/** The layers we read, as what a paddler meets. Culverts, bridges, siphons and
 *  the like are left out: you paddle under or nowhere near them. */
export const WATERBOARD_LAYERS: Record<string, { kind: FeatureKind; name?: string }> = {
  stuw: { kind: 'weir' },                              // weir
  bodemval: { kind: 'weir', name: 'Drop' },            // a step in the bed
  vastedam: { kind: 'hazard', name: 'Dam' },           // fixed dam: no way through
  gemaal: { kind: 'hazard', name: 'Pumping station' }, // keep clear of the intake
  sluis: { kind: 'lock' },                             // the boards' own small locks
}

export function waterboardPageUrl(layer: string, bbox: [number, number, number, number], startIndex: number): string {
  const q = new URLSearchParams({
    SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature', typeNames: `waterschappen-kunstwerken-imwa:${layer}`,
    count: String(WFS_PAGE), startIndex: String(startIndex), outputFormat: 'application/json', srsName: 'EPSG:4326',
    BBOX: `${bbox.join(',')},urn:ogc:def:crs:EPSG::4326`,   // WFS 2.0 with EPSG:4326 is latitude first
  })
  return `${WATERBOARDS_WFS}?${q}`
}

/** How many a quadrant holds. Pages can come back short with more to come,
 *  so paging runs to this count, not to the first short page. */
export function waterboardHitsUrl(layer: string, bbox: [number, number, number, number]): string {
  const q = new URLSearchParams({
    SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature', typeNames: `waterschappen-kunstwerken-imwa:${layer}`,
    resultType: 'hits', BBOX: `${bbox.join(',')},urn:ogc:def:crs:EPSG::4326`,
  })
  return `${WATERBOARDS_WFS}?${q}`
}

export const hitsOf = (xml: string) => Number(/numberMatched="(\d+)"/.exec(xml)?.[1] ?? NaN)

type Geo = { type: string; coordinates: unknown } | null
type WfsFeature = { id?: string; geometry: Geo; properties: Record<string, unknown> }

/** A point for any geometry: the point itself, or the mean of a line's or
 *  polygon's vertices. */
function pointOf(g: Geo): LatLng | null {
  if (!g) return null
  const flat: number[][] = []
  const walk = (c: unknown) => { if (Array.isArray(c) && typeof c[0] === 'number') flat.push(c as number[]); else if (Array.isArray(c)) c.forEach(walk) }
  walk(g.coordinates)
  if (!flat.length) return null
  return [flat.reduce((n, p) => n + p[1], 0) / flat.length, flat.reduce((n, p) => n + p[0], 0) / flat.length]
}

export function featuresFromWaterboards(layer: string, list: WfsFeature[], fetchedAt: string): Feature[] {
  const how = WATERBOARD_LAYERS[layer]
  if (!how) return []
  return list.flatMap(f => {
    const at = pointOf(f.geometry)
    const p = f.properties
    if (!at || (typeof p.statusobject === 'string' && p.statusobject && p.statusobject !== 'gerealiseerd')) return []
    const id = String(p.nen3610id || p.guid || p.code || f.id)
    const name = typeof p.naam === 'string' && p.naam.trim() ? p.naam.trim() : how.name
    return [{ id: `nl-waterboards:${layer}:${id}`, kind: how.kind, name, at: round6(at), source: { source: 'nl-waterboards' as const, sourceId: id, fetchedAt } }]
  })
}
