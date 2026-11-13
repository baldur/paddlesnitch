// Looking carefully inside the areas the owner draws on River Explorer's map
// (course:look --areas): closer views, and a prompt that asks only for the
// things this exact place could be recognised by. Pure; tested in landmarks.test.ts.
import type { Distance } from './look'

/**
 * Kept apart from the general looks' PROMPT_VERSION (look.ts): a careful look is
 * stored as a look with this version, so neither run ever redoes the other's.
 * Bump when the prompt or schema changes.
 */
export const LANDMARK_VERSION = 103

/** Eight views of 60°, overlapping by 15°: twice the detail of the general look's 100° views. */
export const LANDMARK_VIEWS = [0, 45, 90, 135, 180, 225, 270, 315].map((yaw) => ({ name: `l${yaw}`, yaw }))
const VIEW_W = 1024
const VIEW_H = 640
export const LANDMARK_VIEW = { hFov: 60, vFov: 2 * Math.atan(Math.tan((30 * Math.PI) / 180) * (640 / 1024)) * (180 / Math.PI), w: 1024, h: 640, pitch: 5 }

/** By default an area is looked at every 25 m (levels 0–2) on every pass through it. */
export const AREA_LEVELS = 3

const DISTANCES = ['near', 'mid', 'far'] as const

/** Fixed things only: no people, animals or boats, so the model can't file them here. */
export const LANDMARK_KINDS = [
  'house', 'flats', 'boathouse', 'clubhouse', 'pub-restaurant', 'church', 'other-building',
  'bridge', 'lock', 'weir', 'jetty', 'pontoon', 'slipway', 'steps', 'wall', 'sign', 'statue', 'tree', 'other',
] as const
export type LandmarkKind = (typeof LANDMARK_KINDS)[number]
export const MAX_LANDMARKS = 12

export const LANDMARK_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      maxItems: MAX_LANDMARKS,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 60 },
          kind: { type: 'string', enum: LANDMARK_KINDS },
          detail: { type: 'string', maxLength: 200 },
          box: {
            type: 'object',
            properties: { x0: { type: 'number' }, y0: { type: 'number' }, x1: { type: 'number' }, y1: { type: 'number' } },
            required: ['x0', 'y0', 'x1', 'y1'],
          },
          distance: { type: 'string', enum: DISTANCES },
          sure: { type: 'boolean' },
        },
        required: ['name', 'kind', 'detail', 'box', 'distance', 'sure'],
      },
    },
  },
  required: ['items'],
} as const

export const LANDMARK_PROMPT = `This is one view from a 360 camera fixed to a small boat on a river.
List only the fixed things someone could recognise this exact place by: buildings with something distinctive (shape, colour, material, a name), bridges, locks, weirs, boathouses and clubs, pubs, churches, signs with readable text, jetties, slipways, statues, an unusual tree, and similar.
Leave out all boats, moored or moving: a moored boat is not a boathouse. Leave out people, animals, ordinary trees and grass, the water, and the camera's own boat. Don't guess at things you can't see: call a bridge a railway bridge only if you can see track or a train.
List only what you can clearly see. An empty list is a good answer when nothing stands out: fewer and right is better than many.

For each thing:
- name: what someone would call it, under 8 words, e.g. "white boathouse with green doors";
- kind: one of ${LANDMARK_KINDS.join(', ')};
- detail: what makes it recognisable, under 30 words: colours, materials, roof, storeys, windows, and a sign's text if it names a place, a club or a business, or is a warning;
- box: its outline in the picture: x0, y0 its top-left corner and x1, y1 its bottom-right, as fractions of the picture's width and height from its top-left;
- distance: near (under 15 m), mid (15 to 50 m) or far (over 50 m);
- sure: true only if you are certain it is there and what it is.
Never write a boat's name or anything that identifies a person.`

export type Landmark = { name: string; kind: LandmarkKind; detail: string; x0: number; y0: number; x1: number; y1: number; distance: Distance; sure: boolean }

const text = (s: unknown, n: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '')
const num = (v: unknown) => (Number.isFinite(v) ? (v as number) : null)
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
// The model sometimes fills a slot with something it didn't see. Only the whole name, so "No 1 Boathouse" stays.
const NOT_SEEN = /^(none|nothing|n\/a|not (visible|present|seen)|none visible|no (landmarks?|distinctive \w+))\.?$/i

/** The model's reply as landmarks, or null if it isn't an answer. Boxes are put the right way round; empty or unusable ones are dropped. */
export function parseLandmarks(raw: string): Landmark[] | null {
  let j: Record<string, unknown>
  try { j = JSON.parse(raw) } catch { return null }
  if (!j || typeof j !== 'object' || !Array.isArray(j.items)) return null
  const out: Landmark[] = []
  const seen = new Set<string>()
  for (const i of j.items as Array<Record<string, unknown>>) {
    if (!i || typeof i !== 'object') continue
    const name = text(i.name, 60)
    const detail = text(i.detail, 200)
    if (!name || NOT_SEEN.test(name)) continue
    const b = (i.box ?? {}) as Record<string, unknown>
    let [ax, ay, bx, by] = [num(b.x0), num(b.y0), num(b.x1), num(b.y1)]
    if (ax === null || ay === null || bx === null || by === null) continue
    // Qwen2.5-VL often answers in pixels of the 1024×640 picture, whatever it's asked.
    if (Math.max(ax, bx, ay, by) > 1.5) { ax /= VIEW_W; bx /= VIEW_W; ay /= VIEW_H; by /= VIEW_H }
    ;[ax, ay, bx, by] = [ax, ay, bx, by].map(clamp01)
    const box = { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) }
    if (box.x1 - box.x0 < 0.005 || box.y1 - box.y0 < 0.005) continue
    const key = `${name.toLowerCase()}|${box.x0.toFixed(2)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      name, detail, ...box,
      kind: (LANDMARK_KINDS as readonly string[]).includes(i.kind as string) ? (i.kind as LandmarkKind) : 'other',
      distance: (DISTANCES as readonly string[]).includes(i.distance as string) ? (i.distance as Distance) : 'mid',
      sure: i.sure === true,
    })
  }
  return out
}

export type Area = { south: number; west: number; north: number; east: number }

/** A drawn rectangle's corners in any order, as an area; null if it has no size. */
export function areaFrom(a: { lat: number; lng: number }, b: { lat: number; lng: number }): Area | null {
  const r = { south: Math.min(a.lat, b.lat), north: Math.max(a.lat, b.lat), west: Math.min(a.lng, b.lng), east: Math.max(a.lng, b.lng) }
  return r.north > r.south && r.east > r.west ? r : null
}

export const inArea = (p: { lat: number; lng: number }, a: Area) => p.lat >= a.south && p.lat <= a.north && p.lng >= a.west && p.lng <= a.east
