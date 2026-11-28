// course:look --drone: the local vision model looks at DJI drone footage of the
// river and writes down what's on the banks, each thing placed on the ground
// from where the drone was and where its camera pointed. look.ts runs it; the
// pure parts are lib/dji.ts (poses) and lib/drone.ts (frames, prompt, placing).
// See docs/features/game-courses-from-video.md, "Drone footage".
//
// Footage, frames and the store are personal data: frames are cut to a temp
// folder, shown only to the local model, and removed; poses and answers stay in
// the footage store outside the repo.
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { DatabaseSync } from 'node:sqlite'
import { framesFromDjmd, headingFromTrack, joinPoses, parseDjiXmp, parseDjmd, parseSrt, DEFAULT_FOCAL, type Pose } from './lib/dji'
import { DRONE_KINDS, DRONE_PROMPT, DRONE_SCHEMA, DRONE_VERSION, fieldOfView, frameTarget, parseDroneLook, pickShots, placeDroneItem, takeoffGround, type Candidate, type DroneLook, type Ground } from './lib/drone'
import { knownDroneByPath, nextDroneShot, refreshDronePresence, saveDroneClip, saveDroneLook, type DroneClip, type DronePose, type DroneShot } from './lib/footage-db'
import { chat } from './lib/ollama'
import { runDetached } from './lib/proc'
import { cumulative, locate, projection, type XZ } from './lib/river'
import { LIDAR } from '../../../../games/reading-thames/lidar.js'
import { lidarTop } from '../../../../games/reading-thames/world.js'
import READING from '../../../../games/reading-thames/courses/reading.json'

/** Frames whose middle lands this far from the river line are left out. */
export const NEAR_RIVER_M = 150
/** Coarse to fine: a frame every 60 m of what the camera looks at, then every 30 m. */
export const DRONE_SPACINGS = [60, 30]
/** The ground at take-off above the river, when the footage doesn't show it (the floodplain is a metre or two up). */
const TAKEOFF_FALLBACK = 1.5
const FRAME_W = 1280
const MAX_TOKENS = 2500

const { toXZ } = projection([51.46175, -0.96945])
const LINE = (READING as unknown as { line: XZ[] }).line
const CUM = cumulative(LINE)
const ground: Ground = (x, z) => {
  const at = lidarTop(LIDAR, x, z) as { top: number; out: number } | null
  return at && at.out === 0 ? at.top : null
}
const onRiver = (p: XZ) => locate(LINE, CUM, p)

export type Hooks = { stopping: () => boolean; setFrameDir: (d: string | null) => void }

// ---------- finding the footage ----------

type Found = { base: string; dir: string; mp4?: string; lrf?: string; srt?: string; jpg?: string }

/** DJI_* clips and photos under the folders, grouped by name (MP4, LRF and SRT of one clip together). */
export function* findDrone(dir: string): Generator<Found> {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  const here = new Map<string, Found>()
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory() && !e.name.endsWith('.fcpbundle') && !e.name.endsWith('.photoslibrary')) { yield* findDrone(p); continue }
    const m = /^(DJI_.+)\.(mp4|lrf|srt|jpg)$/i.exec(e.name)
    if (!e.isFile() || !m) continue
    const f = here.get(m[1]) ?? { base: m[1], dir }
    f[m[2].toLowerCase() as 'mp4' | 'lrf' | 'srt' | 'jpg'] = p
    here.set(m[1], f)
  }
  yield* here.values()
}

async function probe(file: string): Promise<{ width: number; height: number; duration: number; djmd: number | null }> {
  const out = (await runDetached('ffprobe', ['-v', 'error', '-show_entries', 'stream=index,codec_type,codec_tag_string,width,height:format=duration', '-of', 'json', file])).toString()
  const j = JSON.parse(out) as { streams: Array<{ index: number; codec_type: string; codec_tag_string: string; width?: number; height?: number }>; format: { duration?: string } }
  const v = j.streams.find((s) => s.codec_type === 'video' && s.width)!
  const d = j.streams.find((s) => s.codec_type === 'data' && s.codec_tag_string === 'djmd')
  return { width: v.width!, height: v.height!, duration: Number(j.format.duration ?? 0), djmd: d ? d.index : null }
}

