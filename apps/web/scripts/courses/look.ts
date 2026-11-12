#!/usr/bin/env node
// A local vision model looks at all the 360 footage on this machine and writes
// down everything along the river, place by place. Stop it any time; run it
// again and it carries on where it left off.
//
//   pnpm --filter web course:look [folders…]   find *.360 (default ~/Movies), then look until stopped
//       --model qwen2.5vl:32b   the Ollama model (OLLAMA_HOST, default localhost:11434)
//       --base 100 --levels 4   a look every 100 m, then 50, 25, 12.5 m
//       --minutes 60            stop after this long
//       --scan                  only find and index the footage
//   pnpm --filter web course:look --status      how far it has got
//   pnpm --filter web course:look --export [f]  everything seen, placed, as GeoJSON
//
// Ctrl+C finishes the spot it's on and stops; twice stops at once (that spot is
// redone next time). Results go to the store in lib/footage-db.ts, outside the
// repo. See docs/features/game-courses-from-video.md, "Looking with a local model".
import { execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import type { DatabaseSync } from 'node:sqlite'
import { eacGraph, eacLayout, flatView } from './lib/eac'
import { cameraOverrides, openStore, STORE } from './lib/footage-db'
import { decideCameraYaw, KINDS, parseLook, placeItem, PROMPT, PROMPT_VERSION, SCHEMA, VIEW, VIEWS, type Look } from './lib/look'
import { stationsAt, travelled, type Fix } from './lib/stations'
import { probeVideo, readChapterFixes } from './lib/telemetry'

const run = promisify(execFile)
const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const opt = (name: string, fallback: string) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback }
const MODEL = opt('model', 'qwen2.5vl:32b')
const BASE = Number(opt('base', '100'))
const LEVELS = Number(opt('levels', '4'))
const MINUTES = Number(opt('minutes', '0'))
const OLLAMA = process.env.OLLAMA_HOST ?? 'http://localhost:11434'
const ASSUMED_YAW = 180 // every clip so far was shot from the back deck looking back

const db = openStore()
// Everything that isn't a flag or a flag's value is a folder to search.
const TAKES_VALUE = ['--model', '--base', '--levels', '--minutes', '--export']
const folders = args.filter((a, i) => !a.startsWith('--') && !TAKES_VALUE.includes(args[i - 1]))
  .map((p) => path.resolve(process.env.INIT_CWD ?? process.cwd(), p))

// ---------- finding the footage ----------

function* find360(dir: string): Generator<string> {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory() && !e.name.endsWith('.fcpbundle') && !e.name.endsWith('.photoslibrary')) yield* find360(p)
    else if (e.isFile() && /\.360$/i.test(e.name)) yield p
  }
}

function overrideFor(file: string, recording: string): number | null {
  const o = cameraOverrides()
  return o[path.basename(file)] ?? o[recording] ?? null
}

