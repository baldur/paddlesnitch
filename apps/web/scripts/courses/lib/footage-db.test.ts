// The resume rules course:look depends on, against a real store in a temp folder.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { DatabaseSync } from 'node:sqlite'
import { assertOutsideRepo, ensureStations, nextStation, openStore, refreshPresence, saveArea, saveClip, saveLook, saveMissed, saveReview, setCameraYaw, takeLock, spotSpacing, type Clip } from './footage-db'
import { destination, type Fix } from './stations'

const ORIGIN = { lat: 51.4676, lng: -0.9822 }
// 1 km due east at 2 m/s.
const TRACK: Fix[] = Array.from({ length: 501 }, (_, k) => ({ ft: k, ...destination(ORIGIN, 90, 2 * k), speed: 2 }))

let dir: string
let db: DatabaseSync
let video: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'footage-test-'))
  db = openStore(dir)
  video = path.join(dir, 'GS010101.360')
  fs.writeFileSync(video, 'x')
})
afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) })

const clip = (over: Partial<Clip & { startUtc: string | null }> = {}): Clip & { startUtc: string | null } => ({
  path: video, size: 7_000_000_000, mtime: 1, recording: '0101', chapter: '01', duration: 1537, width: 3008, height: 960,
  track: TRACK, startUtc: '2026-11-08T09:00:00.000Z', ...over,
})
const count = (sql: string, ...p: Array<string | number>) => (db.prepare(sql).get(...p) as { n: number }).n
const look = (stationId: number, viewYaw: number, items = 1) => saveLook(db, stationId, viewYaw, 'm', 2, {
  ok: true, raw: '{}', ms: 1, items: Array.from({ length: items }, () => ({ kind: 'trees', detail: 'd', x: 0.5, distance: 'mid', count: 1 })),
})

describe('spots', () => {
  it('raising --levels on a clip already scanned adds the finer spots (and only those)', () => {
    const { id } = saveClip(db, clip(), null)
    expect(ensureStations(db, id, 100, 2)).toBe(11 + 10)
    expect(ensureStations(db, id, 100, 2)).toBe(0)
    expect(ensureStations(db, id, 100, 3)).toBe(20)
  })

  it('a scan cut short is completed next time', () => {
    const { id } = saveClip(db, clip(), null) // the clip was saved, then Ctrl+C before its spots
    expect(count('SELECT count(*) n FROM stations')).toBe(0)
    ensureStations(db, id, 100, 1)
    expect(count('SELECT count(*) n FROM stations')).toBe(11)
  })

  it('a store keeps the spacing it started with', () => {
    expect(spotSpacing(db, undefined)).toBe(100)
    expect(spotSpacing(db, 100)).toBe(100)
    expect(() => spotSpacing(db, 50)).toThrow(/uses --base 100/)
  })
})

