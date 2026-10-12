// Waterways Ireland's public ArcGIS layers: every navigation on the island,
// north and south (Shannon, Shannon–Erne, Erne, Grand, Royal, Barrow, Lower
// Bann, Ulster Canal). Licensed for NON-COMMERCIAL use with acknowledgement:
// used while paddlesnitch is free (owner, 2026-10-12), tagged so it can be
// dropped in one place, and never fed into the CC0 contribution layer.
import { round6 } from '../line'
import type { Facility, Feature, FeatureKind } from '../types'

const BASE = 'https://services.arcgis.com/dYoxQ9gPdVpFX6Th/arcgis/rest/services'

export const WI_LAYERS = {
  infrastructure: 'Point_Asset_Inventory_Public_View/FeatureServer/0',
  access: 'Recreational_Access_Points_(Public_View)/FeatureServer/0',
  facilities: 'Facilities_(Public_View)/FeatureServer/1',
  warnings: 'Warnings_and_Notices_(public_View)/FeatureServer/0',
} as const

export type WiLayer = keyof typeof WI_LAYERS

/** One page of a layer as GeoJSON in WGS84 (2,000 records a page at most). */
export function wiQueryUrl(layer: WiLayer, offset = 0): string {
  const q = new URLSearchParams({ where: '1=1', outFields: '*', outSR: '4326', resultOffset: String(offset), f: 'geojson' })
  return `${BASE}/${WI_LAYERS[layer]}/query?${q}`
}

type GeoJsonPoint = {
  geometry: { type: 'Point'; coordinates: [number, number] } | null
  properties: Record<string, string | number | null>
}

const LOCK_TYPES = new Set(['Canal Lock', 'River Lock', 'Sea Lock'])
const ACCESS_KIND: Record<string, FeatureKind> = {
  'Put-In/Take-Out Point': 'access',
  'Canoe Launching Point': 'access',
  'Canoe Slip': 'slipway',
  'Access Point': 'access',
  Carry: 'portage',
  Parking: 'crew_point',
}
const FACILITY: Record<string, Facility> = {
  Toilets: 'toilet', Showers: 'shower', 'Water Bollard': 'drinking_water', 'Pump-out': 'pump_out',
}

const text = (v: unknown) => (typeof v === 'string' ? v.replace(/<br>/g, '; ').trim() : '')

export function featuresFromWi(layer: WiLayer, features: GeoJsonPoint[], fetchedAt: string): Feature[] {
  const out: Feature[] = []
  for (const f of features) {
    if (f.geometry?.type !== 'Point') continue
    const p = f.properties
    const [lng, lat] = f.geometry.coordinates
    const id = String(p.GlobalID ?? p.OBJECTID)
    const base = { at: round6([lat, lng]), source: { source: 'waterways-ireland' as const, sourceId: id, fetchedAt } }
    if (layer === 'infrastructure') {
      // A lock's waiting jetties are listed as components of it (L2_COMPONENT
      // 'Waiting Jetty'), up to four per lock: keep the lock itself only.
      if (!LOCK_TYPES.has(String(p.ASSET_TYPE)) || p.Status === 'Inactive' || (p.L2_COMPONENT && p.L2_COMPONENT !== 'NA')) continue
      out.push({ id: `wi:lock:${id}`, kind: 'lock', name: text(p.L1_ASSET_NAME) || undefined, ...base })
    } else if (layer === 'access') {
      const kind = ACCESS_KIND[String(p.AccessPointType)]
      if (!kind) continue
      const details = text(p.Details)
      const feature: Feature = { id: `wi:access:${id}`, kind, name: text(p.Name) || undefined, ...base }
      if (kind === 'portage' && details) feature.portage = { notes: details }
      else if (details) feature.crew = { directions: details }
      out.push(feature)
    } else if (layer === 'facilities') {
      const fac = FACILITY[String(p.Type)]
      if (!fac) continue
      out.push({ id: `wi:facility:${id}`, kind: 'facility', name: text(p.Name) || undefined, facilities: [fac], ...base })
    } else {
      const description = text(p.Description)
      out.push({ id: `wi:warning:${id}`, kind: 'hazard', name: description || text(p.Name) || 'Caution', ...base })
    }
  }
  return out
}
