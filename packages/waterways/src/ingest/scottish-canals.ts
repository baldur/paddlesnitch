// Scottish Canals open data (OGL v3): locks, weirs and mooring points on the
// Caledonian, Crinan, Forth & Clyde, Union and Monkland canals, published as
// zipped shapefiles in British National Grid. The attribute tables carry
// eastings and northings, so only the .dbf is read.
// See docs/features/waterways-uk-ireland-sources.md.
import { round6 } from '../line'
import { enToLatLng } from '../osgb'
import type { Feature, FeatureKind } from '../types'

const BASE = 'https://d1hxd0sho1wxko.cloudfront.net/production/general'

export const SCOTTISH_CANALS_LAYERS = {
  locks: { url: `${BASE}/scottish_canals_locks.zip`, dbf: 'scottish_canals_locks.dbf' },
  weirs: { url: `${BASE}/weirs.zip`, dbf: 'weirs.dbf' },
  moorings: { url: `${BASE}/mooring_points.zip`, dbf: 'mooring_points.dbf' },
} as const

export type ScottishCanalsLayer = keyof typeof SCOTTISH_CANALS_LAYERS

/** Mooring points a paddler can get on or off at. Pontoons and moorings are
 *  for boats; the canal's own canoe landings, slipways and landing stages are not. */
const ACCESS_TYPES = new Set(['Canoe Landing', 'Landing', 'Slipway'])

export function featuresFromScottishCanals(layer: ScottishCanalsLayer, rows: Record<string, string>[], fetchedAt: string): Feature[] {
  const out: Feature[] = []
  for (const r of rows) {
    const e = Number(r['location e']), n = Number(r['location n'])
    if (!Number.isFinite(e) || !Number.isFinite(n) || !e || !n) continue
    const sub = r['sub type'] ?? ''
    let kind: FeatureKind
    if (layer === 'locks') kind = 'lock'
    else if (layer === 'weirs') kind = 'weir'
    else if (ACCESS_TYPES.has(sub)) kind = sub === 'Slipway' ? 'slipway' : 'access'
    else continue
    const id = r.reference || r.ogc_fid
    out.push({
      id: `scottish-canals:${layer}:${id}`,
      kind,
      name: r.name || undefined,
      at: round6(enToLatLng(e, n)),
      source: { source: 'scottish-canals', sourceId: id, fetchedAt },
    })
  }
  return out
}