/** The camera's angles from the clip's djmd track (empty if it has none). */
async function readGimbal(file: string, stream: number) {
  const data = await runDetached('ffmpeg', ['-v', 'error', '-i', file, '-map', `0:${stream}`, '-c', 'copy', '-f', 'data', '-'])
  const rows = (await runDetached('ffprobe', ['-v', 'error', '-select_streams', String(stream), '-show_entries', 'packet=pts_time,size', '-of', 'csv=p=0', file]))
    .toString().trim().split('\n').filter(Boolean).map((l) => l.split(','))
  return parseDjmd(data, rows.map((r) => Number(r[1])), rows.map((r) => Number(r[0])))
}

/** Every half second is plenty to keep (the drone moves smoothly). */
function thin(poses: Pose[], every = 0.5): Pose[] {
  const out: Pose[] = []
  for (const p of poses) if (!out.length || p.t - out[out.length - 1].t >= every - 1e-6) out.push(p)
  return out
}
const packPose = (p: Pose): DronePose => [+p.t.toFixed(2), p.lat, p.lng, +p.alt.toFixed(1), +p.pitch.toFixed(1), +p.yaw.toFixed(1), p.focal]
const unpack = ([t, lat, lng, alt, pitch, yaw, focal]: DronePose) => ({ t, lat, lng, alt, pitch, yaw, focal })

type Parsed = { clip: DroneClip; poses: Pose[] }

/** DJI_20240525152611_0050_D → 2024-05-25 */
const dayOf = (base: string) => { const m = /^DJI_(\d{4})(\d\d)(\d\d)/.exec(base); return m ? `${m[1]}-${m[2]}-${m[3]}` : null }

async function parseFound(f: Found): Promise<Parsed | null> {
  if (f.mp4 || f.lrf) {
    const file = (f.mp4 ?? f.lrf)!
    const p = await probe(file)
    const gimbal = p.djmd !== null ? await readGimbal(file, p.djmd) : []
    // Without an SRT, the djmd track's own positions stand in.
    const frames = f.srt ? parseSrt(fs.readFileSync(f.srt, 'utf8')) : framesFromDjmd(gimbal)
    if (!frames.length) { console.log(`skip ${path.basename(file)}: nothing says where it was (no positions in an .SRT or its DJI meta track)`); return null }
    let poses = joinPoses(frames, gimbal)
    let source: DroneClip['poseSource'] = 'djmd'
    if (!poses.length) { poses = headingFromTrack(frames); source = 'track' }
    const st = fs.statSync(file)
    return {
      poses,
      clip: {
        key: `${frames[0].clock ?? f.base}#${(frames[frames.length - 1].t).toFixed(1)}`, path: file, size: st.size, mtime: Math.round(st.mtimeMs),
        kind: f.mp4 ? 'video' : 'proxy', day: frames[0].clock?.slice(0, 10) ?? dayOf(f.base), duration: p.duration, width: p.width, height: p.height,
        poseSource: poses.length ? source : null, poses: thin(poses).map(packPose),
      },
    }
  }
  if (f.jpg) {
    // XMP sits near the start of the file.
    const fd = fs.openSync(f.jpg, 'r')
    const head = Buffer.alloc(512 * 1024)
    const n = fs.readSync(fd, head, 0, head.length, 0)
    fs.closeSync(fd)
    const x = parseDjiXmp(head.subarray(0, n).toString('latin1'))
    const st = fs.statSync(f.jpg)
    const p = await probe(f.jpg).catch(() => null)
    if (!x || !p) { console.log(`skip ${path.basename(f.jpg)}: no DJI position and gimbal angles in it`); return null }
    const pose: Pose = { t: 0, lat: x.lat, lng: x.lng, alt: x.relAlt, pitch: x.pitch, yaw: x.yaw, focal: DEFAULT_FOCAL, source: 'xmp' }
    return {
      poses: [pose],
      clip: { key: `${x.clock ?? f.base}#${st.size}`, path: f.jpg, size: st.size, mtime: Math.round(st.mtimeMs), kind: 'photo', day: x.clock?.slice(0, 10) ?? dayOf(f.base),
        duration: 0, width: p.width, height: p.height, poseSource: 'xmp', poses: [packPose(pose)] },
    }
  }
  return null // an SRT on its own: no picture to look at
}

