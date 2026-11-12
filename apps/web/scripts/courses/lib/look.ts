// What a vision model is asked about each view of the river, how its answer is
// checked, and how the answers are turned into places. Pure; tested in look.test.ts.
//
// Answers are stored against the camera's own angle (`viewYaw`, degrees from the
// lens), not the boat's. Which way the camera faced on the boat is worked out
// later from the answers themselves (`decideCameraYaw`) or set by hand, and only
// then turned into compass bearings, so a wrong guess never wastes model time.

import { destination } from './stations'

/** Bump when the prompt or schema changes: looks are kept per version. */
export const PROMPT_VERSION = 2

/** Four views round the lens, wide enough to overlap. */
export const VIEWS = [
  { name: 'v0', yaw: 0 }, { name: 'v90', yaw: 90 }, { name: 'v180', yaw: 180 }, { name: 'v270', yaw: 270 },
] as const
export const VIEW = { hFov: 100, vFov: 62, w: 1024, h: 640, pitch: 5 }

// The things the game can use, named the way the course files name them where
// they overlap (docs/features/game-courses-from-video.md, observations).
export const KINDS = [
  'trees', 'willow', 'reeds', 'scrub', 'grass-bank', 'garden', 'park', 'field', 'wood',
  'wall', 'steps', 'pontoon', 'jetty', 'beach', 'slipway', 'path', 'fence', 'bench', 'lamp-post',
  'house', 'flats', 'boathouse', 'clubhouse', 'pub-restaurant', 'church', 'industrial', 'other-building',
  'bridge', 'lock', 'weir', 'railway', 'road',
  'moored-narrowboat', 'moored-cruiser', 'moored-other', 'moving-narrowboat', 'moving-cruiser', 'trip-boat',
  'rowing-boat', 'kayak-canoe', 'paddleboard', 'dinghy-sail', 'buoy', 'posts', 'sign',
  'person', 'angler', 'swan', 'duck', 'goose', 'heron', 'gull', 'other-bird', 'dog', 'cattle-horse',
  'lily-pads', 'floating-debris', 'other',
] as const
export type Kind = (typeof KINDS)[number]
const DISTANCES = ['near', 'mid', 'far'] as const
const WATER = ['flat', 'ripples', 'choppy', 'wake', 'unknown'] as const
const LIGHT = ['sun', 'bright-cloud', 'overcast', 'rain', 'dusk', 'unknown'] as const
const PERSON = ['back', 'face', 'none'] as const
const PROPULSION = ['paddle', 'oars', 'none'] as const

export const MAX_ITEMS = 30

/** The JSON schema Ollama holds the model's answer to (`format`). */
export const SCHEMA = {
  type: 'object',
  properties: {
    scene: { type: 'string', maxLength: 200 },
    water: { type: 'string', enum: WATER },
    light: { type: 'string', enum: LIGHT },
    own: {
      type: 'object',
      properties: { person: { type: 'string', enum: PERSON }, propulsion: { type: 'string', enum: PROPULSION } },
      required: ['person', 'propulsion'],
    },
    // A cap the model can't talk past: without it a reply can repeat one item until it's cut off.
    items: {
      type: 'array',
      maxItems: MAX_ITEMS,
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: KINDS },
          detail: { type: 'string', maxLength: 120 },
          x: { type: 'number' },
          distance: { type: 'string', enum: DISTANCES },
          count: { type: 'integer' },
        },
        required: ['kind', 'detail', 'x', 'distance', 'count'],
      },
    },
  },
  required: ['scene', 'water', 'light', 'own', 'items'],
} as const

export const PROMPT = `This is one view from a 360 camera fixed to a small boat on a river or canal.
Describe it for a game artist who will rebuild this river.

- scene: one sentence about this stretch (under 25 words).
- water and light: the water's surface and the weather.
- own: the person in this boat, if they are close in the foreground: do you see their back or their face, and do they use a paddle or oars? "none" if they aren't in view.
- items: everything else worth modelling, one entry per thing or group of the same thing:
  - kind: from the list;
  - detail: what makes it recognisable, under 15 words: type of tree, colours, materials, roof shape, how many storeys, what people or animals are doing;
  - x: where its centre is across the picture, 0 the left edge, 1 the right edge;
  - distance: near (under 15 m), mid (15 to 50 m) or far;
  - count: how many.
Leave out the camera's own boat. Never write a boat's name or anything that identifies a person. Signs: give their text only if it is a place, a club or a warning.`

