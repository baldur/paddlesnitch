// What the map's portage markers and a portage's own page need (pure). The page
// has no route behind it, so it finds the water through the lock itself and
// gives banks by compass heading, both ways.
import { AREA_DEG, areaKey } from './display'
import { cumulative, project, slice } from './line'
import { snap } from './network'
import { portageOnRoute, portagesAt, type PortageOnRoute, type PublicPortage } from './portage'
import type { Feature, LatLng, NetLink } from './types'

/** Below this the markers would crowd the map. */
export const PORTAGE_MIN_ZOOM = 12

export type PortagePoint = { id: string; at: LatLng; name: string; known: boolean }

const KIND_NAME: Partial<Record<Feature['kind'], string>> = { lock: 'Lock', portage: 'Portage', weir: 'Weir' }
export const portageName = (f: Feature) => f.name ?? KIND_NAME[f.kind] ?? 'Portage'

/** A feature with a page: anything you carry round. */
export const hasPortagePage = (f: Feature) => f.kind === 'lock' || f.kind === 'portage' || f.kind === 'weir'

/** Locks and portages in one area. A weir shows only once someone has described a carry round it. */
export function portagePointsInArea(features: Feature[], portages: PublicPortage[], key: string): PortagePoint[] {
  return features.flatMap(f => {
    if (!hasPortagePage(f) || areaKey(Math.floor(f.at[0] / AREA_DEG), Math.floor(f.at[1] / AREA_DEG)) !== key) return []
    const known = !!f.noCarry || !!f.portage?.side || portagesAt(f, portages).length > 0
    return f.kind === 'weir' && !known ? [] : [{ id: f.id, at: f.at, name: portageName(f), known }]
  })
}

const nodes = new WeakMap<NetLink[], Map<string, NetLink[]>>()
function atNodes(links: NetLink[]) {
  let m = nodes.get(links)
  if (!m) {
    m = new Map()
    for (const l of links) for (const n of [l.from, l.to]) m.set(n, [...(m.get(n) ?? []), l])
    nodes.set(links, m)
  }
  return m
}

const bearing = (a: LatLng, b: LatLng) => {
  const k = Math.cos((a[0] * Math.PI) / 180)
  return Math.atan2((b[1] - a[1]) * k, b[0] - a[0])
}
const turn = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))

/** On from a node, taking the straightest paddleable link at each junction. */
function walk(links: NetLink[], from: LatLng[], node: string, came: string, reachM: number) {
  const index = atNodes(links)
  const pts: LatLng[] = [], names: string[] = []
  const seen = new Set([came])
  let here = from, at = node, left = reachM
  while (left > 0) {
    const next: { l: NetLink; line: LatLng[]; end: string } | undefined = (index.get(at) ?? [])
      .filter(l => !seen.has(l.id) && !l.culvert)
      .map(l => (l.from === at ? { l, line: l.line, end: l.to } : { l, line: [...l.line].reverse(), end: l.from }))
      .sort((a, b) => Number(a.l.boat === 'no') - Number(b.l.boat === 'no')
        || turn(bearing(here[here.length - 2], here[here.length - 1]), bearing(a.line[0], a.line[1]))
        - turn(bearing(here[here.length - 2], here[here.length - 1]), bearing(b.line[0], b.line[1])))[0]
    if (!next) break
    seen.add(next.l.id)
    pts.push(...next.line.slice(1))
    if (next.l.name) names.push(next.l.name)
    left -= next.l.lengthM
    here = next.line
    at = next.end
  }
  return { pts, names }
}

/** The water through a point, `reachM` or as far as it goes each way. */
export function lineThrough(links: NetLink[], at: LatLng, reachM: number): { line: LatLng[]; waterways: string[] } | null {
  const s = snap(links, at, 300)
  if (!s) return null
  const ahead = walk(links, s.link.line, s.link.to, s.link.id, reachM)
  const behind = walk(links, [...s.link.line].reverse(), s.link.from, s.link.id, reachM)
  return {
    line: [...[...behind.pts].reverse(), ...s.link.line, ...ahead.pts],
    waterways: [...new Set([s.link.name, ...ahead.names, ...behind.names].filter(Boolean))],
  }
}

const WINDS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']

/** Which way the line runs at a point on it, in words. */
export function headingAt(line: LatLng[], alongM: number, cum = cumulative(line)): string {
  const part = slice(line, Math.max(0, alongM - 40), alongM + 40, cum)
  const deg = (bearing(part[0], part[part.length - 1]) * 180) / Math.PI
  return WINDS[Math.round(((deg + 360) % 360) / 45) % 8]
}

export type PortageWay = { heading: string; portage: PortageOnRoute }

/** One described portage, seen each way along the water. */
export type PortageBothWays = { id: string; ways: [PortageWay, PortageWay] }

export type PortageFacts = {
  feature: Feature
  name: string
  line: LatLng[]                // through the lock, the way `ways[0]` is travelled
  waterways: string[]
  alongM: number                // the lock's place on `line`
  portages: PortageBothWays[]
}

/** Everything we know about one portage. `portages` are public ones only. */
export function portageFacts(feature: Feature, links: NetLink[], portages: PublicPortage[], reachM: number): PortageFacts {
  const through = lineThrough(links, feature.at, reachM)
  const line = through?.line ?? []
  const here = portagesAt(feature, portages)
  const cum = line.length > 1 ? cumulative(line) : []
  const alongM = line.length > 1 ? project(line, feature.at, cum).along : 0
  const back = [...line].reverse(), backCum = line.length > 1 ? cumulative(back) : []
  const backAt = cum.length ? cum[cum.length - 1] - alongM : 0
  return {
    feature, name: portageName(feature), line, waterways: through?.waterways ?? [], alongM,
    portages: line.length > 1 ? here.map(c => ({
      id: c.id,
      ways: [
        { heading: headingAt(line, alongM, cum), portage: portageOnRoute(line, c, cum) },
        { heading: headingAt(back, backAt, backCum), portage: portageOnRoute(back, c, backCum) },
      ],
    })) : [],
  }
}

/** The gauge nearest along the water, not in a straight line. */
export function nearestAlong<T extends { chainageM: number }>(gauges: T[], alongM: number): T | undefined {
  return [...gauges].sort((a, b) => Math.abs(a.chainageM - alongM) - Math.abs(b.chainageM - alongM))[0]
}