/** The take-off ground of each day, from every pose of that day (lib/drone.ts takeoffGround). */
function groundByDay(db: DatabaseSync, extra: Parsed[]): Map<string, number> {
  const byDay = new Map<string, Array<{ alt: number; at: XZ }>>()
  const add = (day: string | null, poses: Array<{ lat: number; lng: number; alt: number }>) => {
    const list = byDay.get(day ?? '') ?? []
    for (const p of poses) list.push({ alt: p.alt, at: toXZ([p.lat, p.lng]) })
    byDay.set(day ?? '', list)
  }
  const fresh = new Set(extra.map((e) => e.clip.key))
  for (const r of db.prepare("SELECT key, day, poses FROM drone_clips WHERE poses IS NOT NULL AND kind != 'photo'").all() as Array<{ key: string; day: string | null; poses: string }>) {
    if (!fresh.has(r.key)) add(r.day, (JSON.parse(r.poses) as DronePose[]).map(unpack))
  }
  for (const e of extra) if (e.clip.kind !== 'photo') add(e.clip.day, e.clip.poses.map(unpack))
  return new Map([...byDay].map(([d, list]) => [d, takeoffGround(list, ground, TAKEOFF_FALLBACK)]))
}
const g0For = (days: Map<string, number>, day: string | null) => days.get(day ?? '') ?? TAKEOFF_FALLBACK

function fovOf(focal: number, w: number, h: number) { return fieldOfView(focal || DEFAULT_FOCAL, w, h) }

/** The frames of a clip worth showing the model. */
function shotsFor(clip: DroneClip, g0: number): DroneShot[] {
  const poses = clip.poses.map(unpack)
  const near = (p: XZ) => onRiver(p).d <= NEAR_RIVER_M
  if (clip.kind === 'photo') {
    const p = poses[0]
    const at = toXZ([p.lat, p.lng])
    const target = frameTarget(at, p.alt + g0, p, fovOf(p.focal, clip.width, clip.height), ground, g0)
    // A photo is one look: kept if it looks at the river, or was taken over or by it looking out.
    if (!(target ? near(target) : onRiver(at).d <= NEAR_RIVER_M * 2)) return []
    return [{ level: 0, n: 0, ...p }]
  }
  const cands: Candidate[] = []
  for (const p of poses) {
    if (cands.length && p.t - cands[cands.length - 1].t < 1 - 1e-6) continue // one a second
    const at = toXZ([p.lat, p.lng])
    cands.push({ t: p.t, yaw: p.yaw, target: frameTarget(at, p.alt + g0, p, fovOf(p.focal, clip.width, clip.height), ground, g0) })
  }
  const byT = new Map(poses.map((p) => [p.t, p]))
  return pickShots(cands, DRONE_SPACINGS, near).map((s) => ({ ...s, ...byT.get(s.t)!, level: s.level, n: s.n }))
}

