// "Footage here" in River Explorer: every pass the camera made near a point on
// the map, and the pictures from it at about the camera's own sharpness, for
// making the game look like the real place. No model. Pure; tested in here.test.ts.
import { haversine } from './stations'

/** How far from the clicked point a pass may be, in metres. The page offers these. */
export const HERE_RADII = [10, 20, 30] as const
export const HERE_RADIUS = 20

/** A pass's four flat views, named from the bow, left to right as the page shows them. */
export const HERE_DIRS = [
  { name: 'left', fromBow: 270 },
  { name: 'ahead', fromBow: 0 },
  { name: 'right', fromBow: 90 },
  { name: 'behind', fromBow: 180 },
] as const
export type HereDir = (typeof HERE_DIRS)[number]['name'] | '360'
export const HERE_NAMES: readonly HereDir[] = [...HERE_DIRS.map((d) => d.name), '360']

/**
 * 90° views, 1536 px wide: about 17 px a degree, the camera's own ~15 (a 1344 px
 * cube face covers 90°), so as sharp as the footage allows without inventing pixels.
 */
export const HERE_VIEW = { hFov: 90, vFov: 2 * Math.atan(Math.tan(Math.PI / 4) * (960 / 1536)) * (180 / Math.PI), w: 1536, h: 960, pitch: 0 }
/** The whole sphere as one equirectangular picture, ahead in the middle. */
export const HERE_PANO = { w: 4096, h: 2048 }

/** At most this many passes are listed: the closest ones. */
export const MAX_PASSES = 40

export type Pass = { ft: number; lat: number; lng: number; metres: number }

/**
 * Each time a track goes within `metres` of `at`: a run of fixes inside the
 * circle, broken where the camera was off for more than `gap` seconds. Each pass
 * is its closest fix. Track rows are [ft, lat, lng, …], in time order.
 */
export function passesNear(track: number[][], at: { lat: number; lng: number }, metres: number, gap = 30): Pass[] {
  const passes: Pass[] = []
  let best: Pass | null = null
  let lastFt = -Infinity
  for (const [ft, lat, lng] of track) {
    const m = haversine({ lat, lng }, at)
    if (m > metres || ft - lastFt > gap) {
      if (best) passes.push(best)
      best = null
    }
    if (m <= metres) {
      if (!best || m < best.metres) best = { ft, lat, lng, metres: m }
      lastFt = ft
    }
  }
  if (best) passes.push(best)
  return passes
}

/**
 * The camera splits a recording into chapters, so one pass across a chapter's
 * end is found in both: passes of the same recording less than `within` ms
 * apart are one, and the closer is kept. `t` is the pass's time of day in ms.
 */
export function oneAcrossChapters<T extends { recording: string; t: number; metres: number }>(passes: T[], within = 60_000): T[] {
  const kept: T[] = []
  for (const p of [...passes].sort((a, b) => a.metres - b.metres)) {
    if (!kept.some((k) => k.recording === p.recording && Math.abs(k.t - p.t) < within)) kept.push(p)
  }
  return kept
}

/** Which way the camera's lens looks for a view `fromBow` degrees round from the bow, 0–359. */
export const lensYaw = (fromBow: number, cameraYaw: number) => ((((fromBow + cameraYaw) % 360) + 360) % 360)

/** A frame's time in a clip as a whole number of tenths of a second, as the picture's address carries it. */
export const tenths = (ft: number) => Math.max(0, Math.round(ft * 10))