export type Distance = (typeof DISTANCES)[number]
export type Item = { kind: Kind; detail: string; x: number; distance: Distance; count: number }
export type Look = {
  scene: string
  water: (typeof WATER)[number]
  light: (typeof LIGHT)[number]
  own: { person: (typeof PERSON)[number]; propulsion: (typeof PROPULSION)[number] }
  items: Item[]
}

const pick = <T extends readonly string[]>(list: T, v: unknown, fallback: T[number]): T[number] =>
  (list as readonly string[]).includes(v as string) ? (v as T[number]) : fallback
const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.trim().slice(0, n) : '')
// The model sometimes fills a slot with something it didn't see ("sign: none visible").
const NOT_SEEN = /^(none|no |not (visible|present|seen)|n\/a)/i

/** The model's reply as a Look, or null if it isn't one. Out-of-range values are clamped, unknown kinds become 'other'. */
export function parseLook(text: string): Look | null {
  let j: Record<string, unknown>
  try { j = JSON.parse(text) } catch { return null }
  if (!j || typeof j !== 'object' || !Array.isArray(j.items)) return null
  const own = (j.own ?? {}) as Record<string, unknown>
  return {
    scene: clip(j.scene, 300),
    water: pick(WATER, j.water, 'unknown'),
    light: pick(LIGHT, j.light, 'unknown'),
    own: { person: pick(PERSON, own.person, 'none'), propulsion: pick(PROPULSION, own.propulsion, 'none') },
    items: dedupe((j.items as Array<Record<string, unknown>>).filter((i) => i && typeof i === 'object' && !NOT_SEEN.test(clip(i.detail, 200))).map((i) => ({
      kind: pick(KINDS, i.kind, 'other'),
      detail: clip(i.detail, 200),
      x: Number.isFinite(i.x) ? Math.min(1, Math.max(0, i.x as number)) : 0.5,
      distance: pick(DISTANCES, i.distance, 'mid'),
      count: Number.isFinite(i.count) ? Math.max(1, Math.round(i.count as number)) : 1,
    }))),
  }
}

/** The same entry written twice (a model repeating itself) counts once. */
function dedupe(items: Item[]): Item[] {
  const seen = new Set<string>()
  return items.filter((i) => { const k = JSON.stringify(i); if (seen.has(k)) return false; seen.add(k); return true })
}

/**
 * Which way the lens faced, in degrees from the bow, from the views that saw the
 * paddler. A paddler faces the bow, so their back is towards the bow; a rower
 * faces the stern. Null until at least 3 views agree with 3 in 4 of the votes.
 */
export function decideCameraYaw(seen: Array<{ viewYaw: number; person: Look['own']['person']; propulsion: Look['own']['propulsion'] }>): number | null {
  const votes = new Map<number, number>()
  for (const s of seen) {
    if (s.person === 'none' || s.propulsion === 'none') continue
    const towardsBow = (s.person === 'back') === (s.propulsion === 'paddle')
    const bow = (((s.viewYaw + (towardsBow ? 0 : 180)) % 360) + 360) % 360
    votes.set(bow, (votes.get(bow) ?? 0) + 1)
  }
  const total = [...votes.values()].reduce((a, b) => a + b, 0)
  const [best, n] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0] ?? [0, 0]
  return n >= 3 && n / total >= 0.75 ? best : null
}

/** Rough metres for each distance band, for placing things on a map. */
export const BAND_M: Record<Distance, number> = { near: 8, mid: 30, far: 80 }

/**
 * Where an item is: its compass bearing from the camera and a point that far
 * along it. `cameraYaw` follows course.json: the view at lens angle
 * `cameraYaw + a` looks `a` degrees from the bow.
 */
export function placeItem(at: { lat: number; lng: number; heading: number }, viewYaw: number, cameraYaw: number, item: Pick<Item, 'x' | 'distance'>) {
  const half = (VIEW.hFov / 2) * (Math.PI / 180)
  const offset = (Math.atan((item.x - 0.5) * 2 * Math.tan(half)) * 180) / Math.PI
  const fromBow = viewYaw - cameraYaw + offset
  const compass = (((at.heading + fromBow) % 360) + 360) % 360
  return { bearing: compass, ...destination(at, compass, BAND_M[item.distance]) }
}