describe('clips that move, are renamed, copied or change', () => {
  it('a moved and renamed clip keeps its spots and looks', () => {
    const { id } = saveClip(db, clip(), null)
    ensureStations(db, id, 100, 1)
    look(nextStation(db, 'm', 2, 1, 4)!.id, 0)
    const moved = path.join(dir, 'kayak-2026-11-08.360')
    fs.renameSync(video, moved)
    expect(saveClip(db, clip({ path: moved }), null).id).toBe(id)
    expect(count('SELECT count(*) n FROM looks')).toBe(1)
    expect((db.prepare('SELECT path FROM chapters').get() as { path: string }).path).toBe(moved)
  })

  it('a copy of a clip in a second folder is skipped, not looked at twice', () => {
    saveClip(db, clip(), null)
    const copy = path.join(dir, 'copy.360')
    fs.writeFileSync(copy, 'x')
    expect(saveClip(db, clip({ path: copy }), null).skipped).toBe('copy')
    expect(count('SELECT count(*) n FROM chapters')).toBe(1)
  })

  it('a clip scanned while still copying (a smaller file) is replaced by the full clip at the same path', () => {
    const { id } = saveClip(db, clip({ size: 1_500_000_000, track: TRACK.slice(0, 200) }), null)
    ensureStations(db, id, 100, 1)
    look(nextStation(db, 'm', 2, 1, 4)!.id, 0)
    const full = saveClip(db, clip(), null)
    expect(count('SELECT count(*) n FROM chapters')).toBe(1)
    expect(count('SELECT count(*) n FROM looks')).toBe(0)
    expect(count('SELECT count(*) n FROM items')).toBe(0)
    expect(ensureStations(db, full.id, 100, 1)).toBe(11)
  })

  it('a clip whose track changed at the same size drops its old spots', () => {
    const { id } = saveClip(db, clip({ track: TRACK.slice(0, 200) }), null)
    ensureStations(db, id, 100, 1)
    saveClip(db, clip(), null)
    expect(count('SELECT count(*) n FROM stations')).toBe(0)
  })

  it('a clip whose file has gone is missing and skipped, and comes back when it does', () => {
    const { id } = saveClip(db, clip(), null)
    ensureStations(db, id, 100, 1)
    fs.rmSync(video)
    refreshPresence(db)
    expect(nextStation(db, 'm', 2, 1, 4)).toBeUndefined()
    fs.writeFileSync(video, 'x')
    refreshPresence(db)
    expect(nextStation(db, 'm', 2, 1, 4)).toBeDefined()
  })

  it('a clip without GPS is kept as no-gps, and still marked missing when deleted', () => {
    const { id } = saveClip(db, clip({ track: [], startUtc: null }), null)
    expect(ensureStations(db, id, 100, 1)).toBe(0)
    fs.rmSync(video)
    refreshPresence(db)
    expect((db.prepare('SELECT status FROM chapters').get() as { status: string }).status).toBe('missing')
  })
})

describe('looking', () => {
  it('a spot half looked at asks only for the views it is missing', () => {
    const { id } = saveClip(db, clip(), null)
    ensureStations(db, id, 100, 1)
    const first = nextStation(db, 'm', 2, 1, 4)!
    look(first.id, 0)
    look(first.id, 90)
    const again = nextStation(db, 'm', 2, 1, 4)!
    expect(again.id).toBe(first.id)
    expect(again.done.sort()).toEqual([0, 90])
  })

  it('goes level by level, then in time order', () => {
    const { id } = saveClip(db, clip(), null)
    ensureStations(db, id, 100, 2)
    const seen: number[] = []
    for (let s = nextStation(db, 'm', 2, 2, 1); s; s = nextStation(db, 'm', 2, 2, 1)) { seen.push(s.level); look(s.id, 0) }
    expect(seen).toEqual([...Array(11).fill(0), ...Array(10).fill(1)])
  })

  it('a spot that cannot be cut can be skipped for this run', () => {
    const { id } = saveClip(db, clip(), null)
    ensureStations(db, id, 100, 1)
    const bad = nextStation(db, 'm', 2, 1, 4)!
    expect(nextStation(db, 'm', 2, 1, 4, [bad.id])!.id).not.toBe(bad.id)
  })

  it('saving a look again replaces its items instead of leaving the old ones behind', () => {
    const { id } = saveClip(db, clip(), null)
    ensureStations(db, id, 100, 1)
    const s = nextStation(db, 'm', 2, 1, 4)!
    look(s.id, 0, 3)
    look(s.id, 0, 2)
    expect(count('SELECT count(*) n FROM items')).toBe(2)
  })
})

