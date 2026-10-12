// The planner's places search: towns and villages on the water, and every lock
// and weir by name. Built from OSM place nodes (ODbL, so it belongs to the OSM
// layer) and our own features; searched in the browser as you type.
import { snap } from './network'
import type { Feature, LatLng, NetLink } from './types'

export type PlaceKind = 'city' | 'town' | 'village' | 'hamlet' | 'lock' | 'weir'
export type Place = { name: string; kind: PlaceKind; at: LatLng }

/** A town further than this from any river or canal isn't a place to paddle from. */
export const PLACE_NEAR_M = 2000

const KIND_RANK: Record<PlaceKind, number> = { city: 0, town: 1, lock: 2, village: 3, weir: 4, hamlet: 5 }

type OsmPlace = { at: LatLng; tags: Record<string, string> }

export function buildPlaces(osmPlaces: OsmPlace[], features: Feature[], links: NetLink[]): Place[] {
  const out: Place[] = []
  for (const p of osmPlaces) {
    const kind = p.tags.place as PlaceKind
    if (!(kind in KIND_RANK) || !p.tags.name || !snap(links, p.at, PLACE_NEAR_M)) continue
    out.push({ name: p.tags.name, kind, at: p.at })
  }
  for (const f of features) {
    if ((f.kind === 'lock' || f.kind === 'weir') && f.name) out.push({ name: f.name, kind: f.kind, at: f.at })
  }
  return out
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Places matching what's typed: whole-name prefixes first, then a word in the
 *  name, then bigger places, then nearer to `near` (where the map is looking). */
export function searchPlaces(places: Place[], query: string, near?: LatLng, limit = 8): Place[] {
  const q = fold(query)
  if (!q) return []
  const scored: { p: Place; score: number }[] = []
  for (const p of places) {
    const name = fold(p.name)
    const hit = name.startsWith(q) ? 0 : name.split(' ').some(w => w.startsWith(q)) || name.includes(` ${q}`) ? 1 : -1
    if (hit < 0) continue
    const d = near ? Math.hypot(p.at[0] - near[0], (p.at[1] - near[1]) * Math.cos((near[0] * Math.PI) / 180)) : 0
    scored.push({ p, score: hit * 1000 + KIND_RANK[p.kind] * 100 + Math.min(d, 9.99) * 10 })
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, limit).map(s => s.p)
}
