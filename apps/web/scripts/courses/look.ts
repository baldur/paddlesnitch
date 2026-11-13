#!/usr/bin/env node
// A local vision model looks at all the 360 footage on this machine and writes
// down everything along the river, place by place. Stop it any time; run it
// again and it carries on where it left off.
//
//   pnpm --filter web course:look [folders…]   find *.360 (default ~/Movies), then look until stopped
//       --model qwen2.5vl:32b   a local Ollama model (PADDLESNITCH_OLLAMA, default localhost:11434)
//       --levels 4              a look every 100 m, then 50, 25, 12.5 m (--base sets 100 for a new store)
//       --minutes 60            stop after this long
//       --scan                  only find and index the footage
//       --areas                 look carefully, only inside the areas drawn on River Explorer's map
//                               (every 25 m on every pass, 8 closer views, only things that identify the place)
//   pnpm --filter web course:look --status [--areas]   how far it has got
//   pnpm --filter web course:look --export [f]   everything seen, placed, as GeoJSON (outside any repo)
//
// Ctrl+C finishes the spot it's on and stops; twice stops at once (that spot is
// redone next time). The store (lib/footage-db.ts) is outside the repo and holds
// the owner's tracks. See docs/features/game-courses-from-video.md,
// "Looking with a local model".
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { DatabaseSync } from 'node:sqlite'
import { eacGraph, eacLayout, flatView } from './lib/eac'
import { assertOutsideRepo, cameraOverrides, ensureStations, knownByPath, nextStation, openStore, refreshPresence, saveClip, saveLook, setCameraYaw, STORE, storedSpacing, takeLock, spotSpacing, type Next } from './lib/footage-db'
import { decideCameraYaw, KINDS, parseLook, placeItem, PROMPT, PROMPT_VERSION, SCHEMA, VIEW, VIEWS, type Look } from './lib/look'
import { AREA_LEVELS, inArea, LANDMARK_PROMPT, LANDMARK_SCHEMA, LANDMARK_VERSION, LANDMARK_VIEW, LANDMARK_VIEWS, parseLandmarks, type Area, type Landmark } from './lib/landmarks'
import { parseLookArgs } from './lib/look-args'
import { assertLocalModel, chat, checkOllama, ollamaEndpoint, OllamaDown } from './lib/ollama'
import { killRunning, runDetached } from './lib/proc'
import { probeVideo, readChapterFixes } from './lib/telemetry'

