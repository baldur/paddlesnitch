// Routing on the waterway network (OSM rivers and canals): snap two clicks to the water, then
// the shortest way between them along connected watercourse links.
// Paddlers go both ways, so links are undirected; a return trip is the same
// route reversed.
import { project, slice } from './line'
import type { LatLng, NetLink } from './types'

export type Snap = { link: NetLink; along: number; dist: number; at: LatLng }

/** The nearest point on any link. */
export function snap(links: NetLink[], p: LatLng): Snap | null {
  let best: Snap | null = null
  for (const link of links) {
    const pr = project(link.line, p)
    if (!best || pr.dist < best.dist) best = { link, along: pr.along, dist: pr.dist, at: pr.at }
  }
  return best
}

export type Leg = { linkId: string; name: string; from: number; to: number }  // metres along that link
export type Route = { line: LatLng[]; lengthM: number; legs: Leg[] }

/** Shortest route along the network between two snapped points, or null when
 *  they aren't connected. */
export function route(
  links: NetLink[], start: Snap, finish: Snap,
  cost: (l: NetLink) => number = l => l.lengthM,   // e.g. make unnamed ditches expensive
): Route | null {
  if (start.link.id === finish.link.id) {
    const l = start.link
    return build([{ linkId: l.id, name: l.name, from: start.along, to: finish.along }], links)
  }

  // Adjacency: node → [link, neighbour node].
  const adj = new Map<string, { link: NetLink; to: string }[]>()
  const add = (n: string, e: { link: NetLink; to: string }) => {
    const list = adj.get(n)
    if (list) list.push(e); else adj.set(n, [e])
  }
  for (const l of links) {
    add(l.from, { link: l, to: l.to })
    add(l.to, { link: l, to: l.from })
  }

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

function build(legs: Leg[], links: NetLink[]): Route {
  const byId = new Map(links.map(l => [l.id, l]))
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
