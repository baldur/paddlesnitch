// The drone half of the footage store (course:look --drone), against a real store in a temp folder.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { DatabaseSync } from 'node:sqlite'
import { nextDroneShot, openStore, refreshDronePresence, saveDroneClip, saveDroneLook, type DroneClip, type DroneShot } from './footage-db'

let dir: string
let db: DatabaseSync
let mp4: string
let lrf: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-test-'))
  db = openStore(dir)
  mp4 = path.join(dir, 'DJI_0001_D.MP4')
  lrf = path.join(dir, 'DJI_0001_D.LRF')
  fs.writeFileSync(mp4, 'x')
  fs.writeFileSync(lrf, 'x')
})
afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) })

const clip = (over: Partial<DroneClip> = {}): DroneClip => ({
  key: '2020-01-02 10:00:00.000#30.0', path: mp4, size: 100, mtime: 1, kind: 'video', day: '2020-01-02', duration: 30, width: 3840, height: 2160,
  poseSource: 'djmd', poses: [[0, 50.1, -2.1, 60, -30, 90, 24], [1, 50.1, -2.1, 60, -30, 90, 24]], ...over,
})
const shot = (level: number, n: number, t: number): DroneShot => ({ level, n, t, lat: 50.1, lng: -2.1, alt: 60, pitch: -30, yaw: 90, focal: 24 })
const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n
const look = (shotId: number) => saveDroneLook(db, shotId, 'm', 1, { ok: true, raw: '{}', ms: 5, scene: 's',
  items: [{ kind: 'house', detail: 'd', walls: 'red brick', roof: 'slate', storeys: 2, features: '', x: 0.5, y: 0.5, sure: true }] })

describe('drone clips', () => {
  it('next frame: level by level, lowest flight first within a level; a looked-at frame is done', () => {
    const high = saveDroneClip(db, clip(), [shot(0, 0, 0), shot(1, 1, 10)]).id
    const lowFile = path.join(dir, 'DJI_0002_D.MP4'); fs.writeFileSync(lowFile, 'x')
    saveDroneClip(db, clip({ key: 'low#5', path: lowFile, poses: [[0, 50.1, -2.1, 4, 0, 90, 24]] }), [shot(0, 0, 3)])
    const first = nextDroneShot(db, 'm', 1)!
    expect([first.path, first.t]).toEqual([lowFile, 3])
    look(first.id)
    expect(nextDroneShot(db, 'm', 1)!.clip_id).toBe(high)
    expect(nextDroneShot(db, 'm', 1)!.level).toBe(0)
    expect(nextDroneShot(db, 'other-model', 1)!.path).toBe(lowFile)
  })

  it('rescanning the same clip keeps its looks; a change in its frames drops them', () => {
    const { id } = saveDroneClip(db, clip(), [shot(0, 0, 0)])
    look(nextDroneShot(db, 'm', 1)!.id)
    saveDroneClip(db, clip(), [shot(0, 0, 0)])
    expect(count('SELECT count(*) AS n FROM drone_items')).toBe(1)
    expect(saveDroneClip(db, clip(), [shot(0, 0, 4)]).id).toBe(id)
    expect(count('SELECT count(*) AS n FROM drone_items')).toBe(0)
    expect(count('SELECT count(*) AS n FROM drone_shots')).toBe(1)
  })

  it("a second copy of a clip is skipped; an MP4 replaces its LRF proxy, whose looks go", () => {
    saveDroneClip(db, clip({ path: lrf, kind: 'proxy' }), [shot(0, 0, 0)])
    look(nextDroneShot(db, 'm', 1)!.id)
    const copy = path.join(dir, 'copy.LRF'); fs.writeFileSync(copy, 'x')
    expect(saveDroneClip(db, clip({ path: copy, kind: 'proxy' }), [shot(0, 0, 0)]).skipped).toBe('copy')
    expect(saveDroneClip(db, clip(), [shot(0, 0, 0)]).skipped).toBeUndefined()
    expect((db.prepare('SELECT path, kind FROM drone_clips').all())).toEqual([{ path: mp4, kind: 'video' }])
    expect(count('SELECT count(*) AS n FROM drone_looks')).toBe(0)
  })

  it('a clip with no poses is not looked at; a missing file is skipped until it comes back', () => {
    saveDroneClip(db, clip({ poses: [] }), [])
    expect(nextDroneShot(db, 'm', 1)).toBeUndefined()
    saveDroneClip(db, clip(), [shot(0, 0, 0)])
    refreshDronePresence(db, () => false)
    expect(nextDroneShot(db, 'm', 1)).toBeUndefined()
    refreshDronePresence(db, () => true)
    expect(nextDroneShot(db, 'm', 1)).toBeDefined()
  })

  it('redoing a look replaces its items', () => {
    saveDroneClip(db, clip(), [shot(0, 0, 0)])
    const s = nextDroneShot(db, 'm', 1)!
    look(s.id); look(s.id)
    expect(count('SELECT count(*) AS n FROM drone_looks')).toBe(1)
    expect(count('SELECT count(*) AS n FROM drone_items')).toBe(1)
  })
})
