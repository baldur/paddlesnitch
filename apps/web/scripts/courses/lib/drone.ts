// course:look --drone: which frames of a drone clip to show the model, what to
// ask about an oblique aerial view, and where on the ground each answer is.
// Pure; tested in drone.test.ts. Poses come from lib/dji.ts.
//
// Game metres throughout (x east, z south, from lib/river.ts's projection). A
// pose's `alt` is the drone's height above its take-off point; the ground is
// lidar's bare ground above the river (games/reading-thames/lidar.js), passed
// in as a function so this stays pure.

import type { XZ } from './river'
import type { Pose } from './dji'

export const DRONE_VERSION = 1

// The width of a 4:3 frame whose diagonal is 35 mm film's (43.27 mm): DJI's
// "24 mm equivalent" is the photo's, and its 16:9 video uses the full width.
const EQUIV_WIDTH_MM = 34.6

/** Horizontal and vertical field of view, degrees, for a 35 mm-equivalent focal length and a frame size. */
export function fieldOfView(focal: number, w: number, h: number): { h: number; v: number } {
  const th = EQUIV_WIDTH_MM / 2 / focal
  return { h: (2 * Math.atan(th) * 180) / Math.PI, v: (2 * Math.atan((th * h) / w) * 180) / Math.PI }
}

type V3 = [number, number, number] // east, north, up

/**
 * The direction (east, north, up) through a point of the picture, x and y 0..1
 * from the left and top. The gimbal holds the horizon level, so roll is taken as 0.
 */
export function rayThrough(pose: Pick<Pose, 'pitch' | 'yaw'>, fov: { h: number; v: number }, x: number, y: number): V3 {
  const r = Math.PI / 180
  const [p, w] = [pose.pitch * r, pose.yaw * r]
  const f: V3 = [Math.cos(p) * Math.sin(w), Math.cos(p) * Math.cos(w), Math.sin(p)]
  const right: V3 = [Math.cos(w), -Math.sin(w), 0]
  const up: V3 = [-Math.sin(p) * Math.sin(w), -Math.sin(p) * Math.cos(w), Math.cos(p)]
  const a = (2 * x - 1) * Math.tan((fov.h / 2) * r)
  const b = (1 - 2 * y) * Math.tan((fov.v / 2) * r)
  return [f[0] + a * right[0] + b * up[0], f[1] + a * right[1] + b * up[1], f[2] + a * right[2] + b * up[2]]
}

export type Ground = (x: number, z: number) => number | null

export const MAX_RANGE = 800

/**
 * Where a ray from the camera meets the ground: game x, z and the horizontal
 * range, or null if it doesn't within MAX_RANGE (it's at or above the horizon).
 * `height` is the camera's height above the river; where `ground` has no value
 * (off the lidar) it's `fallback`. Marches 2 m at a time, then interpolates.
 */
export function groundHit(from: XZ, height: number, dir: V3, ground: Ground, fallback: number): { x: number; z: number; range: number } | null {
  const horiz = Math.hypot(dir[0], dir[1])
  const g = (x: number, z: number) => ground(x, z) ?? fallback
  if (dir[2] >= 0 && horiz > 0) return null
  if (horiz < 1e-9) return height > g(from[0], from[1]) ? { x: from[0], z: from[1], range: 0 } : null
  const [ux, uz] = [dir[0] / horiz, -dir[1] / horiz] // game z is south
  const slope = dir[2] / horiz
  const STEP = 2
  let prev = height - g(from[0], from[1])
  if (prev <= 0) return null // underground: a bad height
  for (let d = STEP; d <= MAX_RANGE; d += STEP) {
    const [x, z] = [from[0] + ux * d, from[1] + uz * d]
    const above = height + slope * d - g(x, z)
    if (above <= 0) {
      const back = (STEP * -above) / (prev - above)
      const r = d - back
      return { x: from[0] + ux * r, z: from[1] + uz * r, range: r }
    }
    prev = above
  }
  return null
}