/** A refusal or a setup problem: one line, not a stack trace. */
function fail(e: unknown): never {
  console.error(`stopped: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
const args = (() => { try { return parseLookArgs(process.argv.slice(2), (p) => path.resolve(process.env.INIT_CWD ?? process.cwd(), p)) } catch (e) { fail(e) } })()
const ASSUMED_YAW = 180 // every clip so far was shot from the back deck looking back
// A reply this long has gone round in circles; a real one is under 1,000 tokens.
const MAX_TOKENS = 2000

const db = (() => { try { return openStore() } catch (e) { fail(e) } })()

// A general look (every view of every spot) or a careful one (--areas): which views, how close, which prompt.
const MODE = args.areas
  ? { views: LANDMARK_VIEWS, view: LANDMARK_VIEW, version: LANDMARK_VERSION, levels: args.levelsGiven ? args.levels : AREA_LEVELS }
  : { views: [...VIEWS] as Array<{ name: string; yaw: number }>, view: VIEW, version: PROMPT_VERSION, levels: args.levels }

// Ctrl+C: the first lets the current spot (or clip, while scanning) finish; the
// second stops at once. ffmpeg and ffprobe run in their own process group
// (lib/proc.ts), so the terminal's Ctrl+C reaches only this process. A second
// signal within a second is the same Ctrl+C passed on by pnpm or tsx. A hard
// stop, or the terminal closing, kills the children and removes the frames.
let stopping = false
let stoppedAt = 0
let frameDir: string | null = null
let releaseLock: (() => void) | null = null
function hardStop(code: number): never {
  killRunning()
  if (frameDir) { try { fs.rmSync(frameDir, { recursive: true, force: true }) } catch { /* best effort */ } }
  releaseLock?.()
  process.exit(code)
}
process.on('SIGINT', () => {
  if (stopping && Date.now() - stoppedAt > 1000) hardStop(130)
  if (stopping) return
  stopping = true
  stoppedAt = Date.now()
  console.log('\nfinishing this step, then stopping (Ctrl+C again to stop now)')
})
process.on('SIGTERM', () => hardStop(143))
process.on('SIGHUP', () => hardStop(129))

// ---------- finding the footage ----------

function* find360(dir: string): Generator<string> {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    // Dirents don't follow symlinks, so a link loop can't trap the walk.
    if (e.isDirectory() && !e.name.endsWith('.fcpbundle') && !e.name.endsWith('.photoslibrary')) yield* find360(p)
    else if (e.isFile() && /\.360$/i.test(e.name)) yield p
  }
}

async function scan(roots: string[], base: number) {
  const known = knownByPath(db)
  const overrides = cameraOverrides()
  let added = 0
  for (const root of roots) {
    for (const file of find360(root)) {
      if (stopping) return
      const st = fs.statSync(file)
      const name = path.basename(file)
      const recording = /^G[SXHP]\d{6}\./i.test(name) ? name.slice(4, 8) : name
      const yaw = overrides[name] ?? overrides[recording] ?? null
      const k = known.get(file)
      if (k && k.size === st.size && k.mtime === Math.round(st.mtimeMs)) { setCameraYaw(db, k.id, yaw); continue }
      let probe: Awaited<ReturnType<typeof probeVideo>>
      let fixes: Awaited<ReturnType<typeof readChapterFixes>>['fixes']
      try {
        probe = await probeVideo(file)
        eacLayout(probe.width, probe.height)
        fixes = (await readChapterFixes(file, probe.duration)).fixes
      } catch (e) {
        if (stopping) return
        console.log(`skip ${file}: ${(e as Error).message.split('\n')[0]}`)
        continue
      }
      const saved = saveClip(db, {
        path: file, size: st.size, mtime: Math.round(st.mtimeMs), recording, chapter: name.slice(2, 4),
        duration: probe.duration, width: probe.width, height: probe.height,
        track: fixes.map((f) => ({ ft: f.ft, lat: f.lat, lng: f.lng, speed: f.speed })), startUtc: fixes[0]?.utc ?? null,
      }, yaw)
      if (saved.skipped) { console.log(`skip ${file}: the same clip is already indexed at another path`); continue }
      console.log(`${file}: ${(probe.duration / 60).toFixed(0)} min, ${fixes.length > 1 ? 'GPS' : 'no GPS'}`)
      added++
    }
  }
  refreshPresence(db)
  // Every clip, every run: new levels, and spots a cut-short scan didn't add.
  let spots = 0
  for (const { id } of db.prepare("SELECT id FROM chapters WHERE status = 'ok'").all() as Array<{ id: number }>) spots += ensureStations(db, id, base, args.levels)
  console.log(`${added} new or changed clips, ${spots} new spots; store ${STORE}`)
}

// ---------- looking ----------

async function cutViews(st: Next, views: Array<{ name: string; yaw: number }>): Promise<Map<number, string>> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'look-'))
  frameDir = dir
  try {
    const graph = eacGraph(eacLayout(st.width, st.height), views.length) + views.map((v, i) => flatView(i, v.name, { ...MODE.view, yaw: v.yaw })).join(';')
    await runDetached('ffmpeg', ['-v', 'error', '-y', '-ss', st.ft.toFixed(2), '-i', st.path, '-filter_complex', graph,
      ...views.flatMap((v) => ['-map', `[${v.name}]`, '-frames:v', '1', '-q:v', '4', path.join(dir, `${v.name}.jpg`)])])
    return new Map(views.map((v) => [v.yaw, fs.readFileSync(path.join(dir, `${v.name}.jpg`)).toString('base64')]))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
    frameDir = null
  }
}

/** A careful look's landmarks, or null with the reply that wasn't an answer. */
async function askLandmarks(endpoint: string, image: string): Promise<{ landmarks: Landmark[] | null; raw: string }> {
  let raw = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    raw = await chat(endpoint, {
      model: args.model, format: LANDMARK_SCHEMA, keep_alive: '30m', options: { temperature: 0, num_predict: MAX_TOKENS },
      messages: [{ role: 'user', content: LANDMARK_PROMPT, images: [image] }],
    })
    const landmarks = parseLandmarks(raw)
    if (landmarks) return { landmarks, raw }
  }
  return { landmarks: null, raw }
}

/** A look, or null with the reply that wasn't one. OllamaDown (Ollama itself failing) is thrown, never saved. */
async function ask(endpoint: string, image: string): Promise<{ look: Look | null; raw: string }> {
  let raw = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    raw = await chat(endpoint, {
      model: args.model, format: SCHEMA, keep_alive: '30m', options: { temperature: 0, num_predict: MAX_TOKENS },
      messages: [{ role: 'user', content: PROMPT, images: [image] }],
    })
    const look = parseLook(raw)
    if (look) return { look, raw }
  }
  return { look: null, raw }
}

function updateCameraYaw(chapterId: number) {
  const c = db.prepare('SELECT yaw_source, camera_yaw FROM chapters WHERE id = ?').get(chapterId) as { yaw_source: string | null; camera_yaw: number | null }
  if (c.yaw_source === 'set') return
  const seen = db.prepare(`SELECT l.view_yaw AS viewYaw, l.own_person AS person, l.own_propulsion AS propulsion FROM looks l
    JOIN stations s ON s.id = l.station_id WHERE s.chapter_id = ? AND l.ok = 1`).all(chapterId) as Parameters<typeof decideCameraYaw>[0]
  const yaw = decideCameraYaw(seen)
  if (yaw !== null && yaw !== c.camera_yaw) {
    db.prepare("UPDATE chapters SET camera_yaw = ?, yaw_source = 'auto' WHERE id = ?").run(yaw, chapterId)
    console.log(`  the camera on this clip faced ${yaw}° from the bow (from where the paddler is seen)`)
  }
}

async function lookLoop(endpoint: string) {
  if (args.areas && !(db.prepare('SELECT count(*) AS n FROM areas').get() as { n: number }).n) {
    return console.log('no areas yet: draw one on the map in River Explorer (pnpm --filter web course:explore), then run this again')
  }
  console.log(`looking ${args.areas ? 'carefully inside the drawn areas ' : ''}with ${args.model} at ${endpoint}`)
  const until = args.minutes > 0 ? Date.now() + args.minutes * 60_000 : Infinity
  const uncuttable: number[] = []
  const started = Date.now()
  let spots = 0
  const next = (skip: number[] = []) => nextStation(db, args.model, MODE.version, MODE.levels, MODE.views.length, skip, args.areas)
  for (let st = next(uncuttable); st && !stopping && Date.now() < until; st = next(uncuttable)) {
    if (!fs.existsSync(st.path)) { refreshPresence(db); continue }
    const todo = MODE.views.filter((v) => !st!.done.includes(v.yaw))
    let images: Map<number, string>
    try { images = await cutViews(st, todo) } catch (e) {
      if (stopping) break
      // A bad stretch of video: leave it for next run rather than stop or loop on it.
      console.log(`  couldn't cut ${path.basename(st.path)} at ${st.ft.toFixed(0)} s: ${(e as Error).message.split('\n')[0]}`)
      uncuttable.push(st.id)
      continue
    }
    for (const v of todo) {
      const t0 = Date.now()
      if (args.areas) {
        const { landmarks, raw } = await askLandmarks(endpoint, images.get(v.yaw)!)
        saveLook(db, st.id, v.yaw, args.model, LANDMARK_VERSION, { ok: !!landmarks, landmarks: landmarks ?? [], raw, ms: Date.now() - t0 })
        continue
      }
      const { look, raw } = await ask(endpoint, images.get(v.yaw)!)
      saveLook(db, st.id, v.yaw, args.model, PROMPT_VERSION, {
        ok: !!look, scene: look?.scene, water: look?.water, light: look?.light, ownPerson: look?.own.person, ownPropulsion: look?.own.propulsion,
        items: look?.items, raw, ms: Date.now() - t0,
      })
    }
    if (!args.areas) updateCameraYaw(st.chapter_id)
    spots++
    console.log(`${path.basename(st.path)} ${st.ft.toFixed(0)} s, level ${st.level}: ${spots} spots this run, ${((Date.now() - started) / spots / 1000).toFixed(0)} s each`)
  }
  if (!stopping && !next()) console.log(`every spot ${args.areas ? 'in the areas ' : ''}has been looked at; raise --levels to go finer`)
}