function scan(roots: string[]) {
  const known = new Map((db.prepare('SELECT id, path, size, mtime FROM chapters').all() as Array<{ id: number; path: string; size: number; mtime: number }>).map((r) => [r.path, r]))
  let added = 0
  for (const root of roots) {
    for (const file of find360(root)) {
      const st = fs.statSync(file)
      const k = known.get(file)
      const name = path.basename(file)
      const recording = /^G[SXHP]\d{6}\./i.test(name) ? name.slice(4, 8) : name
      if (k && k.size === st.size && k.mtime === Math.round(st.mtimeMs)) {
        const yaw = overrideFor(file, recording)
        if (yaw !== null) db.prepare("UPDATE chapters SET camera_yaw = ?, yaw_source = 'set' WHERE id = ?").run(yaw, k.id)
        continue
      }
      let probe: ReturnType<typeof probeVideo>
      let fixes: ReturnType<typeof readChapterFixes>['fixes']
      try {
        probe = probeVideo(file)
        eacLayout(probe.width, probe.height)
        fixes = readChapterFixes(file, probe.duration).fixes
      } catch (e) {
        console.log(`skip ${file}: ${(e as Error).message.split('\n')[0]}`)
        continue
      }
      const key = `${name}@${fixes[0]?.utc ?? `nogps-${st.size}`}`
      const yaw = overrideFor(file, recording)
      db.prepare(`INSERT INTO chapters (key, path, size, mtime, recording, chapter, start_utc, duration, width, height, status, camera_yaw, yaw_source, track, scanned_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET path = excluded.path, size = excluded.size, mtime = excluded.mtime, status = excluded.status,
          camera_yaw = COALESCE(excluded.camera_yaw, chapters.camera_yaw), yaw_source = COALESCE(excluded.yaw_source, chapters.yaw_source)`)
        .run(key, file, st.size, Math.round(st.mtimeMs), recording, name.slice(2, 4), fixes[0]?.utc ?? null, probe.duration, probe.width, probe.height,
          fixes.length > 1 ? 'ok' : 'no-gps', yaw, yaw === null ? null : 'set', JSON.stringify(fixes.map((f) => [f.ft, f.lat, f.lng, f.speed])), new Date().toISOString())
      const { id } = db.prepare('SELECT id FROM chapters WHERE key = ?').get(key) as { id: number }
      const track: Fix[] = fixes.map((f) => ({ ft: f.ft, lat: f.lat, lng: f.lng, speed: f.speed }))
      const cum = travelled(track)
      const insert = db.prepare('INSERT OR IGNORE INTO stations (chapter_id, level, n, ft, lat, lng, heading, speed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      let n = 0
      for (let level = 0; level < LEVELS; level++) for (const s of stationsAt(track, cum, BASE, level)) { insert.run(id, level, s.n, s.ft, s.lat, s.lng, s.heading, s.speed); n++ }
      console.log(`${file}: ${(probe.duration / 60).toFixed(0)} min, ${(cum.at(-1)! / 1000 || 0).toFixed(1)} km, ${n} spots`)
      added++
    }
  }
  for (const r of db.prepare("SELECT id, path FROM chapters WHERE status != 'no-gps'").all() as Array<{ id: number; path: string }>) {
    db.prepare('UPDATE chapters SET status = ? WHERE id = ?').run(fs.existsSync(r.path) ? 'ok' : 'missing', r.id)
  }
  console.log(`${added} new or changed clips; store ${STORE}`)
}

// ---------- looking ----------

type Next = { id: number; chapter_id: number; level: number; ft: number; path: string; width: number; height: number; done: string | null }

function nextStation(): Next | undefined {
  return db.prepare(`
    SELECT s.id, s.chapter_id, s.level, s.ft, c.path, c.width, c.height,
      (SELECT group_concat(l.view_yaw) FROM looks l WHERE l.station_id = s.id AND l.model = ? AND l.prompt_version = ?) AS done
    FROM stations s JOIN chapters c ON c.id = s.chapter_id
    WHERE c.status = 'ok' AND s.level < ?
      AND (SELECT count(*) FROM looks l WHERE l.station_id = s.id AND l.model = ? AND l.prompt_version = ?) < ?
    ORDER BY s.level, c.start_utc, s.n LIMIT 1`).get(MODEL, PROMPT_VERSION, LEVELS, MODEL, PROMPT_VERSION, VIEWS.length) as Next | undefined
}

async function cutViews(st: Next, views: typeof VIEWS[number][]): Promise<Map<number, string>> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'look-'))
  try {
    const graph = eacGraph(eacLayout(st.width, st.height), views.length) + views.map((v, i) => flatView(i, v.name, { ...VIEW, yaw: v.yaw })).join(';')
    await run('ffmpeg', ['-v', 'error', '-y', '-ss', st.ft.toFixed(2), '-i', st.path, '-filter_complex', graph,
      ...views.flatMap((v) => ['-map', `[${v.name}]`, '-frames:v', '1', '-q:v', '4', path.join(dir, `${v.name}.jpg`)])])
    return new Map(views.map((v) => [v.yaw, fs.readFileSync(path.join(dir, `${v.name}.jpg`)).toString('base64')]))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// A reply this long has gone round in circles (a model can repeat itself until
// it's stopped); a real one is under 1,000 tokens.
const MAX_TOKENS = 2000

/** One reply, streamed: a long wait for the first byte would otherwise trip fetch's 5-minute header timeout. */
async function chat(image: string): Promise<string> {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    signal: AbortSignal.timeout(10 * 60_000),
    body: JSON.stringify({
      model: MODEL, stream: true, format: SCHEMA, keep_alive: '30m', options: { temperature: 0, num_predict: MAX_TOKENS },
      messages: [{ role: 'user', content: PROMPT, images: [image] }],
    }),
  })
  if (!res.ok || !res.body) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`)
  let text = ''
  let buf = ''
  const decoder = new TextDecoder()
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (line) text += (JSON.parse(line) as { message?: { content?: string } }).message?.content ?? ''
    }
  }
  return text
}

/** A look, or null with whatever came back (a broken reply is kept, not retried forever). */
async function ask(image: string): Promise<{ look: Look | null; raw: string }> {
  let raw = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    try { raw = await chat(image) } catch (e) {
      if (String(e).includes('ECONNREFUSED')) throw new Error(`Ollama isn't running at ${OLLAMA} (start it with: ollama serve)`)
      raw = `error: ${(e as Error).message}`
      continue
    }
    const look = parseLook(raw)
    if (look) return { look, raw }
  }
  return { look: null, raw }
}

