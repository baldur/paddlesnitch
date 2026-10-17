// Weirs and other barriers from the national inventories built for fish
// passage, read for what a paddler meets on the water:
//   - SEPA "Obstacles to Fish Passage" (Scotland, OGL): weirs, dams and
//     sluices, and natural waterfalls (as hazards);
//   - AMBER-GB barrier atlas (Great Britain, CC BY 4.0, cite Jones et al. 2019):
//     weirs, sluices and dams with a height where one was measured;
//   - Inland Fisheries Ireland's National Barriers Programme (Republic of
//     Ireland, CC BY 4.0): weirs, sluices, dams and rock waterfalls.
// Both put points on the watercourse itself (see ON_WATER_SOURCES in along.ts).
import { round6 } from '../line'
import type { Feature } from '../types'

export const SEPA_OBSTACLES = 'https://map.sepa.org.uk/server/rest/services/Open/Hydrography/MapServer/5'
export const AMBER_GB = 'https://services3.arcgis.com/Bb8lfThdhugyc4G3/ArcGIS/rest/services/AMBER_Barrier_Atlas_GB/FeatureServer/3'
export const IFI_BARRIERS = 'https://services-eu1.arcgis.com/tnPmSZbB6GEKJjh8/arcgis/rest/services/NBP_Copy_view/FeatureServer/0'
/** Only what a paddler meets: most of IFI's 42,000 records are culverts. */
export const IFI_WHERE = "BarrType IN ('Weir','Sluice','Dam','Rock/Bedrock Waterfall')"

/** One page of an ArcGIS layer as GeoJSON in WGS84 (2,000 records a page). */
export function arcgisPageUrl(layer: string, offset = 0, where = '1=1'): string {
  const q = new URLSearchParams({ where, outFields: '*', outSR: '4326', resultOffset: String(offset), f: 'geojson' })
  return `${layer}/query?${q}`
}

type Point = {
  geometry: { type: 'Point'; coordinates: [number, number] } | null
  properties: Record<string, string | number | null>
}

const STRUCTURE = new Set(['weir', 'dam', 'sluice', 'artificial cascade', 'water gate'])

export function featuresFromSepa(features: Point[], fetchedAt: string): Feature[] {
  const out: Feature[] = []
  for (const f of features) {
    if (f.geometry?.type !== 'Point') continue
    const type = String(f.properties.barrier_type ?? '').toLowerCase()
    const waterfall = type === 'waterfall'
    if (!waterfall && !STRUCTURE.has(type)) continue
    const [lng, lat] = f.geometry.coordinates
    const id = String(f.properties.id ?? f.properties.objectid)
    out.push({
      id: `sepa:${id}`,
      kind: waterfall ? 'hazard' : 'weir',
      name: waterfall ? 'Waterfall' : undefined,
      at: round6([lat, lng]),
      source: { source: 'sepa', sourceId: id, fetchedAt },
    })
  }
  return out
}

export function featuresFromAmber(features: Point[], fetchedAt: string): Feature[] {
  const out: Feature[] = []
  for (const f of features) {
    if (f.geometry?.type !== 'Point') continue
    const p = f.properties
    if (!['weir', 'sluice', 'dam'].includes(String(p.barrier_type))) continue
    const [lng, lat] = f.geometry.coordinates
    const id = String(p.barrier_id)
    const height = Math.round(Number(p.height_m) * 10) / 10   // to 10 cm; a few mm reads as unknown
    out.push({
      id: `amber:${id}`,
      kind: 'weir',
      name: typeof p.barrier_name === 'string' && p.barrier_name.trim() ? p.barrier_name.trim() : undefined,
      at: round6([lat, lng]),
      source: { source: 'amber', sourceId: id, fetchedAt },
      ...(height > 0 ? { weir: { heightM: height } } : {}),
    })
  }
  return out
}

export function featuresFromIfi(features: Point[], fetchedAt: string): Feature[] {
  const out: Feature[] = []
  for (const f of features) {
    if (f.geometry?.type !== 'Point') continue
    const type = String(f.properties.BarrType ?? '')
    const waterfall = /waterfall/i.test(type)
    if (!waterfall && !['Weir', 'Sluice', 'Dam'].includes(type)) continue
    const [lng, lat] = f.geometry.coordinates
    const id = String(f.properties.GlobalID ?? f.properties.OBJECTID_1)
    out.push({
      id: `ifi:${id}`,
      kind: waterfall ? 'hazard' : 'weir',
      name: waterfall ? 'Waterfall' : undefined,
      at: round6([lat, lng]),
      source: { source: 'ifi', sourceId: id, fetchedAt },
    })
  }
  return out
}
