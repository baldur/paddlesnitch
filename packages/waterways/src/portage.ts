// OpenPortage: paddlers' own portage details (docs/features/river-planner.md,
// "Contributions"). Released under CC0 when saved, live at once, flag-and-hide.
//
// A contribution stores the two landings (where you get out and back in) as
// points, not "left bank": which is the take-out, and which bank it's on,
// depends on which way you're paddling, so a route works it out for itself.
import { haversine } from '@paddlesnitch/timing/geo'
import { cumulative, project } from './line'
import { sideOf } from './along'
import type { Feature, LatLng } from './types'

export type PortageContribution = {
  id: string
  userId: string
  name: string                   // the contributor's display name when saved
  featureId?: string             // the lock or weir it's at
  at: LatLng                     // that feature's position, to find it again if its id changes
  landings: [LatLng, LatLng]     // either order
  notes?: string
  rollers?: boolean
  licence: 'CC0-1.0'
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
  return all.filter(c => !c.hidden && (c.featureId === feature.id || haversine(c.at, feature.at) <= PORTAGE_MATCH_M))
}

export type PortageOnRoute = {
  id: string
  by: string
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
  }
}