/**
 * The ground height at take-off, for turning `alt` (above take-off) into height
 * above the river. If the drone came within `low` m of its take-off height, it
 * was low over the ground there, so the ground under that moment is close to
 * the take-off ground; otherwise `fallback`. Give it a whole flight day's poses.
 */
export function takeoffGround(poses: Array<Pick<Pose, 'alt'> & { at: XZ }>, ground: Ground, fallback: number, low = 3): number {
  let best: (typeof poses)[number] | null = null
  for (const p of poses) if (!best || p.alt < best.alt) best = p
  if (!best || best.alt > low) return fallback
  return ground(best.at[0], best.at[1]) ?? fallback
}

export type Candidate = { t: number; target: XZ | null; yaw: number }

/** Where a frame looks: the middle of the picture on the ground, or lower in the picture when the middle is the sky. */
export function frameTarget(from: XZ, height: number, pose: Pick<Pose, 'pitch' | 'yaw'>, fov: { h: number; v: number }, ground: Ground, fallback: number): XZ | null {
  for (const y of [0.5, 0.7, 0.9]) {
    const hit = groundHit(from, height, rayThrough(pose, fov, 0.5, y), ground, fallback)
    if (hit) return [hit.x, hit.z]
  }
  return null
}

/**
 * Which frames to look at, coarse to fine: level k keeps a frame when what it
 * looks at is `spacings[k]` m from what every frame kept so far looks at (or it
 * looks a different way, 35° or more), and it's `minGap` s from every kept
 * frame. Frames that look at nothing, or that `near` rejects (too far from the
 * river), are never kept. `n` numbers the frames kept, in order, across levels.
 */
export function pickShots(cands: Candidate[], spacings: number[], near: (p: XZ) => boolean, minGap = 2): Array<{ t: number; level: number; n: number }> {
  const kept: Array<Candidate & { level: number; n: number }> = []
  const usable = cands.filter((c) => c.target && near(c.target))
  const yawDiff = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180)
  spacings.forEach((spacing, level) => {
    for (const c of usable) {
      if (kept.some((k) => Math.abs(k.t - c.t) < minGap)) continue
      const close = kept.some((k) => Math.hypot(k.target![0] - c.target![0], k.target![1] - c.target![1]) < spacing && yawDiff(k.yaw, c.yaw) < 35)
      if (!close) kept.push({ ...c, level, n: kept.length })
    }
  })
  return kept.sort((a, b) => a.level - b.level || a.t - b.t).map(({ t, level, n }) => ({ t, level, n }))
}

// ---------- what the model is asked ----------

export const DRONE_KINDS = [
  'house', 'flats', 'boathouse', 'clubhouse', 'pub-restaurant', 'church', 'industrial', 'shed', 'other-building',
  'bridge', 'lock', 'weir', 'island',
  'pontoon', 'jetty', 'slipway', 'steps', 'river-wall', 'railings', 'boat-rack',
  'moored-narrowboat', 'moored-cruiser', 'moored-other',
  'trees', 'willow', 'conifer', 'hedge', 'reeds',
  'grass-bank', 'park', 'garden', 'field', 'sports-pitch', 'path', 'road', 'car-park',
  'other',
] as const
export type DroneKind = (typeof DRONE_KINDS)[number]
export const MAX_DRONE_ITEMS = 30

export const DRONE_SCHEMA = {
  type: 'object',
  properties: {
    scene: { type: 'string', maxLength: 200 },
    items: {
      type: 'array',
      maxItems: MAX_DRONE_ITEMS,
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: DRONE_KINDS },
          detail: { type: 'string', maxLength: 120 },
          walls: { type: 'string', maxLength: 60 },
          roof: { type: 'string', maxLength: 60 },
          storeys: { type: 'integer' },
          features: { type: 'string', maxLength: 120 },
          x: { type: 'number' },
          y: { type: 'number' },
          sure: { type: 'boolean' },
        },
        required: ['kind', 'detail', 'walls', 'roof', 'storeys', 'features', 'x', 'y', 'sure'],
      },
    },
  },
  required: ['scene', 'items'],
} as const