export async function scanDrone(db: DatabaseSync, roots: string[], hooks: Hooks) {
  const known = knownDroneByPath(db)
  const parsed: Parsed[] = []
  let alone = 0
  for (const root of roots) {
    for (const f of findDrone(root)) {
      if (hooks.stopping()) return
      const file = f.mp4 ?? f.lrf ?? f.jpg
      if (!file) { alone++; continue }
      const st = fs.statSync(file)
      const k = known.get(file)
      if (k && k.size === st.size && k.mtime === Math.round(st.mtimeMs)) continue
      try {
        const p = await parseFound(f)
        if (p) parsed.push(p)
      } catch (e) {
        if (hooks.stopping()) return
        console.log(`skip ${file}: ${(e as Error).message.split('\n')[0]}`)
      }
    }
  }
  const days = groundByDay(db, parsed)
  let shots = 0
  for (const p of parsed) {
    const list = p.clip.poses.length ? shotsFor(p.clip, g0For(days, p.clip.day)) : []
    const saved = saveDroneClip(db, p.clip, list)
    if (saved.skipped) { console.log(`skip ${p.clip.path}: the same clip is already indexed at another path`); continue }
    shots += list.length
    console.log(`${path.basename(p.clip.path)}: ${p.clip.kind}, ${p.clip.kind === 'photo' ? '' : `${p.clip.duration.toFixed(0)} s, `}camera from ${p.clip.poseSource ?? 'nothing'}, ${list.length} frames to look at`)
  }
  refreshDronePresence(db)
  console.log(`${parsed.length} new or changed drone clips and photos, ${shots} frames${alone ? `; ${alone} SRTs with no video beside them (nothing to look at)` : ''}`)
}

// ---------- looking ----------

async function cutFrame(path_: string, kind: string, t: number, hooks: Hooks): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'look-drone-'))
  hooks.setFrameDir(dir)
  try {
    const out = path.join(dir, 'f.jpg')
    const seek = kind === 'photo' ? [] : ['-ss', t.toFixed(3)]
    await runDetached('ffmpeg', ['-v', 'error', '-y', ...seek, '-i', path_, '-frames:v', '1', '-vf', `scale=${FRAME_W}:-2`, '-q:v', '3', out])
    return fs.readFileSync(out).toString('base64')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
    hooks.setFrameDir(null)
  }
}

async function ask(endpoint: string, model: string, image: string): Promise<{ look: DroneLook | null; raw: string }> {
  let raw = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    raw = await chat(endpoint, {
      model, format: DRONE_SCHEMA, keep_alive: '30m', options: { temperature: 0, num_predict: MAX_TOKENS },
      messages: [{ role: 'user', content: DRONE_PROMPT, images: [image] }],
    })
    const look = parseDroneLook(raw)
    if (look) return { look, raw }
  }
  return { look: null, raw }
}

export async function lookDrone(db: DatabaseSync, endpoint: string, model: string, until: number, hooks: Hooks) {
  console.log(`looking at drone footage with ${model} at ${endpoint}`)
  const uncuttable: number[] = []
  const started = Date.now()
  let n = 0
  for (let s = nextDroneShot(db, model, DRONE_VERSION, uncuttable); s && !hooks.stopping() && Date.now() < until; s = nextDroneShot(db, model, DRONE_VERSION, uncuttable)) {
    if (!fs.existsSync(s.path)) { refreshDronePresence(db); continue }
    let image: string
    try { image = await cutFrame(s.path, s.kind, s.t, hooks) } catch (e) {
      if (hooks.stopping()) break
      console.log(`  couldn't cut ${path.basename(s.path)} at ${s.t.toFixed(1)} s: ${(e as Error).message.split('\n')[0]}`)
      uncuttable.push(s.id)
      continue
    }
    const t0 = Date.now()
    const { look, raw } = await ask(endpoint, model, image)
    saveDroneLook(db, s.id, model, DRONE_VERSION, { ok: !!look, scene: look?.scene, items: look?.items, raw, ms: Date.now() - t0 })
    n++
    console.log(`${path.basename(s.path)} ${s.kind === 'photo' ? '' : `${s.t.toFixed(0)} s `}level ${s.level}: ${look ? `${look.items.length} things` : 'no usable answer'}; ${n} frames this run, ${((Date.now() - started) / n / 1000).toFixed(0)} s each`)
  }
  if (!hooks.stopping() && !nextDroneShot(db, model, DRONE_VERSION)) console.log('every drone frame has been looked at')
}

// ---------- reporting ----------