// ---------- reporting ----------

/** How far the careful look has got in each area. */
function areaStatus(base: number) {
  const areas = db.prepare('SELECT id, name, south, west, north, east FROM areas ORDER BY id').all() as Array<Area & { id: number; name: string }>
  if (!areas.length) return console.log('no areas yet: draw one on the map in River Explorer (pnpm --filter web course:explore)')
  const looks = db.prepare('SELECT avg(ms) AS ms FROM looks WHERE model = ? AND prompt_version = ?').get(args.model, LANDMARK_VERSION) as { ms: number | null }
  const spots = db.prepare(`SELECT s.id, s.lat, s.lng, s.chapter_id AS chapterId,
      (SELECT count(*) FROM looks l WHERE l.station_id = s.id AND l.model = ? AND l.prompt_version = ?) AS looked,
      (SELECT count(*) FROM landmarks m JOIN looks l ON l.id = m.look_id WHERE l.station_id = s.id AND l.model = ? AND l.prompt_version = ?) AS found
    FROM stations s JOIN chapters c ON c.id = s.chapter_id WHERE c.status = 'ok' AND s.level < ?`)
    .all(args.model, LANDMARK_VERSION, args.model, LANDMARK_VERSION, MODE.levels) as Array<{ id: number; lat: number; lng: number; chapterId: number; looked: number; found: number }>
  for (const a of areas) {
    const inside = spots.filter((s) => inArea(s, a))
    const done = inside.filter((s) => s.looked >= LANDMARK_VIEWS.length).length
    const passes = new Set(inside.map((s) => s.chapterId)).size
    const left = looks.ms ? ((inside.length - done) * LANDMARK_VIEWS.length * looks.ms) / 3_600_000 : null
    console.log(`${a.name}: ${done}/${inside.length} spots (every ${base / 2 ** (MODE.levels - 1)} m, ${passes} clips), ${inside.reduce((n, s) => n + s.found, 0)} things found` +
      (left !== null && done < inside.length ? `, about ${left < 1 ? `${Math.ceil(left * 60)} min` : `${left.toFixed(1)} h`} to go` : ''))
  }
  if (!looks.ms) console.log(`(about ${LANDMARK_VIEWS.length} × 36 s a spot with ${args.model}, so roughly 5 min a spot)`)
}

