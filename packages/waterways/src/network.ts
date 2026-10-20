// Routing on the waterway network (OSM rivers and canals): snap two clicks to the water, then
// the shortest way between them along connected watercourse links.
// Paddlers go both ways, so links are undirected; a return trip is the same
// route reversed.
import { haversine } from '@paddlesnitch/timing/geo'
import { project, slice } from './line'
import type { LatLng, NetLink } from './types'

export type Snap = { link: NetLink; along: number; dist: number; at: LatLng }

/** The nearest point on any link. Searches a grid around the point first, so
 *  snapping stays fast on a national network. Beyond the grid search it falls
 *  back to every link, unless `maxM` says a far result isn't wanted anyway. */
export function snap(links: NetLink[], p: LatLng, maxM = Infinity): Snap | null {
  const { cells } = indexOf(links)
  const [cy, cx] = cellOf(p)
  const seen = new Set<NetLink>()
  let best: Snap | null = null
  const consider = (link: NetLink) => {
    if (seen.has(link)) return
    seen.add(link)
    const pr = project(link.line, p)
    if (!best || pr.dist < best.dist) best = { link, along: pr.along, dist: pr.dist, at: pr.at }
  }
  for (let r = 0; r <= RINGS; r++) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (Math.max(Math.abs(y - cy), Math.abs(x - cx)) !== r) continue   // this ring only
        for (const link of cells.get(`${y}:${x}`) ?? []) consider(link)
      }
    }
    // Everything within r cells is searched, so a hit that close is the nearest.
    if (best && (best as Snap).dist <= r * CELL_MIN_M) return best
    if (r * CELL_MIN_M >= maxM) return best && (best as Snap).dist <= maxM ? best : null
  }
  for (const link of links) consider(link)
  return best && (best as Snap).dist <= maxM ? best : null
}

/** Two waterways' nearest points closer than this are one place (a junction),
 *  not a choice: either way the route starts there. */
export const SAME_SPOT_M = 25

/** Every different waterway within `radiusM` of a click, nearest first: the
 *  nearest point on each (by name; unnamed water by link). More than one means
 *  the click could have meant either, and the paddler should say which. */
export function snapChoices(links: NetLink[], p: LatLng, radiusM: number): Snap[] {
  const { cells } = indexOf(links)
  const [cy, cx] = cellOf(p)
  const r = Math.ceil(radiusM / CELL_MIN_M)
  const best = new Map<string, Snap>()
  const seen = new Set<NetLink>()
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      for (const link of cells.get(`${y}:${x}`) ?? []) {
        if (seen.has(link)) continue
        seen.add(link)
        const pr = project(link.line, p)
        if (pr.dist > radiusM) continue
        const key = link.name || `#${link.id}`
        const had = best.get(key)
        if (!had || pr.dist < had.dist) best.set(key, { link, along: pr.along, dist: pr.dist, at: pr.at })
      }
    }
  }
  const out: Snap[] = []
  for (const s of [...best.values()].sort((a, b) => a.dist - b.dist)) {
    if (!out.some(o => haversine(o.at, s.at) < SAME_SPOT_M)) out.push(s)
  }
  return out
}

// --- Index: a grid for snapping and the adjacency for routing, built once per
// links array (the national network is large; rebuilding per call isn't).
const CELL = 0.02                                 // degrees
const CELL_MIN_M = CELL * 111_320 * Math.cos((61 * Math.PI) / 180)   // a cell's narrowest side in the UK and Ireland
const RINGS = 4
const cellOf = (p: LatLng): [number, number] => [Math.floor(p[0] / CELL), Math.floor(p[1] / CELL)]

type Index = {
  byId: Map<string, NetLink>
  cells: Map<string, NetLink[]>
  adj: Map<string, { link: NetLink; to: string }[]>
}
const indexes = new WeakMap<NetLink[], Index>()

function indexOf(links: NetLink[]): Index {
  const hit = indexes.get(links)
  if (hit) return hit
  const cells = new Map<string, NetLink[]>()
  const adj = new Map<string, { link: NetLink; to: string }[]>()
  const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]) }
  for (const link of links) {
    const keys = new Set<string>()
    for (let i = 0; i < link.line.length; i++) {
      const [y, x] = cellOf(link.line[i])
      keys.add(`${y}:${x}`)
      // A long straight segment can cross cells between its vertices.
      if (i > 0) {
        const [py, px] = cellOf(link.line[i - 1])
        for (let yy = Math.min(y, py); yy <= Math.max(y, py); yy++)
          for (let xx = Math.min(x, px); xx <= Math.max(x, px); xx++) keys.add(`${yy}:${xx}`)
      }
    }
    for (const k of keys) push(cells, k, link)
    push(adj, link.from, { link, to: link.to })
    push(adj, link.to, { link, to: link.from })
  }
  const index = { byId: new Map(links.map(l => [l.id, l])), cells, adj }
  indexes.set(links, index)
  return index
}

