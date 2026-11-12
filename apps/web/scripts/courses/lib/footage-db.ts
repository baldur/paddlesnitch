// The footage store: one SQLite file outside the repo, so it survives worktrees
// and branches, and anything (sqlite3, a notebook, a script) can read it.
//
//   ~/.paddlesnitch/footage/footage.db   (PADDLESNITCH_FOOTAGE moves the folder)
//   ~/.paddlesnitch/footage/cameras.json optional: { "<file name or recording>": cameraYaw }
//
// It holds the owner's tracks, so it stays on this machine: never commit it or
// upload it, and nothing derived from it goes into the repo except through the
// game step's allowlist (docs/features/game-courses-from-video.md). Everything
// that decides what's done and what's next lives here, tested in footage-db.test.ts.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { stationsAt, travelled, type Fix } from './stations'

export const STORE = process.env.PADDLESNITCH_FOOTAGE ?? path.join(os.homedir(), '.paddlesnitch', 'footage')

/** Refuse a path inside a git work tree: the store and exports are personal data. */
export function assertOutsideRepo(p: string) {
  // Follow symlinks: resolve the nearest part of the path that exists.
  let real = path.resolve(p)
  let rest = ''
  while (!fs.existsSync(real) && path.dirname(real) !== real) { rest = path.join(path.basename(real), rest); real = path.dirname(real) }
  real = path.join(fs.realpathSync(real), rest)
  for (let dir = real; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) throw new Error(`${p} is inside the git work tree ${dir}: footage data holds personal tracks and must stay outside any repo`)
    if (path.dirname(dir) === dir) return
  }
}

export function openStore(dir = STORE): DatabaseSync {
  assertOutsideRepo(dir)
  fs.mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(path.join(dir, 'footage.db'))
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 30000;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,          -- first fix time # file size: the same clip whatever it's called or wherever it is
      path TEXT NOT NULL, size INTEGER, mtime INTEGER,
      recording TEXT, chapter TEXT,
      start_utc TEXT, duration REAL, width INTEGER, height INTEGER,
      status TEXT NOT NULL,              -- ok | no-gps | missing
      camera_yaw REAL, yaw_source TEXT,  -- set (cameras.json) | auto (decideCameraYaw) | null
      track TEXT,                        -- JSON [[ft, lat, lng, speed], …] every usable fix
      scanned_at TEXT
    );
    CREATE TABLE IF NOT EXISTS stations (
      id INTEGER PRIMARY KEY,
      chapter_id INTEGER NOT NULL REFERENCES chapters(id),
      level INTEGER NOT NULL, n INTEGER NOT NULL,
      ft REAL, lat REAL, lng REAL, heading REAL, speed REAL,
      UNIQUE (chapter_id, level, n)
    );
    CREATE TABLE IF NOT EXISTS looks (
      id INTEGER PRIMARY KEY,
      station_id INTEGER NOT NULL REFERENCES stations(id),
      view_yaw REAL NOT NULL,            -- degrees from the lens
      model TEXT NOT NULL, prompt_version INTEGER NOT NULL,
      ok INTEGER NOT NULL,               -- 0: the reply wasn't a look after two tries (kept, not retried)
      scene TEXT, water TEXT, light TEXT, own_person TEXT, own_propulsion TEXT,
      raw TEXT, ms INTEGER, created_at TEXT,
      UNIQUE (station_id, view_yaw, model, prompt_version)
    );
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY,
      look_id INTEGER NOT NULL REFERENCES looks(id),
      kind TEXT, detail TEXT, x REAL, distance TEXT, count INTEGER
    );
    CREATE INDEX IF NOT EXISTS items_look ON items(look_id);
    CREATE INDEX IF NOT EXISTS items_kind ON items(kind);
    CREATE INDEX IF NOT EXISTS looks_station ON looks(station_id);
  `)
  return db
}

function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try { const r = fn(); db.exec('COMMIT'); return r } catch (e) { db.exec('ROLLBACK'); throw e }
}

/** The store's spot spacing, without fixing one (for reports). */
export function storedSpacing(db: DatabaseSync): number {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'base'").get() as { value: string } | undefined
  return row ? Number(row.value) : 100
}

/** The spot spacing is fixed per store: a level means the same metres for every clip. */
export function spotSpacing(db: DatabaseSync, base: number | undefined): number {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'base'").get() as { value: string } | undefined
  if (row) {
    if (base !== undefined && Number(row.value) !== base) throw new Error(`this store uses --base ${row.value}; start a new store (PADDLESNITCH_FOOTAGE) for a different spacing`)
    return Number(row.value)
  }
  const b = base ?? 100
  db.prepare("INSERT INTO settings (key, value) VALUES ('base', ?)").run(String(b))
  return b
}

/** cameras.json: lens direction set by hand, by file name or recording number. Non-numbers are ignored. */
export function cameraOverrides(dir = STORE): Record<string, number> {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'cameras.json'), 'utf8')) as Record<string, unknown>
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => Number.isFinite(v))) as Record<string, number>
  } catch { return {} }
}

export type Known = { id: number; path: string; size: number; mtime: number }
export const knownByPath = (db: DatabaseSync) =>
  new Map((db.prepare('SELECT id, path, size, mtime FROM chapters').all() as Known[]).map((r) => [r.path, r]))

export type Clip = {
  path: string; size: number; mtime: number; recording: string; chapter: string
  duration: number; width: number; height: number
  track: Fix[]
}

/**
 * Add or refresh a clip. Its key is its first fix time and size, so a moved or
 * renamed clip keeps its spots and looks. If a clip with that key is still at
 * another path, this one is a copy and is skipped. If the file at this path is
 * a different clip now (another size, or another track), the old one's spots
 * and looks are dropped.
 */
export function saveClip(db: DatabaseSync, clip: Clip & { startUtc: string | null }, cameraYaw: number | null): { id: number; skipped?: 'copy' } {
  const key = `${clip.startUtc ?? 'nogps'}#${clip.size}`
  const track = JSON.stringify(clip.track.map((f) => [+f.ft.toFixed(2), f.lat, f.lng, f.speed]))
  return tx(db, () => {
    const old = db.prepare('SELECT id, path, track FROM chapters WHERE key = ?').get(key) as { id: number; path: string; track: string } | undefined
    if (old && old.path !== clip.path && fs.existsSync(old.path)) return { id: old.id, skipped: 'copy' as const }
    // The file at this path changed size (it was still being copied, or was replaced): what was known about it goes.
    const was = db.prepare('SELECT id FROM chapters WHERE path = ? AND key != ?').get(clip.path, key) as { id: number } | undefined
    if (was) { dropSpots(db, was.id); db.prepare('DELETE FROM chapters WHERE id = ?').run(was.id) }
    const status = clip.track.length > 1 ? 'ok' : 'no-gps'
    if (old && old.track !== track) dropSpots(db, old.id)
    db.prepare(`INSERT INTO chapters (key, path, size, mtime, recording, chapter, start_utc, duration, width, height, status, camera_yaw, yaw_source, track, scanned_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET path = excluded.path, size = excluded.size, mtime = excluded.mtime, recording = excluded.recording,
        chapter = excluded.chapter, start_utc = excluded.start_utc, duration = excluded.duration, width = excluded.width, height = excluded.height,
        status = excluded.status, track = excluded.track, scanned_at = excluded.scanned_at`)
      .run(key, clip.path, clip.size, clip.mtime, clip.recording, clip.chapter, clip.startUtc, clip.duration, clip.width, clip.height,
        status, null, null, track, new Date().toISOString())
    const { id } = db.prepare('SELECT id FROM chapters WHERE key = ?').get(key) as { id: number }
    setCameraYaw(db, id, cameraYaw)
    return { id }
  })
}

