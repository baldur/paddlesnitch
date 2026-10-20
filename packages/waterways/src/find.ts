// Ends of a plan by name, not only by a click (#506, #508): "Cropredy Lock",
// "Castle Quay", "Banbury". Searches the places index plus named wharves,
// slipways and portages, and puts each hit on the water, naming the waterway.
// A town by two waterways gives one hit per waterway, so you can say which.
import { snap, snapChoices } from './network'
import { searchPlaces, type Place, type PlaceKind } from './places'
import type { Feature, LatLng, NetLink } from './types'

export type Found = { name: string; kind: PlaceKind; at: LatLng; waterway: string }

type Searchable = { links: NetLink[]; features: Feature[]; places: Place[] }

/** A lock or wharf further than this from the water isn't on it. */
const ON_WATER_M = 300
/** A town's waterways: the named ones this near its centre (at most two). */
const TOWN_WATER_M = 1500

const FEATURE_KIND: Partial<Record<Feature['kind'], PlaceKind>> = { access: 'wharf', slipway: 'slipway', portage: 'portage' }
const TOWN: ReadonlySet<PlaceKind> = new Set(['city', 'town', 'village', 'hamlet'])

// The places index plus the named features it leaves out, built once per dataset.
const indexes = new WeakMap<Feature[], Place[]>()
function placesOf(ds: Searchable): Place[] {
  let all = indexes.get(ds.features)
  if (!all) {
    all = [...ds.places]
    for (const f of ds.features) {
      const kind = FEATURE_KIND[f.kind]
      if (kind && f.name) all.push({ name: f.name, kind, at: f.at })
    }
    indexes.set(ds.features, all)
  }
  return all
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Places matching `q`, each on the water with its waterway's name; nearer to
 *  `near` first among equals. `waterway` keeps only hits on that waterway. */
export function findOnWater(ds: Searchable, q: string, opts: { near?: LatLng; waterway?: string; limit?: number } = {}): Found[] {
  // "Cropredy Lock, Oxford Canal": the part after the last comma can name the waterway.
  const comma = q.lastIndexOf(',')
  if (!opts.waterway && comma > 0) {
    const hits = findOnWater(ds, q.slice(0, comma), { ...opts, waterway: q.slice(comma + 1) })
    if (hits.length) return hits
  }
  const limit = opts.limit ?? 8
  const want = fold(opts.waterway ?? '')
  const out: Found[] = []
  for (const p of searchPlaces(placesOf(ds), q, opts.near, limit * 4)) {
    const spots = TOWN.has(p.kind)
      ? snapChoices(ds.links, p.at, TOWN_WATER_M).filter(s => s.link.name).slice(0, 2)
      : [snap(ds.links, p.at, ON_WATER_M)].filter(s => s != null)
    for (const s of spots) {
      if (want && !fold(s.link.name).includes(want)) continue
      if (out.some(o => o.name === p.name && o.waterway === s.link.name)) continue
      out.push({ name: p.name, kind: p.kind, at: s.at, waterway: s.link.name })
    }
    if (out.length >= limit) break
  }
  return out.slice(0, limit)
}

/** A point put onto the named waterway, if it runs within `maxM` of it. */
export function onWaterway(links: NetLink[], p: LatLng, waterway: string, maxM = 1000): LatLng | null {
  const want = fold(waterway)
  return snapChoices(links, p, maxM).find(s => fold(s.link.name).includes(want))?.at ?? null
}
