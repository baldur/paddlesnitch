// Environment Agency asset register (AIMS Structure, OGL, updated daily): the
// EA's own weirs and slipways across England. It has navigation lock gates
// too, but too few to stand in for a lock list (125 locks, mostly Thames),
// so locks come from the navigation pages, the uMap maps and OSM instead.
// See docs/features/waterways-uk-ireland-sources.md.
import { round6 } from '../line'
import type { Feature, FeatureKind, LatLng } from '../types'

export const AIMS_URL = 'https://environment.data.gov.uk/api/file/download?fileDataSetId=5e1a2961-b383-4f8f-9ce3-94e122136e41&fileName=AIMS_Structure.geojson.zip'
export const AIMS_FILES = { points: 'AIMS_Structure_Point.geojson', lines: 'AIMS_Structure_Line.geojson' } as const

type AimsFeature = {
  geometry: { type: 'Point'; coordinates: [number, number] } | { type: 'MultiLineString' | 'LineString'; coordinates: unknown } | null
  properties: Record<string, string | number | null>
}

const KIND: Record<string, FeatureKind> = { Weir: 'weir', Slipway: 'slipway' }

/** A point, or the middle vertex of a line (a weir is drawn across the river). */
function placeOf(g: NonNullable<AimsFeature['geometry']>): LatLng | null {
  if (g.type === 'Point') return [g.coordinates[1], g.coordinates[0]]
  const flat = (g.type === 'MultiLineString' ? (g.coordinates as number[][][]).flat() : (g.coordinates as number[][]))
  const mid = flat[Math.floor(flat.length / 2)]
  return mid ? [mid[1], mid[0]] : null
}

export function featuresFromAims(features: AimsFeature[], fetchedAt: string): Feature[] {
  const out: Feature[] = []
  for (const f of features) {
    const kind = KIND[String(f.properties.asset_sub_type)]
    if (!kind || !f.geometry) continue
    const at = placeOf(f.geometry)
    if (!at) continue
    const id = String(f.properties.asset_id)
    const name = String(f.properties.asset_name ?? '')
    out.push({
      id: `ea-aims:${kind}:${id}`,
      kind,
      name: name && name !== 'Not Available' ? name : undefined,
      at: round6(at),
      source: { source: 'ea-aims', sourceId: id, fetchedAt },
    })
  }
  return out
}
