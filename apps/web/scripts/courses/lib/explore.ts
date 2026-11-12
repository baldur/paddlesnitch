// course:explore: the pure parts. Which way round to show a spot's views, where
// the model's things sit on them, the score so far, and who may talk to the
// local server. Tested in explore.test.ts.

import { haversine } from './stations'
import { VIEWS, type Distance } from './look'

/** Every clip so far was shot from the back deck looking back (look.ts, ASSUMED_YAW). */
export const ASSUMED_YAW = 180

const NAMES: Record<number, string> = { 0: 'ahead', 90: 'right', 180: 'behind', 270: 'left' }

/**
 * The four views as one strip with the bow in the middle: left, ahead, right,
 * behind. A view at lens angle v looks (v - cameraYaw) degrees from the bow.
 */
export function stripOrder(cameraYaw: number | null): Array<{ viewYaw: number; fromBow: number; name: string }> {
  const yaw = cameraYaw ?? ASSUMED_YAW
  const order = [270, 0, 90, 180]
  return VIEWS.map((v) => {
    const fromBow = ((((v.yaw - yaw) % 360) + 360) % 360)
    // A hand-set yaw needn't be a multiple of 90: name the view by its nearest side.
    const side = Math.round(fromBow / 90) * 90 % 360
    return { viewYaw: v.yaw, fromBow, name: NAMES[side], side }
  }).sort((a, b) => order.indexOf(a.side) - order.indexOf(b.side)).map(({ viewYaw, fromBow, name }) => ({ viewYaw, fromBow, name }))
}

/** How far down the picture a thing of each distance usually sits (the horizon is a little above the middle). */
const BAND_Y: Record<Distance, number> = { far: 0.42, mid: 0.52, near: 0.68 }

/**
 * Pins for one view: across at the item's x, down by its distance, and nudged
 * down a row when they'd sit on top of an earlier pin.
 */
export function layoutPins<T extends { x: number; distance: Distance }>(items: T[], minGap = 0.07, row = 0.07): Array<T & { px: number; py: number }> {
  const placed: Array<T & { px: number; py: number }> = []
  for (const it of items) {
    let py = BAND_Y[it.distance] ?? BAND_Y.mid
    while (placed.some((p) => Math.abs(p.px - it.x) < minGap && Math.abs(p.py - py) < row / 2)) py += row
    placed.push({ ...it, px: it.x, py: Math.min(py, 0.96) })
  }
  return placed
}

export type Verdict = 'right' | 'wrong'
export type Score = { checked: number; right: number; wrong: number; missed: number; rate: number | null; byKind: Array<{ kind: string; right: number; wrong: number; rate: number }> }

/** How the model is doing on what's been checked: things it got right, things it made up, things it missed. */
export function scoreOf(reviews: Array<{ kind: string; verdict: Verdict }>, missed: number): Score {
  const kinds = new Map<string, { right: number; wrong: number }>()
  for (const r of reviews) {
    const k = kinds.get(r.kind) ?? { right: 0, wrong: 0 }
    k[r.verdict]++
    kinds.set(r.kind, k)
  }
  const right = reviews.filter((r) => r.verdict === 'right').length
  const wrong = reviews.length - right
  return {
    checked: reviews.length, right, wrong, missed,
    rate: reviews.length ? right / reviews.length : null,
    byKind: [...kinds].map(([kind, k]) => ({ kind, ...k, rate: k.right / (k.right + k.wrong) }))
      .sort((a, b) => b.right + b.wrong - (a.right + a.wrong) || a.kind.localeCompare(b.kind)),
  }
}

/** The closest spot from each other clip within `metres`: the same place on other days. */
export function otherPasses<T extends { id: number; chapterId: number; lat: number; lng: number }>(spots: T[], at: T, metres = 30): Array<T & { metres: number }> {
  const best = new Map<number, T & { metres: number }>()
  for (const s of spots) {
    if (s.chapterId === at.chapterId) continue
    const m = haversine(s, at)
    if (m > metres) continue
    const b = best.get(s.chapterId)
    if (!b || m < b.metres) best.set(s.chapterId, { ...s, metres: m })
  }
  return [...best.values()].sort((a, b) => a.metres - b.metres)
}

/**
 * The page holds the owner's footage, so the server answers only this machine:
 * a Host of localhost or 127.0.0.1 on our port (a page on another site can point
 * its own name at 127.0.0.1, so the Host matters), and a change only from our
 * own page (Origin).
 */
export function hostAllowed(host: string | undefined, port: number): boolean {
  return host === `localhost:${port}` || host === `127.0.0.1:${port}`
}
export function originAllowed(origin: string | undefined, port: number): boolean {
  return origin === `http://localhost:${port}` || origin === `http://127.0.0.1:${port}`
}

export type Route =
  | { kind: 'page' } | { kind: 'spots' } | { kind: 'score' }
  | { kind: 'spot'; id: number } | { kind: 'view'; id: number; yaw: number }
  | { kind: 'review' } | { kind: 'missed' } | { kind: 'none' }

const YAWS = new Set<number>(VIEWS.map((v) => v.yaw))

/** Only these paths exist; ids are whole numbers, never paths. */
export function route(method: string, pathname: string): Route {
  if (method === 'GET') {
    if (pathname === '/') return { kind: 'page' }
    if (pathname === '/api/spots') return { kind: 'spots' }
    if (pathname === '/api/score') return { kind: 'score' }
    let m = /^\/api\/spot\/(\d{1,9})$/.exec(pathname)
    if (m) return { kind: 'spot', id: Number(m[1]) }
    m = /^\/view\/(\d{1,9})\/(\d{1,3})\.jpg$/.exec(pathname)
    if (m && YAWS.has(Number(m[2]))) return { kind: 'view', id: Number(m[1]), yaw: Number(m[2]) }
  }
  if (method === 'POST' && pathname === '/api/review') return { kind: 'review' }
  if (method === 'POST' && pathname === '/api/missed') return { kind: 'missed' }
  return { kind: 'none' }
}
