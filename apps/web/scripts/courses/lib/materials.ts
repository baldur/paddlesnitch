// What the Reading game's buildings are made of, from the owner's footage: for
// each building near the water, a view cut from a pass that faces it, asked of
// a local vision model (wall and roof colour and material), and the answers
// combined per building. Only those derived attributes go in the game. Pure;
// tested in materials.test.ts. See course:materials.
import type { XZ } from './river'

export const WALLS = ['brick', 'render', 'timber', 'stone', 'other'] as const
export const ROOFS = ['tile', 'slate', 'metal', 'flat', 'other'] as const
export type Wall = (typeof WALLS)[number]
export type Roof = (typeof ROOFS)[number]
export type Answer = { visible: boolean; wallColour: string; wall: Wall; roofColour: string | null; roof: Roof | null }

/** Bump when the prompt or the views change: answers to an older one are asked again. */
export const PROMPT_VERSION = 2
export const PROMPT = `This photo was taken from a small boat on the River Thames. The camera is pointed at one building on land, in the middle of the photo.
A boat is not a building: if a moored boat, trees or a fence fill the middle, or there's no building there, answer visible false.
Otherwise give its main wall colour as a hex code, what its walls are mostly made of (brick, render for painted or rendered walls, timber for weatherboarding or wood, stone, or other), and, if you can see its roof, the roof colour as a hex code and what the roof is (tile, slate, metal, flat, or other). Use null for the roof if it can't be seen.
Answer only as JSON.`

export const SCHEMA = {
  type: 'object',
  properties: {
    visible: { type: 'boolean' },
    wall_colour: { type: 'string' },
    wall_material: { type: 'string', enum: [...WALLS] },
    roof_colour: { type: ['string', 'null'] },
    roof_material: { type: ['string', 'null'], enum: [...ROOFS, null] },
  },
  required: ['visible', 'wall_colour', 'wall_material', 'roof_colour', 'roof_material'],
}

const HEX = /^#[0-9a-f]{6}$/i

/** A reply, or null if it isn't one. */
export function parseAnswer(raw: string): Answer | null {
  let j: Record<string, unknown>
  try { j = JSON.parse(raw) } catch { return null }
  if (typeof j?.visible !== 'boolean') return null
  if (!j.visible) return { visible: false, wallColour: '', wall: 'other', roofColour: null, roof: null }
  if (typeof j.wall_colour !== 'string' || !HEX.test(j.wall_colour) || !WALLS.includes(j.wall_material as Wall)) return null
  const roofColour = typeof j.roof_colour === 'string' && HEX.test(j.roof_colour) ? j.roof_colour.toLowerCase() : null
  const roof = ROOFS.includes(j.roof_material as Roof) ? (j.roof_material as Roof) : null
  return { visible: true, wallColour: j.wall_colour.toLowerCase(), wall: j.wall_material as Wall, roofColour, roof }
}

/**
 * Where to look from a pass: the turn from the bow (degrees, clockwise) to the
 * building's middle, and a field of view that takes in its footprint with room
 * round it (30°–90°). Null when the pass is too near to see it whole or too far.
 */
export function aimAt(eye: XZ, heading: number, ring: XZ[]): { fromBow: number; hFov: number; metres: number } | null {
  const c: XZ = [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length]
  const metres = Math.hypot(c[0] - eye[0], c[1] - eye[1])
  if (metres < 15 || metres > 70) return null // (nearer, a boat moored at the bank filled the view)
  const want = (Math.atan2(c[0] - eye[0], -(c[1] - eye[1])) * 180) / Math.PI
  // The footprint's widest angle as seen from the eye.
  const angles = ring.map(([x, z]) => (Math.atan2(x - eye[0], -(z - eye[1])) * 180) / Math.PI - want).map((a) => ((a % 360) + 540) % 360 - 180)
  const span = Math.max(...angles) - Math.min(...angles)
  return { fromBow: ((((want - heading) % 360) + 360) % 360), hFov: Math.max(30, Math.min(90, span * 1.6)), metres }
}

/**
 * One building's answers combined: the commonest wall and each colour's middle
 * (per channel); a roof only where two views agree on it (one view's roof was
 * often sky or a balcony); null with nothing seen.
 */
export function combine(answers: Answer[]): Omit<Answer, 'visible'> | null {
  const seen = answers.filter((a) => a.visible)
  if (!seen.length) return null
  const mode = <T>(v: T[]): T => { const n = new Map<T, number>(); for (const x of v) n.set(x, (n.get(x) ?? 0) + 1); return [...n.entries()].sort((a, b) => b[1] - a[1])[0][0] }
  const middle = (hexes: string[]) => {
    const ch = (k: number) => { const v = hexes.map((h) => parseInt(h.slice(1 + 2 * k, 3 + 2 * k), 16)).sort((a, b) => a - b); return v[Math.floor((v.length - 1) / 2)] }
    return `#${[0, 1, 2].map((k) => ch(k).toString(16).padStart(2, '0')).join('')}`
  }
  const roofs = seen.filter((a) => a.roof && a.roofColour)
  const roof = roofs.length ? mode(roofs.map((a) => a.roof!)) : null
  const agreed = roofs.filter((a) => a.roof === roof)
  return { wall: mode(seen.map((a) => a.wall)), wallColour: middle(seen.map((a) => a.wallColour)), roof: agreed.length >= 2 ? roof : null, roofColour: agreed.length >= 2 ? middle(agreed.map((a) => a.roofColour!)) : null }
}

/** games/reading-thames/materials.js: per building, by the middle of its footprint. */
export function materialsModule(rows: Array<[number, number, string, Wall, string | null, Roof | null]>): string {
  return `// What the Reading river's plain buildings are made of, worked out from the
// owner's footage by a local vision model: by the middle of each footprint
// (x, z), the wall colour and material, and the roof colour and material (null
// where none was seen). Only these answers are here, never a picture. Made by
// \`pnpm --filter web course:materials\` (apps/web/scripts/courses/materials.ts).
export const MATERIALS = ${JSON.stringify(rows)};
`
}
