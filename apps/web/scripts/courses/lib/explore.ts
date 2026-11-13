// course:explore: the pure parts. Which way round to show a spot's views, where
// the model's things sit on them, the score so far, and who may talk to the
// local server. Tested in explore.test.ts.

import { haversine } from './stations'
import { VIEWS, type Distance } from './look'
import { LANDMARK_VIEWS } from './landmarks'
import { HERE_NAMES, type HereDir } from './here'

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
const BOTTOM = 0.94
/** The pictures are 1024×640; a pin is about 22 px tall whatever the picture's size. */
const ASPECT = 640 / 1024
const PIN_PX = 24

/** A pin's label is its kind (and "×n") in 11 px mono, after a dot: its share of a view `viewPx` wide. */
export const labelWidth = (label: string, viewPx: number) => (label.length * 6.7 + 26) / viewPx

/**
 * Pins for one view `viewPx` wide on screen, as label boxes that stay inside the
 * picture and don't overlap: across at the item's x (pushed in from an edge),
 * down by its distance, and moved to the next free row below, then above, when
 * taken. `px` is the label's left edge, `py` its centre, `w` its width, all 0–1.
 * When a small picture has no free row left, a pin goes on its own band.
 */
export function layoutPins<T extends { x: number; distance: Distance; label: string }>(items: T[], viewPx = 520): Array<T & { px: number; py: number; w: number }> {
  const row = PIN_PX / (viewPx * ASPECT)
  const placed: Array<T & { px: number; py: number; w: number }> = []
  for (const it of items) {
    const w = Math.min(labelWidth(it.label, viewPx), 1)
    const px = Math.min(Math.max(it.x - w / 2, 0), 1 - w)
    const band = BAND_Y[it.distance] ?? BAND_Y.mid
    const rows: number[] = []
    for (let y = band; y <= BOTTOM + 1e-9; y += row) rows.push(y)
    for (let y = band - row; y >= row / 2; y -= row) rows.push(y)
    const free = (y: number) => !placed.some((p) => px < p.px + p.w && p.px < px + w && Math.abs(p.py - y) < row - 1e-9)
    placed.push({ ...it, w, px, py: rows.find(free) ?? band })
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

/**
 * The closest spot from each clip filmed on another day, within `metres`: the
 * same place on other days. A recording's next chapter (or the way back on the
 * same paddle) is the same day, so it isn't one.
 */
export function otherPasses<T extends { id: number; chapterId: number; startUtc: string | null; lat: number; lng: number }>(spots: T[], at: T, metres = 30): Array<T & { metres: number }> {
  const day = (s: T) => s.startUtc?.slice(0, 10) ?? `clip ${s.chapterId}`
  const best = new Map<number, T & { metres: number }>()
  for (const s of spots) {
    if (day(s) === day(at)) continue
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
/**
 * Browsers say where a request came from (Sec-Fetch-Site). Another site's page
 * could otherwise load our pictures in an <img> and set ffmpeg cutting; only our
 * own page, or the address typed in, gets an answer. Tools that don't send it
 * (curl) are still bound by the Host check.
 */
export function fetchSiteAllowed(site: string | undefined, isPage: boolean): boolean {
  // The page holds no data and can't be framed, so it may be opened from anywhere
  // (the address bar, a link, another local page); the data and pictures go only
  // to the page itself.
  if (isPage) return true
  return site === 'same-origin'
}
/** An area's name as the owner typed it: one line, 1–60 characters, or null. No control characters: course:look prints it. */
export function areaName(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return s.length >= 1 && s.length <= 60 ? s : null
}

export const isJson = (contentType: string | undefined) => /^application\/json(\s*;|$)/i.test(contentType ?? '')

export type Route =
  | { kind: 'page' } | { kind: 'spots' } | { kind: 'score' }
  | { kind: 'spot'; id: number } | { kind: 'view'; id: number; yaw: number; careful: boolean }
  | { kind: 'areas' } | { kind: 'area'; id: number } | { kind: 'areaSpots' }
  | { kind: 'near' } | { kind: 'here'; chapterId: number; ft10: number; name: HereDir }
  | { kind: 'review' } | { kind: 'missed' } | { kind: 'saveArea' } | { kind: 'none' }

const YAWS = new Set<number>(VIEWS.map((v) => v.yaw))
const CAREFUL_YAWS = new Set<number>(LANDMARK_VIEWS.map((v) => v.yaw))

/** Only these paths exist; ids are whole numbers, never paths. */
export function route(method: string, pathname: string): Route {
  if (method === 'GET') {
    if (pathname === '/') return { kind: 'page' }
    if (pathname === '/api/spots') return { kind: 'spots' }
    if (pathname === '/api/score') return { kind: 'score' }
    let m = /^\/api\/spot\/(\d{1,9})$/.exec(pathname)
    if (m) return { kind: 'spot', id: Number(m[1]) }
    m = /^\/view\/(\d{1,9})\/(l?)(\d{1,3})\.jpg$/.exec(pathname)
    if (m && (m[2] ? CAREFUL_YAWS : YAWS).has(Number(m[3]))) return { kind: 'view', id: Number(m[1]), yaw: Number(m[3]), careful: !!m[2] }
    if (pathname === '/api/areas') return { kind: 'areas' }
    if (pathname === '/api/area-spots') return { kind: 'areaSpots' }
    m = /^\/api\/area\/(\d{1,9})$/.exec(pathname)
    if (m) return { kind: 'area', id: Number(m[1]) }
    if (pathname === '/api/near') return { kind: 'near' }
    m = /^\/here\/(\d{1,9})\/(\d{1,7})\/([a-z0-9]{3,6})\.jpg$/.exec(pathname)
    if (m && (HERE_NAMES as readonly string[]).includes(m[3])) return { kind: 'here', chapterId: Number(m[1]), ft10: Number(m[2]), name: m[3] as HereDir }
  }
  if (method === 'POST' && pathname === '/api/review') return { kind: 'review' }
  if (method === 'POST' && pathname === '/api/missed') return { kind: 'missed' }
  if (method === 'POST' && pathname === '/api/area') return { kind: 'saveArea' }
  return { kind: 'none' }
}