function saveLook(stationId: number, viewYaw: number, look: Look | null, raw: string, ms: number) {
  db.exec('BEGIN')
  try {
    const r = db.prepare(`INSERT OR REPLACE INTO looks (station_id, view_yaw, model, prompt_version, ok, scene, water, light, own_person, own_propulsion, raw, ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(stationId, viewYaw, MODEL, PROMPT_VERSION, look ? 1 : 0,
      look?.scene ?? null, look?.water ?? null, look?.light ?? null, look?.own.person ?? null, look?.own.propulsion ?? null, raw, ms, new Date().toISOString())
    const ins = db.prepare('INSERT INTO items (look_id, kind, detail, x, distance, count) VALUES (?, ?, ?, ?, ?, ?)')
    for (const i of look?.items ?? []) ins.run(r.lastInsertRowid, i.kind, i.detail, i.x, i.distance, i.count)
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
}

function updateCameraYaw(chapterId: number) {
  const c = db.prepare('SELECT yaw_source, camera_yaw FROM chapters WHERE id = ?').get(chapterId) as { yaw_source: string | null; camera_yaw: number | null }
  if (c.yaw_source === 'set') return
  const seen = db.prepare(`SELECT l.view_yaw AS viewYaw, l.own_person AS person, l.own_propulsion AS propulsion FROM looks l
    JOIN stations s ON s.id = l.station_id WHERE s.chapter_id = ? AND l.ok = 1`).all(chapterId) as Parameters<typeof decideCameraYaw>[0]
  const yaw = decideCameraYaw(seen)
  if (yaw !== null && yaw !== c.camera_yaw) {
    db.prepare("UPDATE chapters SET camera_yaw = ?, yaw_source = 'auto' WHERE id = ?").run(yaw, chapterId)
    console.log(`  camera on this clip faced ${yaw}° from the bow (from the paddler's position)`)
  }
}

async function lookLoop() {
  let stopping = false
  process.on('SIGINT', () => {
    if (stopping) process.exit(130)
    stopping = true
    console.log('\nfinishing this spot, then stopping (Ctrl+C again to stop now)')
  })
  const until = MINUTES > 0 ? Date.now() + MINUTES * 60_000 : Infinity
  let spots = 0
  const started = Date.now()
  for (let st = nextStation(); st && !stopping && Date.now() < until; st = nextStation()) {
    if (!fs.existsSync(st.path)) { db.prepare("UPDATE chapters SET status = 'missing' WHERE id = ?").run(st.chapter_id); continue }
    const done = new Set((st.done ?? '').split(',').filter(Boolean).map(Number))
    const todo = VIEWS.filter((v) => !done.has(v.yaw))
    const images = await cutViews(st, todo)
    for (const v of todo) {
      const t0 = Date.now()
      const { look, raw } = await ask(images.get(v.yaw)!)
      saveLook(st.id, v.yaw, look, raw, Date.now() - t0)
    }
    updateCameraYaw(st.chapter_id)
    spots++
    const per = (Date.now() - started) / spots / 1000
    console.log(`${path.basename(st.path)} ${st.ft.toFixed(0)} s, level ${st.level}: ${spots} spots this run, ${per.toFixed(0)} s each`)
  }
  if (!nextStation()) console.log('every spot has been looked at; add --levels to go finer')
}

// ---------- reporting ----------

function status() {
  const rows = db.prepare(`
    SELECT c.path, c.status, c.camera_yaw, c.yaw_source, s.level, count(DISTINCT s.id) AS spots,
      count(DISTINCT CASE WHEN (SELECT count(*) FROM looks l WHERE l.station_id = s.id AND l.model = ? AND l.prompt_version = ?) >= ? THEN s.id END) AS done
    FROM chapters c LEFT JOIN stations s ON s.chapter_id = c.id
    GROUP BY c.id, s.level ORDER BY c.path, s.level`).all(MODEL, PROMPT_VERSION, VIEWS.length) as Array<{ path: string; status: string; camera_yaw: number | null; yaw_source: string | null; level: number | null; spots: number; done: number }>
  const byLevel = new Map<number, { spots: number; done: number }>()
  let last = ''
  for (const r of rows) {
    if (r.path !== last) {
      console.log(`${r.path}  ${r.status}${r.camera_yaw !== null ? `  camera ${r.camera_yaw}° (${r.yaw_source})` : ''}`)
      last = r.path
    }
    if (r.level === null) continue
    console.log(`    level ${r.level} (every ${BASE / 2 ** r.level} m): ${r.done}/${r.spots}`)
    const l = byLevel.get(r.level) ?? { spots: 0, done: 0 }
    byLevel.set(r.level, { spots: l.spots + r.spots, done: l.done + r.done })
  }
  const speed = db.prepare('SELECT avg(ms) AS ms, count(*) AS n FROM looks WHERE model = ? AND prompt_version = ?').get(MODEL, PROMPT_VERSION) as { ms: number | null; n: number }
  const items = db.prepare('SELECT count(*) AS n FROM items').get() as { n: number }
  console.log(`\n${MODEL}: ${speed.n} views looked at, ${items.n} things seen${speed.ms ? `, ${(speed.ms / 1000).toFixed(0)} s a view` : ''}`)
  for (const [level, l] of [...byLevel].sort((a, b) => a[0] - b[0])) {
    const left = speed.ms ? ((l.spots - l.done) * VIEWS.length * speed.ms) / 3_600_000 : null
    console.log(`  every ${BASE / 2 ** level} m: ${l.done}/${l.spots} spots${left !== null && l.done < l.spots ? `, about ${left.toFixed(0)} h to go` : ''}`)
  }
}

function exportGeoJson(file: string) {
  const rows = db.prepare(`
    SELECT i.kind, i.detail, i.x, i.distance, i.count, l.view_yaw, l.scene, s.lat, s.lng, s.heading, s.level, s.ft, c.path, c.camera_yaw, c.yaw_source
    FROM items i JOIN looks l ON l.id = i.look_id JOIN stations s ON s.id = l.station_id JOIN chapters c ON c.id = s.chapter_id
    WHERE l.model = ? AND l.prompt_version = ?`).all(MODEL, PROMPT_VERSION) as Array<Record<string, number | string | null>>
  const features = rows.map((r) => {
    const yaw = (r.camera_yaw as number | null) ?? ASSUMED_YAW
    const p = placeItem({ lat: r.lat as number, lng: r.lng as number, heading: r.heading as number }, r.view_yaw as number, yaw,
      { x: r.x as number, distance: r.distance as 'near' | 'mid' | 'far' })
    return {
      type: 'Feature', geometry: { type: 'Point', coordinates: [+p.lng.toFixed(6), +p.lat.toFixed(6)] },
      properties: { kind: r.kind, detail: r.detail, count: r.count, distance: r.distance, bearing: Math.round(p.bearing),
        clip: path.basename(r.path as string), ft: r.ft, level: r.level, camera: r.yaw_source ?? 'assumed' },
    }
  })
  fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features }))
  const counts = new Map<string, number>()
  for (const f of features) counts.set(f.properties.kind as string, (counts.get(f.properties.kind as string) ?? 0) + 1)
  console.log(`${features.length} things → ${file}`)
  for (const k of KINDS) if (counts.get(k)) console.log(`  ${k}: ${counts.get(k)}`)
}

async function main() {
  if (flag('status')) return status()
  if (flag('export')) {
    const i = args.indexOf('--export')
    const out = args[i + 1] && !args[i + 1].startsWith('--') ? path.resolve(process.env.INIT_CWD ?? process.cwd(), args[i + 1]) : path.join(STORE, 'export.geojson')
    return exportGeoJson(out)
  }
  scan(folders.length ? folders : [path.join(os.homedir(), 'Movies')])
  if (flag('scan')) return
  await lookLoop()
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => (db as DatabaseSync).close())
