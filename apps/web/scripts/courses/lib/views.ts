// Reference views for the Reading game: a fixed set of places along the river,
// each a frame of the owner's footage and the game drawn from the same eye and
// heading, scored 1–5 by the owner. The measure for every change to how the
// river looks. Pure; tested in views.test.ts. See course:views.
import { bearing } from './stations'
import { HERE_DIRS, type HereDir, type Pass } from './here'
import type { XZ } from './river'

/** A place to look from: along the river every SPACING metres, and in front of each landmark. */
export type Point = { id: string; name: string; at: XZ; target?: XZ }
export const SPACING = 200

/**
 * The points: one on the river line every `spacing` metres (named by distance
 * up the river), and one off each landmark (the river line's point nearest it,
 * looking at it). `along(s)` is the river line's point s metres up.
 */
export function pickPoints(length: number, along: (s: number) => XZ, landmarks: Array<{ name: string; at: XZ; s: number }>, spacing = SPACING): Point[] {
  const points: Point[] = []
  for (let s = spacing / 2; s < length; s += spacing) points.push({ id: `s${Math.round(s)}`, name: `${(s / 1000).toFixed(1)} km up the river`, at: along(s) })
  for (const l of landmarks) points.push({ id: l.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), name: l.name, at: along(l.s), target: l.at })
  return points
}

/** Which way the camera was going at `ft` seconds: the bearing from the fix `span` seconds before to the one after (null if it hardly moved). Track rows are [ft, lat, lng, …]. */
export function headingAt(track: number[][], ft: number, span = 2): number | null {
  const near = (t: number) => track.reduce((a, b) => (Math.abs(b[0] - t) < Math.abs(a[0] - t) ? b : a))
  const [a, b] = [near(ft - span), near(ft + span)]
  const from = { lat: a[1], lng: a[2] }
  const to = { lat: b[1], lng: b[2] }
  if (Math.hypot((to.lat - from.lat) * 111_000, (to.lng - from.lng) * 69_000) < 1) return null
  return bearing(from, to)
}

/**
 * A pass to take a view from: moving, in daylight (`hour` local; the footage is
 * all early mornings), with the camera's direction known or, failing that,
 * assumed (`cameraYaw` set); a known one first, then the closest.
 */
export function choosePass<T extends Pass & { cameraKnown: boolean; cameraYaw: number | null; hour: number; heading: number | null }>(passes: T[]): T | null {
  const good = passes.filter((p) => p.cameraYaw !== null && p.heading !== null && p.hour >= 6 && p.hour < 21)
  return [...good].sort((a, b) => Number(b.cameraKnown) - Number(a.cameraKnown) || a.metres - b.metres)[0] ?? null
}

/**
 * Up to `n` passes to look at one place from, each from a different recording
 * (so different days and light), chosen as choosePass chooses one.
 */
export function choosePasses<T extends Pass & { cameraKnown: boolean; cameraYaw: number | null; hour: number; heading: number | null; recording: string }>(passes: T[], n: number): T[] {
  const out: T[] = []
  for (const p of passes.filter((x) => choosePass([x])).sort((a, b) => Number(b.cameraKnown) - Number(a.cameraKnown) || a.metres - b.metres)) {
    if (out.length < n && !out.some((o) => o.recording === p.recording)) out.push(p)
  }
  return out
}

/** Which way a clip's camera faced from the bow: its own, or the one every known clip in its folder has (rowing 0, kayak 180), else none. */
export const FOLDER_YAW: Record<string, number> = { rowing: 0, kayak: 180 }
export function cameraYawOf(known: number | null, folder: string): number | null {
  return known ?? FOLDER_YAW[folder] ?? null
}

/** Which of a pass's four views to use: the one facing the target, or ahead with none. */
export function viewFacing(heading: number, from: XZ, target?: XZ): HereDir {
  if (!target) return 'ahead'
  // Game x is east, z south: the bearing to the target, clockwise from north.
  const want = (Math.atan2(target[0] - from[0], -(target[1] - from[1])) * 180) / Math.PI
  const off = (d: (typeof HERE_DIRS)[number]) => Math.abs((((heading + d.fromBow - want) % 360) + 540) % 360 - 180)
  return [...HERE_DIRS].sort((a, b) => off(a) - off(b))[0].name
}

/** The game's camera for a view: at the frame's eye, `height` over the water, looking the view's way. */
export function gameCamera(at: XZ, heading: number, view: HereDir, height = 0.8): { eye: [number, number, number]; look: [number, number, number] } {
  const d = HERE_DIRS.find((v) => v.name === view)?.fromBow ?? 0
  const a = ((heading + d) * Math.PI) / 180
  return { eye: [at[0], height, at[1]], look: [at[0] + Math.sin(a) * 50, height, at[1] - Math.cos(a) * 50] }
}

/** The owner's scores: for each game version (a label), each view's 1–5. Anything else read back is dropped. */
export type Scores = Record<string, Record<string, number>>
export function cleanScores(raw: unknown, ids: string[]): Scores {
  const out: Scores = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [label, row] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[\w.-]{1,40}$/.test(label) || !row || typeof row !== 'object') continue
    const kept = Object.fromEntries(Object.entries(row as Record<string, unknown>).filter(([id, v]) => ids.includes(id) && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5)) as Record<string, number>
    out[label] = kept
  }
  return out
}

/** A label's average score and how many views have one. */
export function average(scores: Scores, label: string): { mean: number | null; n: number } {
  const v = Object.values(scores[label] ?? {})
  return { mean: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, n: v.length }
}