export function droneStatus(db: DatabaseSync, model: string) {
  const rows = db.prepare(`SELECT c.path, c.kind, c.status, c.pose_source, s.level, count(s.id) AS shots,
      count(CASE WHEN EXISTS (SELECT 1 FROM drone_looks l WHERE l.shot_id = s.id AND l.model = ? AND l.prompt_version = ?) THEN 1 END) AS done
    FROM drone_clips c LEFT JOIN drone_shots s ON s.clip_id = c.id GROUP BY c.id, s.level ORDER BY c.path, s.level`)
    .all(model, DRONE_VERSION) as Array<{ path: string; kind: string; status: string; pose_source: string | null; level: number | null; shots: number; done: number }>
  let last = ''
  let left = 0
  for (const r of rows) {
    if (r.path !== last) { console.log(`${r.path}  ${r.kind} ${r.status}${r.pose_source ? `  camera from ${r.pose_source}` : ''}`); last = r.path }
    if (r.level !== null) { console.log(`    level ${r.level}: ${r.done}/${r.shots}`); left += r.shots - r.done }
  }
  const looks = db.prepare('SELECT avg(ms) AS ms, count(*) AS n, sum(ok = 0) AS failed FROM drone_looks WHERE model = ? AND prompt_version = ?').get(model, DRONE_VERSION) as { ms: number | null; n: number; failed: number | null }
  const items = db.prepare('SELECT count(*) AS n FROM drone_items i JOIN drone_looks l ON l.id = i.look_id WHERE l.model = ? AND l.prompt_version = ?').get(model, DRONE_VERSION) as { n: number }
  console.log(`\n${model}: ${looks.n} drone frames looked at (${looks.failed ?? 0} without a usable answer), ${items.n} things seen` +
    (looks.ms ? `, ${(looks.ms / 1000).toFixed(0)} s a frame, about ${((left * looks.ms) / 3_600_000).toFixed(1)} h to go` : ''))
}

/** Everything the model saw in the drone footage, placed on the ground, as GeoJSON features (personal data: see look.ts --export). */
export function droneFeatures(db: DatabaseSync, model: string) {
  const days = groundByDay(db, [])
  const { toLatLng } = projection([51.46175, -0.96945])
  const rows = db.prepare(`SELECT i.kind, i.detail, i.walls, i.roof, i.storeys, i.features, i.x, i.y, i.sure,
      s.t, s.lat, s.lng, s.alt, s.pitch, s.yaw, s.focal, s.level, c.path, c.kind AS clip_kind, c.day, c.width, c.height, c.pose_source
    FROM drone_items i JOIN drone_looks l ON l.id = i.look_id JOIN drone_shots s ON s.id = l.shot_id JOIN drone_clips c ON c.id = s.clip_id
    WHERE l.model = ? AND l.prompt_version = ?`).all(model, DRONE_VERSION) as Array<Record<string, number | string | null>>
  return rows.map((r) => {
    const g0 = g0For(days, r.day as string | null)
    const at = toXZ([r.lat as number, r.lng as number])
    const fov = fovOf(r.focal as number, r.width as number, r.height as number)
    const p = placeDroneItem(at, (r.alt as number) + g0, { pitch: r.pitch as number, yaw: r.yaw as number }, fov, { x: r.x as number, y: r.y as number }, ground, g0)
    const [lat, lng] = toLatLng([p.x, p.z])
    const on = onRiver([p.x, p.z])
    return {
      type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [+lng.toFixed(6), +lat.toFixed(6)] },
      properties: {
        source: 'drone', kind: r.kind as string, detail: r.detail, walls: r.walls, roof: r.roof, storeys: r.storeys, features: r.features, sure: !!r.sure,
        placed: p.placed, range: p.range === null ? null : Math.round(p.range), bearing: Math.round(p.bearing),
        x: +p.x.toFixed(1), z: +p.z.toFixed(1), s: Math.round(on.s), offset: Math.round(on.lateral), fromLine: Math.round(on.d),
        clip: path.basename(r.path as string), kindOfClip: r.clip_kind, t: r.t, level: r.level, alt: r.alt, pitch: r.pitch, camera: r.pose_source,
      },
    }
  })
}

export { DRONE_KINDS }
