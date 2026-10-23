// What the planner's map draws: the network cut into areas for when you're
// zoomed in, and one coarse overview for when you're not. Routing never uses
// these; it runs on the full network on the server.
import { simplify } from './line'
import type { LatLng, NetLink } from './types'

/** Areas are AREA_DEG × AREA_DEG degree cells, keyed "y_x" (floor of lat/lng ÷ AREA_DEG). */
export const AREA_DEG = 0.5
/** Below this zoom the map shows the overview instead of areas. */
export const AREA_MIN_ZOOM = 9

export const areaKey = (y: number, x: number) => `${y}_${x}`

/** Every area a map view touches. */
export function areasIn(south: number, west: number, north: number, east: number): string[] {
  const out: string[] = []
  for (let y = Math.floor(south / AREA_DEG); y <= Math.floor(north / AREA_DEG); y++)
    for (let x = Math.floor(west / AREA_DEG); x <= Math.floor(east / AREA_DEG); x++) out.push(areaKey(y, x))
  return out
}

const boxes = new WeakMap<NetLink[], { s: number; w: number; n: number; e: number }[]>()
function boxesOf(links: NetLink[]) {
  let b = boxes.get(links)
  if (!b) {
    b = links.map(l => {
      let s = 90, w = 180, n = -90, e = -180
      for (const [lat, lng] of l.line) { s = Math.min(s, lat); n = Math.max(n, lat); w = Math.min(w, lng); e = Math.max(e, lng) }
      return { s, w, n, e }
    })
    boxes.set(links, b)
  }
  return b
}

/** The lines of every link that enters an area, lightly simplified. A link
 *  crossing an edge appears in both areas; drawn twice, it looks the same. */
export function areaLines(links: NetLink[], key: string): LatLng[][] {
  const [y, x] = key.split('_').map(Number)
  const s = y * AREA_DEG, w = x * AREA_DEG, n = s + AREA_DEG, e = w + AREA_DEG
  const b = boxesOf(links)
  const out: LatLng[][] = []
  for (let i = 0; i < links.length; i++) {
    const bb = b[i]
    if (bb.n < s || bb.s >= n || bb.e < w || bb.w >= e) continue
    out.push(simplify(links[i].line, 10).map(round5))
  }
  return out
}

/** Canals, navigations and longer rivers, coarsely: enough to see where the
 *  water is below AREA_MIN_ZOOM, where a pixel is ~400 m. Simplified to 500 m
 *  and rounded to 3 dp (~110 m): with France in, that's 0.84 MB gzipped
 *  rather than 1.34 (250 m, 4 dp), every first visit to /plan. */
export function overviewLines(links: NetLink[]): LatLng[][] {
  return links
    .filter(l => l.form === 'canal' || l.boat === 'yes' || l.lengthM > 2000)
    .map(l => simplify(l.line, 500).map(round3))
}

const round5 = (p: LatLng): LatLng => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]
const round3 = (p: LatLng): LatLng => [Math.round(p[0] * 1e3) / 1e3, Math.round(p[1] * 1e3) / 1e3]
