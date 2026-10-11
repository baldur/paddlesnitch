// Canal & River Trust open data (ArcGIS FeatureServers). Locks, weirs and
// slipways are OGL on the CRT hub; the facility and towpath-access layers are
// public services with no licence stated (used with credit — see "Data
// sources" in docs/features/river-planner.md). The CRT centrelines are NOT
// used: their licence forbids redistribution.
import { round6 } from '../line'
import type { Facility, Feature, FeatureKind } from '../types'

const BASE = 'https://services.arcgis.com/DknzyjEEie5tEW0u/arcgis/rest/services'

export const CRT_LAYERS = {
  locks: { service: 'Canal_And_River_Trust_Locks_View', kind: 'lock' },
  weirs: { service: 'Canal_And_River_Trust_Weirs_View', kind: 'weir' },
  slipways: { service: 'Canal_And_River_Trust_Slipways_View', kind: 'slipway' },
  wharves: { service: 'Canal_And_River_Trust_Wharves_View', kind: 'access' },
  facilities: { service: 'Customer_Service_Facilities_View_Public', kind: 'facility' },
  towpathAccess: { service: 'Towpath_Access_Points', kind: 'crew_point' },
} as const satisfies Record<string, { service: string; kind: FeatureKind }>

export type CrtLayer = keyof typeof CRT_LAYERS

/** One page of a layer inside a bbox, as GeoJSON in WGS84. ArcGIS caps a
 *  page at 2,000 records — page with `offset` while `exceededTransferLimit`. */
export function crtQueryUrl(layer: CrtLayer, [s, w, n, e]: [number, number, number, number], offset = 0): string {
  const q = new URLSearchParams({
    where: '1=1',
    geometry: `${w},${s},${e},${n}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    resultOffset: String(offset),
    f: 'geojson',
  })
  return `${BASE}/${CRT_LAYERS[layer].service}/FeatureServer/0/query?${q}`
}

type GeoJsonPoint = {
  geometry: { type: 'Point'; coordinates: [number, number] } | null
  properties: Record<string, string | number | null>
}

const FACILITY_FLAGS: [string, Facility][] = [
  ['TOILET', 'toilet'],
  ['SHOWER', 'shower'],
  ['WATER_POINT', 'drinking_water'],
  ['ELSAN_POINT', 'elsan'],
  ['REFUSE_DISPOSAL', 'refuse'],
  ['PUMP_OUT_USER_OPERATED', 'pump_out'],
  ['PUMP_OUT_STAFF_OPERATED', 'pump_out'],
]

export function featuresFromCrt(layer: CrtLayer, features: GeoJsonPoint[], fetchedAt: string): Feature[] {
  const { kind } = CRT_LAYERS[layer]
  const out: Feature[] = []
  for (const f of features) {
    if (f.geometry?.type !== 'Point') continue
    // The layers disagree on field-name case (sap_description vs SAP_DESCRIPTION).
    const p: Record<string, string> = {}
    for (const [k, v] of Object.entries(f.properties)) if (v != null) p[k.toUpperCase()] = String(v).trim()
    const id = p.SAP_FUNC_LOC || p.OBJECTID
    const [lng, lat] = f.geometry.coordinates
    const feature: Feature = {
      id: `crt:${layer}:${id}`,
      kind,
      name: p.SAP_DESCRIPTION || undefined,
      at: round6([lat, lng]),
      source: { source: 'crt', sourceId: id, fetchedAt },
    }
    if (layer === 'facilities') {
      feature.facilities = [...new Set(FACILITY_FLAGS.filter(([k]) => p[k] === 'Yes').map(([, v]) => v))]
      if (!feature.facilities.length) continue
    }
    if (layer === 'towpathAccess') {
      const how = [p.LEVEL_ACCESS && `${p.LEVEL_ACCESS.toLowerCase()} access`, p.ACCESS_WIDTH && `${p.ACCESS_WIDTH} m wide`]
        .filter(Boolean).join(', ')
      feature.name = p.COMMENTS ? `Towpath access: ${titleCase(p.COMMENTS)}` : 'Towpath access'
      if (how) feature.crew = { directions: `Towpath access point — ${how}.` }
    }
    out.push(feature)
  }
  return out
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
