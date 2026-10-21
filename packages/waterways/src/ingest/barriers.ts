// Weirs and other barriers from the national inventories built for fish
// passage, read for what a paddler meets on the water:
//   - SEPA "Obstacles to Fish Passage" (Scotland, OGL): weirs, dams and
//     sluices, and natural waterfalls (as hazards);
//   - AMBER-GB barrier atlas (Great Britain, CC BY 4.0, cite Jones et al. 2019):
//     weirs, sluices and dams with a height where one was measured;
//   - Inland Fisheries Ireland's National Barriers Programme (Republic of
//     Ireland, CC BY 4.0): weirs, sluices, dams and rock waterfalls;
//   - ROE, France's register of river obstacles (OFB/Sandre, Licence Ouverte
//     2.0): dams and weirs, with the drop and any canoe pass.
// Both put points on the watercourse itself (see ON_WATER_SOURCES in along.ts).
import { round6 } from '../line'
import type { Feature } from '../types'

export const SEPA_OBSTACLES = 'https://map.sepa.org.uk/server/rest/services/Open/Hydrography/MapServer/5'
export const AMBER_GB = 'https://services3.arcgis.com/Bb8lfThdhugyc4G3/ArcGIS/rest/services/AMBER_Barrier_Atlas_GB/FeatureServer/3'
/** The pan-European AMBER atlas (Belletti et al. 2020, CC BY 4.0 on figshare,
 *  doi:10.6084/m9.figshare.12629051.v5), read for Belgium only: Britain has its
 *  own AMBER-GB layer above, and the Netherlands its water boards. */
export const AMBER_EU = 'https://services9.arcgis.com/OV5QimbIezDDb8bd/arcgis/rest/services/AMBERbarrieratlas/FeatureServer/0'
export const AMBER_EU_WHERE = "Country='BELGIUM' AND LabelAtlas IN ('WEIR','DAM','SLUICE','RAMP/BED SILL')"
export const IFI_BARRIERS = 'https://services-eu1.arcgis.com/tnPmSZbB6GEKJjh8/arcgis/rest/services/NBP_Copy_view/FeatureServer/0'
/** Only what a paddler meets: most of IFI's 42,000 records are culverts. */
export const IFI_WHERE = "BarrType IN ('Weir','Sluice','Dam','Rock/Bedrock Waterfall')"

/** One page of an ArcGIS layer as GeoJSON in WGS84 (2,000 records a page). */
export function arcgisPageUrl(layer: string, offset = 0, where = '1=1'): string {
  const q = new URLSearchParams({ where, outFields: '*', outSR: '4326', resultOffset: String(offset), f: 'geojson' })
  return `${layer}/query?${q}`
}

/** ROE, mainland France (Sandre WFS). 119,000 records, 10,000 a page. */
export const ROE_WFS = 'https://services.sandre.eaufrance.fr/geo/obs'
export const ROE_PAGE = 10000
const ROE_FIELDS = ['CdObstEcoul', 'LbEtOuvrage', 'NomPrincipalObstEcoul', 'CdTypeOuvrage', 'HautChutEtObstEcoul',
  'LbTypeDispFranchNavig1', 'LbTypeDispFranchNavig2', 'LbTypeDispFranchNavig3', 'msGeometry']

/** One page of ROE as GeoJSON in WGS84, sorted so pages don't overlap. */
export function roePageUrl(start: number): string {
  const q = new URLSearchParams({ SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature', TYPENAMES: 'ObstEcoul_FXX',
    COUNT: String(ROE_PAGE), STARTINDEX: String(start), SORTBY: 'gid', SRSNAME: 'EPSG:4326',
    PROPERTYNAME: ROE_FIELDS.join(','), OUTPUTFORMAT: 'application/json; subtype=geojson' })
  return `${ROE_WFS}?${q}`
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
      // 1,130 Scottish records carry the literal string "Null".
      name: typeof p.barrier_name === 'string' && p.barrier_name.trim() && !/^null$/i.test(p.barrier_name.trim()) ? p.barrier_name.trim() : undefined,
      at: round6([lat, lng]),
      source: { source: 'amber', sourceId: id, fetchedAt },
      ...(height > 0 ? { weir: { heightM: height } } : {}),
    })
  }
  return out
}

/** AMBER Europe: weirs, dams, sluices and bed sills as weirs, with a height where measured. */
export function featuresFromAmberEu(features: Point[], fetchedAt: string): Feature[] {
  const out: Feature[] = []
  for (const f of features) {
    if (f.geometry?.type !== 'Point') continue
    const p = f.properties
    if (!['WEIR', 'DAM', 'SLUICE', 'RAMP/BED SILL'].includes(String(p.LabelAtlas))) continue
    const [lng, lat] = f.geometry.coordinates
    const id = String(p.OBJECTID)
    const height = Math.round(Number(p.Height) * 10) / 10   // "NA" reads as unknown
    out.push({
      id: `amber-eu:${id}`,
      kind: 'weir',
      at: round6([lat, lng]),
      source: { source: 'amber-eu', sourceId: id, fetchedAt },
      ...(height > 0 ? { weir: { heightM: height } } : {}),
    })
  }
  return out
}

/** Gone or not built yet: nothing in the water. A partly demolished weir stays. */
const ROE_ABSENT = new Set(['Détruit entièrement', 'En projet', 'En construction'])
/** Names made only of these words say what it is, not which one ("Seuil en rivière", "Barrage", "Inconnu"). */
const ROE_GENERIC = new Set(['seuil', 'seuils', 'en', 'rivière', 'riviere', 'barrage', 'barage', 'radier', 'déversoir', 'deversoir',
  'rtm', 'inconnu', 'etang', 'étang', 'plan', "d'eau", 'enrochement', 'enrochements', 'sans', 'nom'])

/** ROE: dams (type 1.1) and weirs (1.2) as weirs. Culverts and bridge aprons
 *  (1.4), dykes along the bank (1.3), groynes and fish-farm grilles are left out. */
export function featuresFromRoe(features: Point[], fetchedAt: string): Feature[] {
  const out: Feature[] = []
  for (const f of features) {
    if (f.geometry?.type !== 'Point') continue
    const p = f.properties
    const type = String(p.CdTypeOuvrage ?? '')
    if (!/^1\.[12](\.|$)/.test(type) || ROE_ABSENT.has(String(p.LbEtOuvrage))) continue
    const [lng, lat] = f.geometry.coordinates
    const id = String(p.CdObstEcoul)
    const name = String(p.NomPrincipalObstEcoul ?? '').trim()
    const generic = name.toLowerCase().split(/\s+/).every(w => ROE_GENERIC.has(w))
    const height = Math.round(Number(p.HautChutEtObstEcoul) * 10) / 10   // the drop; '' and 0 read as unknown
    const canoePass = [1, 2, 3].some(k => p[`LbTypeDispFranchNavig${k}`] === 'Passe à canoë')
    const weir = { ...(height > 0 ? { heightM: height } : {}), ...(canoePass ? { canoePass } : {}) }
    out.push({
      id: `roe:${id}`,
      kind: 'weir',
      name: generic ? undefined : name,
      at: round6([lat, lng]),
      source: { source: 'roe', sourceId: id, fetchedAt },
      ...(Object.keys(weir).length ? { weir } : {}),
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