function status(base: number) {
  const rows = db.prepare(`
    SELECT c.path, c.status, c.camera_yaw, c.yaw_source, s.level, count(DISTINCT s.id) AS spots,
      count(DISTINCT CASE WHEN (SELECT count(*) FROM looks l WHERE l.station_id = s.id AND l.model = ? AND l.prompt_version = ?) >= ? THEN s.id END) AS done
    FROM chapters c LEFT JOIN stations s ON s.chapter_id = c.id
    GROUP BY c.id, s.level ORDER BY c.path, s.level`).all(args.model, PROMPT_VERSION, VIEWS.length) as Array<{ path: string; status: string; camera_yaw: number | null; yaw_source: string | null; level: number | null; spots: number; done: number }>
  const byLevel = new Map<number, { spots: number; done: number }>()
  let last = ''
  for (const r of rows) {
    if (r.path !== last) {
      console.log(`${r.path}  ${r.status}${r.camera_yaw !== null ? `  camera ${r.camera_yaw}° (${r.yaw_source})` : ''}`)
      last = r.path
    }
    if (r.level === null) continue
    console.log(`    every ${base / 2 ** r.level} m: ${r.done}/${r.spots}`)
    const l = byLevel.get(r.level) ?? { spots: 0, done: 0 }
    byLevel.set(r.level, { spots: l.spots + r.spots, done: l.done + r.done })
  }
  const looks = db.prepare('SELECT avg(ms) AS ms, count(*) AS n, sum(ok = 0) AS failed FROM looks WHERE model = ? AND prompt_version = ?').get(args.model, PROMPT_VERSION) as { ms: number | null; n: number; failed: number | null }
  const items = db.prepare('SELECT count(*) AS n FROM items i JOIN looks l ON l.id = i.look_id WHERE l.model = ? AND l.prompt_version = ?').get(args.model, PROMPT_VERSION) as { n: number }
  console.log(`\n${args.model}: ${looks.n} views looked at (${looks.failed ?? 0} without a usable answer), ${items.n} things seen${looks.ms ? `, ${(looks.ms / 1000).toFixed(0)} s a view` : ''}`)
  for (const [level, l] of [...byLevel].sort((a, b) => a[0] - b[0])) {
    const left = looks.ms ? ((l.spots - l.done) * VIEWS.length * looks.ms) / 3_600_000 : null
    console.log(`  every ${base / 2 ** level} m: ${l.done}/${l.spots} spots${left !== null && l.done < l.spots ? `, about ${left.toFixed(0)} h to go` : ''}`)
  }
}

