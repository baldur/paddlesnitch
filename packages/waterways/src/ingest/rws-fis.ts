// Rijkswaterstaat's Fairway Information Services (FIS/VNDS, the Netherlands,
// CC0): every lock on the Dutch fairway network, whoever runs it, and the
// trailer slipways. See docs/features/waterways-netherlands.md.
//
// The locks are the lock *outlines* (WFS sluis_v, "FIS_VNDS - Lock - vlakken"
// in the national register). The map service's point layer of locks is mostly
// German and Belgian (EuRIS) and lacks Weurt, the Oranjesluizen and IJmuiden.
import { round6 } from '../line'
import type { Feature, LatLng } from '../types'

const FIS = 'https://geo.rijkswaterstaat.nl/arcgis/rest/services/GDR/fis_vnds/MapServer'
export const FIS_LOCKS = 'https://geo.rijkswaterstaat.nl/services/ogc/gdr/fis_vnds/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=fis_vnds:sluis_v&outputFormat=application/json&srsName=EPSG:4326&count=5000'
export const FIS_SLIPWAYS = `${FIS}/22`

type Point = {
  geometry: { type: 'Point'; coordinates: [number, number] } | null
  properties: Record<string, string | number | null>
}

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

function features(list: Point[], kind: 'lock' | 'slipway', fetchedAt: string): Feature[] {
  return list.flatMap(f => {
    if (f.geometry?.type !== 'Point') return []
    const [lng, lat] = f.geometry.coordinates
    const id = String(f.properties.id ?? f.properties.objectid)
    return [{ id: `rws-fis:${kind}:${id}`, kind, name: text(f.properties.name), at: round6([lat, lng]), source: { source: 'rws-fis' as const, sourceId: id, fetchedAt } }]
  })
}

type Area = {
  geometry: { type: 'Polygon'; coordinates: [number, number][][] } | { type: 'MultiPolygon'; coordinates: [number, number][][][] } | null
  properties: Record<string, string | number | null>
}

/** A lock outline's middle (the mean of its outer ring), as a point. */
const middle = (g: NonNullable<Area['geometry']>): LatLng => {
  const ring = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0]
  return [ring.reduce((n, p) => n + p[1], 0) / ring.length, ring.reduce((n, p) => n + p[0], 0) / ring.length]
}

export const featuresFromFisLocks = (list: Area[], fetchedAt: string): Feature[] => list.flatMap(f => {
  if (!f.geometry) return []
  const id = String(f.properties.id)
  return [{ id: `rws-fis:lock:${id}`, kind: 'lock' as const, name: text(f.properties.name), at: round6(middle(f.geometry)), source: { source: 'rws-fis' as const, sourceId: id, fetchedAt } }]
})
export const featuresFromFisSlipways = (list: Point[], fetchedAt: string) => features(list, 'slipway', fetchedAt)
