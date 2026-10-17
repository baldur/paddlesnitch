// Coverage by waterway (docs/features/waterways-uk-ireland.md, "Being open
// about gaps"): for every navigation and sizeable river, what we know a
// paddler needs, computed from the data, never typed in. Drives the shaded
// map and /plan/gaps.
import { nearOf } from './along'
import { simplify } from './line'
import { snap } from './network'
import type { Feature, LatLng, NetLink } from './types'

/** Rivers shorter than this (named, not a navigation) aren't scored. */
export const MIN_RIVER_KM = 10
/** Nor canals and navigations shorter than this: an arm, a basin, a lock
 *  chamber with its own name where two waterways meet. */
export const MIN_NAVIGATION_KM = 1

export type CoverageLevel = 'good' | 'some' | 'thin'

export type WaterwayCoverage = {
  id: string                 // the first link's id: stable within a version
  name: string
  kind: 'canal' | 'navigation' | 'river'
  km: number
  at: LatLng                 // a point on it, for "show me"
  locks: number
  locksWithSide: number      // portage side known
  weirs: number
  access: number             // get in / out: access points, slipways, portages
  crew: number               // where a crew can reach the bank
  facilities: number
  sources: string[]
  level: CoverageLevel
}

/** A link shorter than this between two of one name doesn't split them. */
const BRIDGE_M = 600

/** Per 10 km of water, this many access points makes "good" possible. */
const GOOD_ACCESS_PER_10KM = 1

/** Group links into waterways (the same name, touching), assign each feature
 *  to the nearest one it's on, and score them. */
export function waterwayCoverage(links: NetLink[], features: Feature[], hasPortage: (f: Feature) => boolean = () => false): WaterwayCoverage[] {
  const groups = new Map<string, NetLink[]>()
  const groupOf = groupLinks(links)
  for (const l of links) {
    const r = groupOf.get(l.id)
    if (!r) continue
    const g = groups.get(r)
    if (g) g.push(l); else groups.set(r, [l])
  }

  const rows = new Map<string, WaterwayCoverage>()
  const linkGroup = new Map<string, string>()
  for (const [root, ls] of groups) {
    const km = ls.reduce((n, l) => n + l.lengthM, 0) / 1000
    // By most of its length: a river has lock cuts tagged canal.
    const share = (pred: (l: NetLink) => boolean) => ls.filter(pred).reduce((n, l) => n + l.lengthM, 0) / (km * 1000 || 1)
    const kind = share(l => l.form === 'canal') > 0.5 ? 'canal' : share(l => l.boat === 'yes') > 0.5 ? 'navigation' : 'river'
    if (km < (kind === 'river' ? MIN_RIVER_KM : MIN_NAVIGATION_KM)) continue
    const mid = ls[Math.floor(ls.length / 2)].line
    rows.set(root, {
      id: root, name: ls[0].name, kind, km: Math.round(km * 10) / 10, at: mid[Math.floor(mid.length / 2)],
      locks: 0, locksWithSide: 0, weirs: 0, access: 0, crew: 0, facilities: 0, sources: [], level: 'thin',
    })
    for (const l of ls) linkGroup.set(l.id, root)
  }

  // Snap features only to scored water: a lock sits on its chamber, which is
  // often a short link with a name of its own.
  const scored = links.filter(l => linkGroup.has(l.id))
  const sources = new Map<string, Set<string>>()
  for (const f of features) {
    const s = snap(scored, f.at, nearOf(f) + 100)
    const root = s && linkGroup.get(s.link.id)
    const row = root && rows.get(root)
    if (!row) continue
    if (f.kind === 'lock') { row.locks++; if (f.portage?.side || hasPortage(f)) row.locksWithSide++ }
    else if (f.kind === 'weir') row.weirs++
    else if (f.kind === 'access' || f.kind === 'slipway' || f.kind === 'portage') row.access++
    else if (f.kind === 'crew_point') row.crew++
    else if (f.kind === 'facility') row.facilities++
    let set = sources.get(row.id)
    if (!set) sources.set(row.id, (set = new Set()))
    set.add(f.source.source)
  }
  for (const row of rows.values()) {
    row.sources = [...(sources.get(row.id) ?? [])].sort()
    row.level = levelOf(row)
  }
  return [...rows.values()].sort((a, b) => b.km - a.km)
}

/** good: places to get in and out, a way for a crew to reach it, and every
 *  lock's portage side known. thin: nothing on it but the line. some: between. */
export function levelOf(r: Pick<WaterwayCoverage, 'km' | 'locks' | 'locksWithSide' | 'weirs' | 'access' | 'crew' | 'facilities'>): CoverageLevel {
  const accessOk = r.access >= Math.max(1, (r.km / 10) * GOOD_ACCESS_PER_10KM)
  if (accessOk && (r.crew > 0 || r.facilities > 0) && r.locksWithSide === r.locks) return 'good'
  if (r.locks + r.weirs + r.access + r.crew + r.facilities === 0) return 'thin'
  return 'some'
}

/** The scored waterways' lines for the map, coarsely, grouped by level. */
export function coverageLines(links: NetLink[], rows: WaterwayCoverage[]): Record<CoverageLevel, LatLng[][]> {
  const rowOf = new Map(rows.map(r => [r.id, r]))
  const groupOf = groupLinks(links)
  const out: Record<CoverageLevel, LatLng[][]> = { good: [], some: [], thin: [] }
  for (const l of links) {
    const row = rowOf.get(groupOf.get(l.id) ?? '')
    if (row) out[row.level].push(simplify(l.line, 150).map(p => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4] as LatLng))
  }
  return out
}

/** Named links that touch and share a name are one waterway, keyed by one of
 *  its link ids (stable for the same network). A short link of another name
 *  between two of the same name (a lock chamber, a short cut) doesn't split
 *  it. Unnamed water isn't scored. */
function groupLinks(links: NetLink[]): Map<string, string> {
  const parent = new Map<string, string>()
  const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(x, r); return r }
  const named = links.filter(l => l.name)
  for (const l of named) parent.set(l.id, l.id)
  const byNode = new Map<string, NetLink[]>()
  for (const l of named) for (const n of [l.from, l.to]) { const a = byNode.get(n); if (a) a.push(l); else byNode.set(n, [l]) }
  for (const list of byNode.values()) {
    for (let i = 1; i < list.length; i++) for (let j = 0; j < i; j++) {
      if (list[i].name === list[j].name) parent.set(find(list[i].id), find(list[j].id))
    }
  }
  for (const bridge of links) {
    if (bridge.lengthM > BRIDGE_M) continue
    const ends = [byNode.get(bridge.from) ?? [], byNode.get(bridge.to) ?? []]
    for (const a of ends[0]) for (const b of ends[1]) {
      if (a !== bridge && b !== bridge && a.name === b.name && a.name !== bridge.name) {
        parent.set(find(a.id), find(b.id))
        // A lone chamber is part of it; a stretch of another waterway isn't.
        const alone = ![...ends[0], ...ends[1]].some(l => l !== bridge && l.name === bridge.name)
        if (alone && parent.has(bridge.id)) parent.set(find(bridge.id), find(a.id))
      }
    }
  }
  const out = new Map<string, string>()
  for (const l of named) out.set(l.id, find(l.id))
  return out
}
