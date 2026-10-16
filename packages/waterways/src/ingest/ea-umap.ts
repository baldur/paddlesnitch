// The Environment Agency's uMap maps for the Anglian rivers, linked from their
// GOV.UK "Information for boaters" pages. No licence is set on them, so they
// are used with credit (owner decision 2026-10-11). Two kinds:
//   - "The River Nene": every lock by name, water points, Elsan, slipways and
//     weir warnings — the only EA river outside the Thames with lock positions;
//   - "Navigation Notices" (Nene, Great Ouse, Stour, Welland & Glen, Ancholme):
//     current closures and hazards, such as a closed canoe portage. These come
//     and go; the weekly refresh keeps them current.
import { round6 } from '../line'
import type { Facility, Feature, FeatureKind } from '../types'

export const EA_UMAPS = {
  nene: 1189581,
  'notices-nene': 1223606,
  'notices-great-ouse': 1189638,
  'notices-stour': 1228164,
  'notices-welland-glen': 1228191,
  'notices-ancholme': 1228188,
} as const

export type EaUmap = keyof typeof EA_UMAPS

export const umapUrl = (map: number) => `https://umap.openstreetmap.fr/en/map/${map}/geojson/`
export const umapLayerUrl = (map: number, layer: string) => `https://umap.openstreetmap.fr/en/datalayer/${map}/${layer}/`
export const umapPage = (map: number) => `https://umap.openstreetmap.fr/en/map/${map}`

type UmapLayer = {
  _umap_options?: { name?: string | null }
  features: { geometry: { type: string; coordinates: [number, number] } | null; properties?: { name?: string; description?: string } }[]
}

/** The map's own description of its layers: their ids. */
export const umapLayerIds = (map: { properties?: { datalayers?: { id: string }[] } }) => (map.properties?.datalayers ?? []).map(d => d.id)

/** What a Nene layer holds, by its name; the unnamed one is the locks. */
function neneKind(layer: string | null | undefined, name: string): { kind: FeatureKind; facilities?: Facility[] } | null {
  if (!layer) return /\block\b/i.test(name) ? { kind: 'lock' } : null
  if (layer === 'Water Points') return { kind: 'facility', facilities: ['drinking_water'] }
  if (layer === 'Sanitation') return { kind: 'facility', facilities: /elsan/i.test(name) ? ['elsan'] : ['toilet'] }
  if (layer === 'Slipway') return { kind: 'slipway' }
  if (layer === 'Warnings') return { kind: 'hazard' }
  return null
}

export function featuresFromUmap(map: EaUmap, layers: UmapLayer[], fetchedAt: string): Feature[] {
  const notices = map.startsWith('notices-')
  const out: Feature[] = []
  for (const layer of layers) {
    const layerName = layer._umap_options?.name
    layer.features.forEach((f, i) => {
      if (f.geometry?.type !== 'Point') return
      const name = (f.properties?.name ?? '').trim()
      if (!name || /^(head|end) of ea navigation/i.test(name)) return
      const what = notices ? { kind: 'hazard' as const } : neneKind(layerName, name)
      if (!what) return
      const [lng, lat] = f.geometry.coordinates
      const id = `${map}:${layerName ?? 'locks'}:${i}`
      out.push({
        id: `ea-umap:${id}`,
        kind: what.kind,
        // Lock names carry the headroom ("Ashton Lock 2.6m"): keep the name only.
        name: notices ? `Notice: ${name}` : what.kind === 'lock' ? name.replace(/\s+\d+(\.\d+)?m$/, '') : name,
        at: round6([lat, lng]),
        source: { source: 'ea-umap', sourceId: id, url: umapPage(EA_UMAPS[map]), fetchedAt },
        ...(what.facilities ? { facilities: what.facilities } : {}),
      })
    })
  }
  return out
}