function exportGeoJson(file: string) {
  assertOutsideRepo(file)
  const rows = db.prepare(`
    SELECT i.kind, i.detail, i.x, i.distance, i.count, l.view_yaw, s.lat, s.lng, s.heading, s.level, s.ft, c.path, c.camera_yaw, c.yaw_source
    FROM items i JOIN looks l ON l.id = i.look_id JOIN stations s ON s.id = l.station_id JOIN chapters c ON c.id = s.chapter_id
    WHERE l.model = ? AND l.prompt_version = ?`).all(args.model, PROMPT_VERSION) as Array<Record<string, number | string | null>>
  const features = rows.map((r) => {
    const yaw = (r.camera_yaw as number | null) ?? ASSUMED_YAW
    const p = placeItem({ lat: r.lat as number, lng: r.lng as number, heading: r.heading as number }, r.view_yaw as number, yaw,
      { x: r.x as number, distance: r.distance as 'near' | 'mid' | 'far' })
    return {
      type: 'Feature', geometry: { type: 'Point', coordinates: [+p.lng.toFixed(6), +p.lat.toFixed(6)] },
      properties: { kind: r.kind as string, detail: r.detail, count: r.count, distance: r.distance, bearing: Math.round(p.bearing),
        clip: path.basename(r.path as string), ft: r.ft, level: r.level, camera: r.yaw_source ?? 'assumed' },
    }
  })
  fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features }))
  const counts = new Map<string, number>()
  for (const f of features) counts.set(f.properties.kind, (counts.get(f.properties.kind) ?? 0) + 1)
  console.log(`${features.length} things → ${file}  (personal data: it traces the paddles; keep it on this machine)`)
  for (const k of KINDS) if (counts.get(k)) console.log(`  ${k}: ${counts.get(k)}`)
}

async function main() {
  if (args.mode === 'status') return args.areas ? areaStatus(storedSpacing(db)) : status(storedSpacing(db))
  if (args.mode === 'export') return exportGeoJson(args.exportPath ?? path.join(STORE, 'export.geojson'))
  // Check Ollama before scanning, so a look run that can't look fails at once.
  let endpoint = ''
  if (args.mode === 'look') {
    endpoint = ollamaEndpoint(process.env.PADDLESNITCH_OLLAMA, args.allowRemote)
    assertLocalModel(args.model)
    await checkOllama(endpoint, args.model)
  }
  releaseLock = takeLock()
  try {
    const base = spotSpacing(db, args.base)
    await scan(args.folders.length ? args.folders : [path.join(os.homedir(), 'Movies')], base)
    if (args.mode === 'look' && !stopping) await lookLoop(endpoint)
  } finally {
    releaseLock()
  }
}

main()
  .catch((e) => {
    // OllamaDown and the refusals are expected; anything else gets its stack.
    if (e instanceof OllamaDown || (e instanceof Error && /^(refusing|this store|another course:look|.* is inside the git work tree)/.test(e.message))) console.error(`stopped: ${e.message}`)
    else console.error(e)
    process.exitCode = 1
  })
  .finally(() => (db as DatabaseSync).close())
