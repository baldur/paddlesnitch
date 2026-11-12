// The resume rules course:look depends on, against a real store in a temp folder.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { DatabaseSync } from 'node:sqlite'
import { assertOutsideRepo, ensureStations, nextStation, openStore, refreshPresence, saveClip, saveLook, setCameraYaw, takeLock, spotSpacing, type Clip } from './footage-db'
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
