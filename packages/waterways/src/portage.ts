// OpenPortage: paddlers' own portage details (docs/features/river-planner.md,
// "Contributions"). Released under CC0 when saved, live at once, flag-and-hide.
//
// A contribution stores the two landings (where you get out and back in) as
// points, not "left bank": which is the take-out, and which bank it's on,
// depends on which way you're paddling, so a route works it out for itself.
import { haversine } from '@paddlesnitch/timing/geo'
import { cumulative, project } from './line'
import { sideOf } from './along'
import type { Feature, LatLng, OsmElement } from './types'

export type PortageContribution = {
  id: string
  userId: string
  name: string                   // the contributor's display name when saved
  featureId?: string             // the lock or weir it's at
  at: LatLng                     // that feature's position, to find it again if its id changes
  landings: [LatLng, LatLng]     // either order
  notes?: string
  rollers?: boolean
  licence: 'CC0-1.0' | 'ODbL-1.0'   // ODbL: a portage path mapped in OpenStreetMap (osmPortages), never stored or in the CC0 dump
  createdAt: string
  updatedAt: string
  hidden?: boolean               // hidden by an admin, or by FLAGS_TO_HIDE flags
}

/** What anyone may see of one: no user id. */
export type PublicPortage = Omit<PortageContribution, 'userId'>

export const MAX_NOTES = 500
/** A contribution this far from a feature isn't about it. */
export const PORTAGE_MATCH_M = 80
/** Landings further apart than this aren't a portage (a mis-click). */
export const MAX_CARRY_M = 1500
/** Distinct people flagging one hides it until an admin looks. */
export const FLAGS_TO_HIDE = 3

export const toPublic = ({ userId: _, ...rest }: PortageContribution): PublicPortage => rest

/** The visible contributions about a feature: by id, or (when ids change) by place. */
export function portagesAt(feature: Feature, all: PublicPortage[]): PublicPortage[] {
  return all.filter(c => !c.hidden && (c.featureId === feature.id || haversine(c.at, feature.at) <= reachOf(c)))
}

/** A mapped carry around a lock flight (Fort Augustus, Neptune's Staircase)
 *  is about every lock in it: anything within half its length of its middle. */
const reachOf = (c: PublicPortage) =>
  c.licence === 'ODbL-1.0' ? Math.max(PORTAGE_MATCH_M, haversine(c.landings[0], c.landings[1]) / 2) : PORTAGE_MATCH_M

/** Shorter mapped portage pieces are steps down to a landing stage, not a carry. */
export const MIN_OSM_CARRY_M = 40

export type PortageOnRoute = {
  id: string
  by: string
  osm?: true                     // from OpenStreetMap, not a paddler here: no flag or delete
  takeOut: { at: LatLng; bank: 'left' | 'right' }
  putIn: { at: LatLng; bank: 'left' | 'right' }
  carryM: number
  notes?: string
  rollers?: boolean
}

/** A contribution as met along a route: the landing reached first is the
 *  take-out; banks are looking the way the route goes. */
export function portageOnRoute(line: LatLng[], c: PublicPortage, cum = cumulative(line)): PortageOnRoute {
  const [a, b] = c.landings.map(p => ({ at: p, along: project(line, p, cum).along }))
  const [first, second] = a.along <= b.along ? [a, b] : [b, a]
  return {
    id: c.id,
    by: c.name,
    takeOut: { at: first.at, bank: sideOf(line, cum, first.along, first.at) },
    putIn: { at: second.at, bank: sideOf(line, cum, second.along, second.at) },
    carryM: Math.round(haversine(first.at, second.at)),
    notes: c.notes,
    rollers: c.rollers,
    ...(c.licence === 'ODbL-1.0' ? { osm: true as const } : {}),
  }
}

/** Portage paths mapped in OpenStreetMap (ways tagged portage=*), as landings
 *  at either end: they fill in which bank to land on where no paddler has yet.
 *  One portage is often several ways (steps, a path, more steps), so ways that
 *  meet end to end are joined and the outermost ends are the landings. ODbL:
 *  they live in the published OSM layer (osm-portages.json), are shown credited
 *  to OpenStreetMap and never join the CC0 dump. */
export function osmPortages(elements: OsmElement[]): PublicPortage[] {
  const ways = elements.filter(e => e.ends && !['no', 'private'].includes(e.tags.portage) && !['no', 'private'].includes(e.tags.access ?? ''))
  const key = (p: LatLng) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`
  const group = ways.map((_, i) => i)
  const root = (i: number): number => (group[i] === i ? i : (group[i] = root(group[i])))
  const byEnd = new Map<string, number>()
  ways.forEach((w, i) => w.ends!.forEach(p => {
    const j = byEnd.get(key(p))
    if (j === undefined) byEnd.set(key(p), i); else group[root(i)] = root(j)
  }))
  const parts = new Map<number, OsmElement[]>()
  ways.forEach((w, i) => parts.set(root(i), [...(parts.get(root(i)) ?? []), w]))
  return [...parts.values()].flatMap(ws => {
    // Outer ends meet no other way; with a branch, the two furthest apart.
    const seen = new Map<string, { p: LatLng; n: number }>()
    for (const w of ws) for (const p of w.ends!) { const e = seen.get(key(p)); if (e) e.n++; else seen.set(key(p), { p, n: 1 }) }
    const outer = [...seen.values()].filter(e => e.n === 1).map(e => e.p)
    let best: [LatLng, LatLng] | null = null, far = 0
    for (let i = 0; i < outer.length; i++) for (let j = i + 1; j < outer.length; j++) {
      const d = haversine(outer[i], outer[j])
      if (d > far) { far = d; best = [outer[i], outer[j]] }
    }
    if (!best || far < MIN_OSM_CARRY_M || far > MAX_CARRY_M) return []
    const id = ws.map(w => w.id).sort((a, b) => Number(a.split('/')[1]) - Number(b.split('/')[1]))[0]
    const at: LatLng = [(best[0][0] + best[1][0]) / 2, (best[0][1] + best[1][1]) / 2]
    return [{ id: `osm:${id}`, name: 'OpenStreetMap', at, landings: best, licence: 'ODbL-1.0' as const, createdAt: '', updatedAt: '' }]
  })
}