/** Routing cost: the navigation (boat=yes) at face value, untagged water at
 *  twice, water marked no-boats at four times, culverts all but never. A route
 *  then keeps to the navigation instead of a slightly shorter flood channel,
 *  and still uses side water when it's the only way. */
export function paddleCost(l: NetLink): number {
  return l.lengthM * (l.culvert ? 50 : l.boat === 'yes' ? 1 : l.boat === 'no' ? 4 : 2)
}

export type Leg = { linkId: string; name: string; from: number; to: number }  // metres along that link
export type Route = { line: LatLng[]; lengthM: number; legs: Leg[] }

/** Shortest route along the network between two snapped points, or null when
 *  they aren't connected. */
export function route(
  links: NetLink[], start: Snap, finish: Snap,
  cost: (l: NetLink) => number = paddleCost,
): Route | null {
  if (start.link.id === finish.link.id) {
    const l = start.link
    return build([{ linkId: l.id, name: l.name, from: start.along, to: finish.along }], links)
  }

  const { adj } = indexOf(links)

  // Dijkstra from a virtual start node sitting part-way along the start link.
  const dist = new Map<string, number>()
  const prev = new Map<string, { node: string; link: NetLink } | 'start'>()
  const heap = new MinHeap()
  const seed = (node: string, d: number) => {
    if (d < (dist.get(node) ?? Infinity)) { dist.set(node, d); prev.set(node, 'start'); heap.push(node, d) }
  }
  seed(start.link.from, start.along)
  seed(start.link.to, start.link.lengthM - start.along)

  const fl = finish.link
  const goal = (n: string) => (n === fl.from ? finish.along : n === fl.to ? fl.lengthM - finish.along : Infinity)
  let bestEnd: string | null = null, bestTotal = Infinity

  while (heap.size) {
    const { key: node, d } = heap.pop()!
    if (d > (dist.get(node) ?? Infinity)) continue
    if (d >= bestTotal) break
    const g = goal(node)
    if (d + g < bestTotal) { bestTotal = d + g; bestEnd = node }
    for (const e of adj.get(node) ?? []) {
      if (e.link.id === fl.id || e.link.id === start.link.id) continue   // entered/left part-way instead
      const nd = d + cost(e.link)
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd); prev.set(e.to, { node, link: e.link }); heap.push(e.to, nd)
      }
    }
  }
  if (!bestEnd) return null

  // Walk back from the end node to the start.
  const legs: Leg[] = []
  legs.push({ linkId: fl.id, name: fl.name, from: bestEnd === fl.from ? 0 : fl.lengthM, to: finish.along })
  let node = bestEnd
  for (;;) {
    const p = prev.get(node)!
    if (p === 'start') {
      const sl = start.link
      legs.push({ linkId: sl.id, name: sl.name, from: start.along, to: node === sl.from ? 0 : sl.lengthM })
      break
    }
    const l = p.link
    // We travelled p.node → node along l.
    legs.push({ linkId: l.id, name: l.name, from: p.node === l.from ? 0 : l.lengthM, to: p.node === l.from ? l.lengthM : 0 })
    node = p.node
  }
  legs.reverse()
  return build(legs, links)
}

/** One link by id (from the same index routing uses). */
export const linkById = (links: NetLink[], id: string): NetLink | undefined => indexOf(links).byId.get(id)

function build(legs: Leg[], links: NetLink[]): Route {
  const { byId } = indexOf(links)
  const line: LatLng[] = []
  let lengthM = 0
  for (const leg of legs) {
    const l = byId.get(leg.linkId)!
    const part = slice(l.line, leg.from, leg.to)
    if (line.length) part.shift()   // shared vertex with the previous leg
    line.push(...part)
    lengthM += Math.abs(leg.to - leg.from)
  }
  return { line, lengthM, legs: legs.filter(l => l.from !== l.to) }
}

/** The return leg: the same water, the other way. */
export function reverseRoute(r: Route): Route {
  return {
    line: [...r.line].reverse(),
    lengthM: r.lengthM,
    legs: [...r.legs].reverse().map(l => ({ ...l, from: l.to, to: l.from })),
  }
}

class MinHeap {
  private a: { key: string; d: number }[] = []
  get size() { return this.a.length }
  push(key: string, d: number) {
    const a = this.a
    a.push({ key, d })
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p].d <= a[i].d) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }
  pop() {
    const a = this.a
    if (!a.length) return undefined
    const top = a[0], last = a.pop()!
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < a.length && a[l].d < a[m].d) m = l
        if (r < a.length && a[r].d < a[m].d) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
}