export const DRONE_PROMPT = `This is a frame from a drone's camera above a river in a town, looking down at an angle.
Describe the fixed things on the banks and the waterfront for a game artist who will rebuild them as simple low-poly shapes.

- scene: one sentence (under 25 words) about this stretch of river and its banks.
- items: one entry per building, bridge or waterfront structure, or per group of the same plants or ground:
  - kind: from the list;
  - detail: what makes it recognisable, under 15 words;
  - walls: material and colour (e.g. "red brick", "white render", "dark timber cladding"); "" if it has no walls;
  - roof: colour and shape (e.g. "grey slate gable", "flat", "red tile hipped"); "" if none;
  - storeys: how many storeys; 0 if not a building;
  - features: notable parts, such as balconies, wide boathouse doors, dormers, chimneys, arches, parapets, lamps, railings, steps down to the water; "" if none;
  - x, y: where its base meets the ground or the water, 0..1 from the left and from the top of the picture;
  - sure: true only if it is clearly visible and you are confident of the kind.
Leave out people, cars and moving boats, in the scene sentence too. Never write a boat's name or describe a person.
Only list what you can see. Distant blurry things can be left out. An empty list is fine.`

export type DroneItem = { kind: DroneKind; detail: string; walls: string; roof: string; storeys: number; features: string; x: number; y: number; sure: boolean }
export type DroneLook = { scene: string; items: DroneItem[] }

const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.trim().slice(0, n) : '')
const unit = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5)
const NOT_SEEN = /^(none|no |not (visible|present|seen)|n\/a)/i
const BLANK = /^(none|n\/a|unknown|not visible)\.?$/i

/** The model's reply as a DroneLook, or null if it isn't one. Unknown kinds become 'other'; coordinates are clamped to the picture. */
export function parseDroneLook(text: string): DroneLook | null {
  let j: Record<string, unknown>
  try { j = JSON.parse(text) } catch { return null }
  if (!j || typeof j !== 'object' || !Array.isArray(j.items)) return null
  const seen = new Set<string>()
  const items: DroneItem[] = []
  for (const i of j.items as Array<Record<string, unknown>>) {
    if (!i || typeof i !== 'object' || NOT_SEEN.test(clip(i.detail, 200))) continue
    const blank = (s: string) => (BLANK.test(s) ? '' : s)
    const item: DroneItem = {
      kind: (DRONE_KINDS as readonly string[]).includes(i.kind as string) ? (i.kind as DroneKind) : 'other',
      detail: clip(i.detail, 200),
      walls: blank(clip(i.walls, 80)),
      roof: blank(clip(i.roof, 80)),
      storeys: typeof i.storeys === 'number' && Number.isFinite(i.storeys) ? Math.min(30, Math.max(0, Math.round(i.storeys))) : 0,
      features: blank(clip(i.features, 160)),
      x: unit(i.x),
      y: unit(i.y),
      sure: i.sure === true,
    }
    const key = JSON.stringify(item)
    if (seen.has(key)) continue
    seen.add(key)
    items.push(item)
  }
  return { scene: clip(j.scene, 300), items }
}

/**
 * Where a thing the model listed is on the ground: the ray through its point in
 * the picture, met with the ground. Things at or above the horizon get only a
 * bearing (`placed: 'bearing'`) and a point `farM` along it.
 */
export function placeDroneItem(at: XZ, height: number, pose: Pick<Pose, 'pitch' | 'yaw'>, fov: { h: number; v: number }, item: Pick<DroneItem, 'x' | 'y'>, ground: Ground, fallback: number, farM = 300):
  { x: number; z: number; range: number | null; bearing: number; placed: 'ground' | 'bearing' } {
  const dir = rayThrough(pose, fov, item.x, item.y)
  const bearing = ((Math.atan2(dir[0], dir[1]) * 180) / Math.PI + 360) % 360
  const hit = groundHit(at, height, dir, ground, fallback)
  if (hit) return { x: hit.x, z: hit.z, range: hit.range, bearing, placed: 'ground' }
  const b = (bearing * Math.PI) / 180
  return { x: at[0] + Math.sin(b) * farM, z: at[1] - Math.cos(b) * farM, range: null, bearing, placed: 'bearing' }
}