function dropSpots(db: DatabaseSync, chapterId: number) {
  db.prepare('DELETE FROM items WHERE look_id IN (SELECT l.id FROM looks l JOIN stations s ON s.id = l.station_id WHERE s.chapter_id = ?)').run(chapterId)
  db.prepare('DELETE FROM looks WHERE station_id IN (SELECT id FROM stations WHERE chapter_id = ?)').run(chapterId)
  db.prepare('DELETE FROM stations WHERE chapter_id = ?').run(chapterId)
}

/** A hand-set direction wins; removing it from cameras.json hands the clip back to the automatic one. */
export function setCameraYaw(db: DatabaseSync, chapterId: number, override: number | null) {
  const c = db.prepare('SELECT yaw_source FROM chapters WHERE id = ?').get(chapterId) as { yaw_source: string | null }
  if (override !== null) db.prepare("UPDATE chapters SET camera_yaw = ?, yaw_source = 'set' WHERE id = ?").run(override, chapterId)
  else if (c.yaw_source === 'set') db.prepare('UPDATE chapters SET camera_yaw = NULL, yaw_source = NULL WHERE id = ?').run(chapterId)
}

/**
 * Make sure every spot at every level exists for this clip, from its stored
 * track. Runs for every clip on every scan, so raising --levels, or a scan cut
 * short, is completed next time. Returns how many spots were added.
 */
