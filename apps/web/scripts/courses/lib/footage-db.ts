// The footage store: one SQLite file outside the repo, so it survives worktrees
// and branches, and anything (sqlite3, a notebook, a script) can read it.
//
//   ~/.paddlesnitch/footage/footage.db   (PADDLESNITCH_FOOTAGE moves the folder)
//   ~/.paddlesnitch/footage/cameras.json optional: { "<file name or recording>": cameraYaw }
//
// It holds the owner's tracks, so it stays on this machine: never commit it or
// upload it. What the game gets is built from it by a separate, reviewed step.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'

export const STORE = process.env.PADDLESNITCH_FOOTAGE ?? path.join(os.homedir(), '.paddlesnitch', 'footage')

export function openStore(dir = STORE): DatabaseSync {
  fs.mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(path.join(dir, 'footage.db'))
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,          -- file name @ first fix time: the same clip wherever it's moved
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
      ok INTEGER NOT NULL,               -- 0: the reply wasn't a look (kept in raw, not retried)
      scene TEXT, water TEXT, light TEXT, own_person TEXT, own_propulsion TEXT,
      raw TEXT, ms INTEGER, created_at TEXT,
      UNIQUE (station_id, view_yaw, model, prompt_version)
    );
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY,
      look_id INTEGER NOT NULL REFERENCES looks(id),
      kind TEXT, detail TEXT, x REAL, distance TEXT, count INTEGER
    );
    CREATE INDEX IF NOT EXISTS items_kind ON items(kind);
    CREATE INDEX IF NOT EXISTS looks_station ON looks(station_id);
  `)
  return db
}

/** cameras.json: lens direction set by hand, by file name or recording number. */
export function cameraOverrides(dir = STORE): Record<string, number> {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'cameras.json'), 'utf8')) } catch { return {} }
}