describe('checking the answers (course:explore)', () => {
  const lookedAt = () => {
    const { id } = saveClip(db, clip(), null)
    ensureStations(db, id, 100, 1)
    const s = nextStation(db, 'm', 2, 1, 4)!
    look(s.id, 0, 2)
    return s.id
  }
  const itemIds = () => (db.prepare('SELECT id FROM items ORDER BY id').all() as Array<{ id: number }>).map((r) => r.id)
  const lookId = () => (db.prepare('SELECT id FROM looks').get() as { id: number }).id

  it('a verdict can be given, changed and taken back, and only for a real item', () => {
    lookedAt()
    const [a] = itemIds()
    expect(saveReview(db, a, 'right')).toBe(true)
    saveReview(db, a, 'wrong')
    expect((db.prepare('SELECT verdict FROM reviews').get() as { verdict: string }).verdict).toBe('wrong')
    saveReview(db, a, null)
    expect(count('SELECT count(*) n FROM reviews')).toBe(0)
    expect(saveReview(db, 9999, 'right')).toBe(false)
  })

  it('a missed thing is kept against its view, and refused for a view that does not exist', () => {
    lookedAt()
    const m = saveMissed(db, { lookId: lookId(), kind: 'swan', x: 0.3, y: 0.6 })
    expect(m).not.toBeNull()
    expect(saveMissed(db, { lookId: 9999, kind: 'swan', x: 0.3, y: 0.6 })).toBeNull()
    saveMissed(db, { remove: m! })
    expect(count('SELECT count(*) n FROM missed')).toBe(0)
  })

  it('redoing a look drops the verdicts on its old answer, so they never score a different answer', () => {
    const s = lookedAt()
    for (const id of itemIds()) saveReview(db, id, 'right')
    saveMissed(db, { lookId: lookId(), kind: 'swan', x: 0.3, y: 0.6 })
    look(s, 0, 1)
    expect(count('SELECT count(*) n FROM reviews')).toBe(0)
    expect(count('SELECT count(*) n FROM missed')).toBe(0)
  })

  it('a clip that changed drops its verdicts with its spots', () => {
    lookedAt()
    saveReview(db, itemIds()[0], 'wrong')
    saveMissed(db, { lookId: lookId(), kind: 'swan', x: 0.3, y: 0.6 })
    saveClip(db, clip({ track: TRACK.slice(0, 200) }), null)
    expect(count('SELECT count(*) n FROM reviews')).toBe(0)
    expect(count('SELECT count(*) n FROM missed')).toBe(0)
  })

  it('a verdict sent for an old answer never lands on the new one: ids are not reused', () => {
    const s = lookedAt()
    const old = itemIds()
    look(s, 0, 2) // course:look redid this view while the page was open
    for (const id of old) expect(saveReview(db, id, 'wrong')).toBe(false)
    expect(itemIds().some((id) => old.includes(id))).toBe(false)
  })

  it('a store made before ids were never reused is upgraded once, keeping its rows and ids', () => {
    const old = fs.mkdtempSync(path.join(os.tmpdir(), 'footage-old-'))
    const sqlite = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite')
    const raw = new sqlite.DatabaseSync(path.join(old, 'footage.db'))
    raw.exec(`CREATE TABLE stations (id INTEGER PRIMARY KEY, chapter_id INTEGER NOT NULL REFERENCES chapters(id), level INTEGER NOT NULL, n INTEGER NOT NULL,
        ft REAL, lat REAL, lng REAL, heading REAL, speed REAL, UNIQUE (chapter_id, level, n));
      CREATE TABLE looks (id INTEGER PRIMARY KEY, station_id INTEGER NOT NULL REFERENCES stations(id), view_yaw REAL NOT NULL, model TEXT NOT NULL,
        prompt_version INTEGER NOT NULL, ok INTEGER NOT NULL, scene TEXT, water TEXT, light TEXT, own_person TEXT, own_propulsion TEXT, raw TEXT, ms INTEGER,
        created_at TEXT, UNIQUE (station_id, view_yaw, model, prompt_version));
      CREATE TABLE items (id INTEGER PRIMARY KEY, look_id INTEGER NOT NULL REFERENCES looks(id), kind TEXT, detail TEXT, x REAL, distance TEXT, count INTEGER);
      CREATE TABLE missed (id INTEGER PRIMARY KEY, look_id INTEGER NOT NULL, kind TEXT NOT NULL, x REAL, at TEXT);
      CREATE TABLE chapters (id INTEGER PRIMARY KEY, key TEXT UNIQUE NOT NULL, path TEXT NOT NULL, status TEXT NOT NULL);
      INSERT INTO chapters (id, key, path, status) VALUES (1, 'k', 'p', 'ok');
      INSERT INTO stations (id, chapter_id, level, n) VALUES (3, 1, 0, 0);
      INSERT INTO looks (id, station_id, view_yaw, model, prompt_version, ok) VALUES (1, 3, 0, 'm', 2, 1);
      INSERT INTO items (id, look_id, kind) VALUES (7, 1, 'swan');`)
    raw.close()
    const up = openStore(old)
    try {
      for (const t of ['stations', 'looks', 'items', 'missed']) {
        expect((up.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(t) as { sql: string }).sql).toMatch(/AUTOINCREMENT/)
      }
      expect(up.prepare('SELECT id, kind FROM items').all()).toEqual([{ id: 7, kind: 'swan' }])
      up.exec('DELETE FROM items')
      expect(Number(up.prepare("INSERT INTO items (look_id, kind) VALUES (1, 'bridge')").run().lastInsertRowid)).toBe(8)
      expect(up.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'items_look'").get()).toBeDefined()
      expect(up.prepare("SELECT y FROM missed").all()).toEqual([])
    } finally { up.close(); fs.rmSync(old, { recursive: true, force: true }) }
  })

  it('a clip that changed gets new spot ids, so cached pictures of the old spots are never shown for them', () => {
    const { id } = saveClip(db, clip(), null)
    ensureStations(db, id, 100, 1)
    const before = (db.prepare('SELECT id FROM stations').all() as Array<{ id: number }>).map((r) => r.id)
    saveClip(db, clip({ track: TRACK.slice(0, 200) }), null)
    ensureStations(db, id, 100, 1)
    const after = (db.prepare('SELECT id FROM stations').all() as Array<{ id: number }>).map((r) => r.id)
    expect(after.some((x) => before.includes(x))).toBe(false)
  })
})

describe('looking carefully inside areas', () => {
  it('only spots inside an area are next, and none at all without an area', () => {
    const { id } = saveClip(db, clip(), null)
    ensureStations(db, id, 100, 1)
    expect(nextStation(db, 'm', 101, 1, 8, [], true)).toBeUndefined()
    // The track runs 1 km east from ORIGIN: an area round 400–600 m along holds spots 4, 5 and 6.
    const a = destination(ORIGIN, 90, 350), b = destination(ORIGIN, 90, 650)
    saveArea(db, { name: 'the boathouses', south: a.lat - 0.001, north: a.lat + 0.001, west: a.lng, east: b.lng })
    const seen: number[] = []
    for (let s = nextStation(db, 'm', 101, 1, 1, [], true); s; s = nextStation(db, 'm', 101, 1, 1, [], true)) { seen.push(Math.round(s.ft)); saveLook(db, s.id, 0, 'm', 101, { ok: true, raw: '{}', ms: 1, landmarks: [] }) }
    expect(seen).toEqual([200, 250, 300])
    // The general look still sees every spot.
    expect(nextStation(db, 'm', 2, 1, 4)).toBeDefined()
  })

  it('finishes one pass through an area, coarse to fine, before starting the next', () => {
    const first = saveClip(db, clip(), null).id
    const other = path.join(dir, 'GS010102.360'); fs.writeFileSync(other, 'x')
    const second = saveClip(db, clip({ path: other, size: 6_000_000_000, startUtc: '2026-11-09T09:00:00.000Z' }), null).id
    for (const id of [first, second]) ensureStations(db, id, 100, 2)
    saveArea(db, { name: 'all of it', south: ORIGIN.lat - 0.01, north: ORIGIN.lat + 0.01, west: ORIGIN.lng - 0.01, east: ORIGIN.lng + 0.02 })
    const order: string[] = []
    for (let s = nextStation(db, 'm', 101, 2, 1, [], true); s; s = nextStation(db, 'm', 101, 2, 1, [], true)) {
      order.push(`${s.chapter_id}:${s.level}`); saveLook(db, s.id, 0, 'm', 101, { ok: true, raw: '{}', ms: 1, landmarks: [] })
    }
    expect(order).toEqual([...Array(11).fill(`${first}:0`), ...Array(10).fill(`${first}:1`), ...Array(11).fill(`${second}:0`), ...Array(10).fill(`${second}:1`)])
  })

  it('finishes the area drawn first before starting the next, whatever the order along the river', () => {
    const { id } = saveClip(db, clip(), null)
    ensureStations(db, id, 100, 1)
    const box = (from: number, to: number) => { const a = destination(ORIGIN, 90, from), b = destination(ORIGIN, 90, to); return { south: a.lat - 0.001, north: a.lat + 0.001, west: a.lng, east: b.lng } }
    saveArea(db, { name: 'far end, drawn first', ...box(750, 950) })
    saveArea(db, { name: 'near end', ...box(50, 250) })
    const seen: number[] = []
    for (let s = nextStation(db, 'm', 101, 1, 1, [], true); s; s = nextStation(db, 'm', 101, 1, 1, [], true)) { seen.push(Math.round(s.ft / 50) * 50); saveLook(db, s.id, 0, 'm', 101, { ok: true, raw: '{}', ms: 1, landmarks: [] }) }
    expect(seen).toEqual([400, 450, 50, 100])
  })

  it('a careful look keeps its landmarks, and looking again replaces them', () => {
    const { id } = saveClip(db, clip(), null)
    ensureStations(db, id, 100, 1)
    const s = nextStation(db, 'm', 2, 1, 4)!
    const lm = { name: 'white boathouse', kind: 'boathouse', detail: 'green doors', x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.5, distance: 'mid', sure: true }
    saveLook(db, s.id, 45, 'm', 101, { ok: true, raw: '{}', ms: 1, landmarks: [lm, { ...lm, name: 'red pub' }] })
    expect(count('SELECT count(*) n FROM landmarks')).toBe(2)
    saveLook(db, s.id, 45, 'm', 101, { ok: true, raw: '{}', ms: 1, landmarks: [lm] })
    expect(db.prepare('SELECT name, sure FROM landmarks').all()).toEqual([{ name: 'white boathouse', sure: 1 }])
    saveClip(db, clip({ track: TRACK.slice(0, 200) }), null)
    expect(count('SELECT count(*) n FROM landmarks')).toBe(0)
  })

  it('an area can be removed', () => {
    const a = saveArea(db, { name: 'x', south: 1, west: 1, north: 2, east: 2 })
    saveArea(db, { remove: a })
    expect(count('SELECT count(*) n FROM areas')).toBe(0)
  })
})

describe('camera direction', () => {
  it('removing a hand-set direction from cameras.json hands the clip back to the automatic one', () => {
    const { id } = saveClip(db, clip(), 90)
    expect(db.prepare('SELECT camera_yaw, yaw_source FROM chapters').get()).toEqual({ camera_yaw: 90, yaw_source: 'set' })
    setCameraYaw(db, id, null)
    expect(db.prepare('SELECT camera_yaw, yaw_source FROM chapters').get()).toEqual({ camera_yaw: null, yaw_source: null })
  })
})

describe('keeping the data out of the repo', () => {
  it('refuses a store or export path inside a git work tree', () => {
    expect(() => assertOutsideRepo(path.join(__dirname, 'footage.db'))).toThrow(/inside the git work tree/)
    expect(() => assertOutsideRepo(path.join(dir, 'export.geojson'))).not.toThrow()
  })

  it('follows a symlink that points into a repo', () => {
    const link = path.join(dir, 'into-repo')
    fs.symlinkSync(__dirname, link)
    expect(() => assertOutsideRepo(path.join(link, 'new-folder', 'export.geojson'))).toThrow(/inside the git work tree/)
  })

  it('one look run per store; a lock left by a dead process is taken over', () => {
    const release = takeLock(dir, 111, () => true)
    expect(() => takeLock(dir, 222, () => true)).toThrow(/process 111/)
    expect(() => takeLock(dir, 222, () => false)).not.toThrow()
    release() // 111's release doesn't remove 222's lock
    expect(fs.readFileSync(path.join(dir, 'look.lock'), 'utf8')).toBe('222')
  })

  it('two runs taking over the same stale lock: only one wins', () => {
    fs.writeFileSync(path.join(dir, 'look.lock'), '999')
    const isAlive = (p: number) => p !== 999
    takeLock(dir, 301, isAlive)
    expect(() => takeLock(dir, 302, isAlive)).toThrow(/process 301/)
  })
})