export function ensureStations(db: DatabaseSync, chapterId: number, base: number, levels: number): number {
  const row = db.prepare("SELECT track FROM chapters WHERE id = ? AND status != 'no-gps'").get(chapterId) as { track: string } | undefined
  if (!row) return 0
  const track: Fix[] = (JSON.parse(row.track) as number[][]).map(([ft, lat, lng, speed]) => ({ ft, lat, lng, speed }))
  const cum = travelled(track)
  return tx(db, () => {
    const insert = db.prepare('INSERT OR IGNORE INTO stations (chapter_id, level, n, ft, lat, lng, heading, speed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    let added = 0
    for (let level = 0; level < levels; level++) {
      for (const s of stationsAt(track, cum, base, level)) added += Number(insert.run(chapterId, level, s.n, s.ft, s.lat, s.lng, s.heading, s.speed).changes)
    }
    return added
  })
}

/** Clips whose file has gone are 'missing' (their looks stay); clips that are back get their status again. */
export function refreshPresence(db: DatabaseSync, exists = fs.existsSync) {
  for (const r of db.prepare('SELECT id, path, track FROM chapters').all() as Array<{ id: number; path: string; track: string | null }>) {
    const status = !exists(r.path) ? 'missing' : (r.track && (JSON.parse(r.track) as unknown[]).length > 1 ? 'ok' : 'no-gps')
    db.prepare('UPDATE chapters SET status = ? WHERE id = ?').run(status, r.id)
  }
}

export type Next = { id: number; chapter_id: number; level: number; ft: number; path: string; width: number; height: number; done: number[] }

/** The next spot with views left to look at: level by level over all the footage, in time order. */
export function nextStation(db: DatabaseSync, model: string, version: number, levels: number, views: number, skip: number[] = []): Next | undefined {
  const r = db.prepare(`
    SELECT s.id, s.chapter_id, s.level, s.ft, c.path, c.width, c.height,
      (SELECT group_concat(l.view_yaw) FROM looks l WHERE l.station_id = s.id AND l.model = ? AND l.prompt_version = ?) AS done
    FROM stations s JOIN chapters c ON c.id = s.chapter_id
    WHERE c.status = 'ok' AND s.level < ? AND s.id NOT IN (SELECT value FROM json_each(?))
      AND (SELECT count(*) FROM looks l WHERE l.station_id = s.id AND l.model = ? AND l.prompt_version = ?) < ?
    ORDER BY s.level, c.start_utc, s.n LIMIT 1`).get(model, version, levels, JSON.stringify(skip), model, version, views) as (Omit<Next, 'done'> & { done: string | null }) | undefined
  return r && { ...r, done: (r.done ?? '').split(',').filter(Boolean).map(Number) }
}

export type SavedLook = {
  ok: boolean; scene?: string; water?: string; light?: string; ownPerson?: string; ownPropulsion?: string
  items?: Array<{ kind: string; detail: string; x: number; distance: string; count: number }>
  raw: string; ms: number
}

/** One view's answer, with its items, in one transaction. Replacing a look replaces its items. */
export function saveLook(db: DatabaseSync, stationId: number, viewYaw: number, model: string, version: number, look: SavedLook) {
  tx(db, () => {
    db.prepare('DELETE FROM items WHERE look_id IN (SELECT id FROM looks WHERE station_id = ? AND view_yaw = ? AND model = ? AND prompt_version = ?)').run(stationId, viewYaw, model, version)
    db.prepare('DELETE FROM looks WHERE station_id = ? AND view_yaw = ? AND model = ? AND prompt_version = ?').run(stationId, viewYaw, model, version)
    const r = db.prepare(`INSERT INTO looks (station_id, view_yaw, model, prompt_version, ok, scene, water, light, own_person, own_propulsion, raw, ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(stationId, viewYaw, model, version, look.ok ? 1 : 0,
      look.scene ?? null, look.water ?? null, look.light ?? null, look.ownPerson ?? null, look.ownPropulsion ?? null, look.raw, look.ms, new Date().toISOString())
    const ins = db.prepare('INSERT INTO items (look_id, kind, detail, x, distance, count) VALUES (?, ?, ?, ?, ?, ?)')
    for (const i of look.items ?? []) ins.run(r.lastInsertRowid, i.kind, i.detail, i.x, i.distance, i.count)
  })
}

/**
 * Only one run that writes per store (a scan or a look): two would pick the same
 * spots. The lock names the process holding it; a lock left by a process that's
 * gone is taken over, and the takeover is checked so two runs can't both win.
 */
export function takeLock(dir = STORE, pid = process.pid, alive = (p: number) => { try { process.kill(p, 0); return true } catch { return false } }): () => void {
  const file = path.join(dir, 'look.lock')
  const release = () => { try { if (fs.readFileSync(file, 'utf8') === String(pid)) fs.unlinkSync(file) } catch { /* already gone */ } }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.writeFileSync(file, String(pid), { flag: 'wx' })
      return release
    } catch { /* held, or just taken */ }
    let holder: string
    try { holder = fs.readFileSync(file, 'utf8') } catch { continue } // released in between: try again
    if (alive(Number(holder))) throw new Error(`another course:look (process ${holder}) is already using this store`)
    // Stale: replace it in one step, then make sure it's ours (another run may have done the same).
    const mine = `${file}.${pid}`
    fs.writeFileSync(mine, String(pid))
    fs.renameSync(mine, file)
    if (fs.readFileSync(file, 'utf8') === String(pid)) return release
  }
  throw new Error('could not take the store lock')
}
