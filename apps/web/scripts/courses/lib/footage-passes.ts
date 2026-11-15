// Every pass the owner's cameras made near a point, with what the reference
// views and the materials run need to cut a picture from it: which way the boat
// was going, which way the camera faced, the local hour. Reads the course:look
// store (footage-db.ts); the pure parts are in here.ts and views.ts.
import path from 'path'
import type { DatabaseSync } from 'node:sqlite'
import { eacGraph, eacLayout, flatView } from './eac'
import { HERE_VIEW, lensYaw, oneAcrossChapters, passesNear } from './here'
import { runDetached } from './proc'
import { cameraYawOf, headingAt } from './views'

export type Clip = { id: number; path: string; recording: string | null; startUtc: string | null; cameraYaw: number | null; width: number; height: number; rows: number[][] }

export function loadClips(db: DatabaseSync): Clip[] {
  const rows = db.prepare("SELECT id, path, recording, start_utc AS startUtc, camera_yaw AS cameraYaw, width, height, track FROM chapters WHERE status = 'ok' AND track IS NOT NULL").all() as Array<Omit<Clip, 'rows'> & { track: string }>
  return rows.map(({ track, ...c }) => ({ ...c, rows: JSON.parse(track) as number[][] }))
}

const hourOf = (c: Clip, ft: number) => c.startUtc ? Number(new Date(Date.parse(c.startUtc) + ft * 1000).toLocaleString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false })) : 12

/** The passes within `metres` of a point, one per crossing (a pass split across a clip's end counts once). */
export function passesAt(clips: Clip[], at: { lat: number; lng: number }, metres: number) {
  return oneAcrossChapters(clips.flatMap((c) => passesNear(c.rows, at, metres).map((p) => ({
    ...p, c, recording: `${path.dirname(c.path)}|${c.recording ?? c.id}`, t: c.startUtc ? Date.parse(c.startUtc) + p.ft * 1000 : c.id * 1e13 + p.ft * 1000,
    cameraKnown: c.cameraYaw != null, cameraYaw: cameraYawOf(c.cameraYaw, path.basename(path.dirname(c.path))), hour: hourOf(c, p.ft), heading: headingAt(c.rows, p.ft),
  }))))
}

/** Cut one flat view from a clip at `ft`, turned `fromBow` degrees from the bow, `hFov` wide (the height in proportion), to `file`. */
export async function cutView(c: Clip, ft: number, cameraYaw: number, fromBow: number, file: string, hFov = HERE_VIEW.hFov, width = HERE_VIEW.w, height = HERE_VIEW.h) {
  const vFov = (2 * Math.atan(Math.tan((hFov * Math.PI) / 360) * (height / width)) * 180) / Math.PI
  await runDetached('ffmpeg', ['-v', 'error', '-y', '-ss', ft.toFixed(2), '-i', c.path, '-filter_complex',
    eacGraph(eacLayout(c.width, c.height), 1) + flatView(0, 'v', { hFov, vFov, w: width, h: height, pitch: 0, yaw: lensYaw(fromBow, cameraYaw) }),
    '-map', '[v]', '-frames:v', '1', '-q:v', '2', file])
}
