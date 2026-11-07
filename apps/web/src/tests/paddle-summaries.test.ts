// @vitest-environment node
// The Paddles page read every paddle in full, twice (6.5 MB for 61 paddles,
// mostly map points). Each paddle now has a small summary beside it, written
// with the paddle, and lists read only those.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { saveSession, deleteSession, listSessionSummaries, updateSessionNote, eachLimited, PLACES_REBUILD_MAX, PLACES_REBUILD_AT_ONCE } from '@paddlesnitch/analysis/analysis-store'
import { decodePlaces } from '@paddlesnitch/core/paddles'
import { analyseTrack } from '@paddlesnitch/analysis/analysis'

const U = 'user-sum'
let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'paddle-summaries-'))
  process.env.USE_LOCAL_STORAGE = 'true'
  process.env.DATA_DIR = dir
})
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); delete process.env.DATA_DIR })

const t0 = Date.parse('2026-09-01T10:00:00Z')
const paddle = (id: string) => ({
  id, userId: U, createdAt: '2026-09-01T11:00:00Z', paddledAt: '2026-09-01T10:00:00Z', source: { type: 'file' as const },
  doubleStrokeRate: false, note: '', insight: 'A steady paddle.',
  result: analyseTrack(Array.from({ length: 300 }, (_, i) => ({ lat: 51.5 + i * 0.00003, lng: -0.1, timestamp: new Date(t0 + i * 1000), strokeRate: 56 })), {}),
})
const file = (id: string, name: string) => path.join(dir, 'analysis', U, id, name)

describe('paddle summaries', () => {
  it('are written with the paddle, and lists read them instead of the paddle', async () => {
    await saveSession(paddle('p1') as never)
    const sum = JSON.parse(await fs.readFile(file('p1', 'summary.json'), 'utf8'))
    expect(sum).toMatchObject({ id: 'p1', avgSR: 56 })
    expect(JSON.stringify(sum)).not.toContain('"points"')
    // Spoil the full paddle: the lists must not need it.
    await fs.writeFile(file('p1', 'session.json'), '{ not json')
    expect((await listSessionSummaries(U)).map(s => s.id)).toEqual(['p1'])
  })

  it('are made for a paddle saved before they existed, the first time it is listed', async () => {
    await fs.mkdir(path.dirname(file('old', 'session.json')), { recursive: true })
    await fs.writeFile(file('old', 'session.json'), JSON.stringify(paddle('old')))
    expect((await listSessionSummaries(U)).map(s => s.id)).toEqual(['old'])
    expect(JSON.parse(await fs.readFile(file('old', 'summary.json'), 'utf8')).id).toBe('old')
  })

  // #852: lists tell one outing recorded twice from these, not from the tracks.
  it('carry where the paddle was every 20 s, small enough for a list', async () => {
    await saveSession(paddle('p1') as never)
    const sum = JSON.parse(await fs.readFile(file('p1', 'summary.json'), 'utf8'))
    expect(sum.places.from).toBe(t0 / 1000)
    const pts = decodePlaces(sum.places)
    expect(pts).toHaveLength(15)                                      // 10:00:00 to 10:04:40, a 300 s paddle
    expect(pts[3]![0]).toBeCloseTo(51.5 + 60 * 0.00003, 5)
  })

  describe('from before places existed', () => {
    // A paddle saved with a summary that has no places, as before #852.
    const old = async (id: string, paddledAt: string) => {
      await saveSession({ ...paddle(id), paddledAt } as never)
      const sum = JSON.parse(await fs.readFile(file(id, 'summary.json'), 'utf8'))
      delete sum.places
      await fs.writeFile(file(id, 'summary.json'), JSON.stringify(sum))
    }
    const stored = async (id: string) => JSON.parse(await fs.readFile(file(id, 'summary.json'), 'utf8'))
    const byId = async (opts?: { writeBack?: boolean }) => Object.fromEntries((await listSessionSummaries(U, opts)).map(s => [s.id, s]))

    it('get them, written back, only when another paddle overlaps in time', async () => {
      await old('a', '2026-09-01T10:00:00Z')
      await old('b', '2026-09-01T10:00:30Z')                          // the same outing, from another source
      await old('alone', '2026-09-05T10:00:00Z')
      const s = await byId()
      expect(s.a.places?.d.length).toBeGreaterThan(0)
      expect(s.b.places?.d.length).toBeGreaterThan(0)
      expect(s.alone.places).toBeUndefined()                          // nothing to tell apart: not read in full
      expect((await stored('a')).places.d.length).toBeGreaterThan(0)
    })

    it('get them only once: the second list reads no paddle in full', async () => {
      await old('a', '2026-09-01T10:00:00Z')
      await old('b', '2026-09-01T10:00:30Z')
      await listSessionSummaries(U)
      // Spoil both paddles: a second rebuild would read them and mark them empty.
      await fs.writeFile(file('a', 'session.json'), '{ not json')
      await fs.writeFile(file('b', 'session.json'), '{ not json')
      const s = await byId()
      expect(s.a.places?.d.length).toBeGreaterThan(0)
      expect(s.b.places?.d.length).toBeGreaterThan(0)
    })

    it(`rebuild at most ${PLACES_REBUILD_MAX} a call, newest first; the rest wait for the next`, async () => {
      // Ids that don't follow time (id order is the order storage lists them in).
      const n = PLACES_REBUILD_MAX + 5
      const at = (i: number) => new Date(t0 + i * 1000).toISOString()
      for (let i = 0; i < n; i++) await old(`p${String((i * 7) % n).padStart(2, '0')}`, at(i))
      const first = await listSessionSummaries(U)
      expect(first.filter(s => s.places).length).toBe(PLACES_REBUILD_MAX)
      expect(first.filter(s => !s.places).map(s => s.paddledAt).sort()).toEqual([0, 1, 2, 3, 4].map(at))   // the five oldest wait
      expect(Object.values(await byId()).every(s => s.places)).toBe(true)
    })

    it('treat places in an unknown shape as none, and rebuild them', async () => {
      await old('a', '2026-09-01T10:00:00Z')
      await old('b', '2026-09-01T10:00:30Z')
      const sum = await stored('a')
      sum.places = { from: t0 / 1000, pts: [[51.5, -0.1], [51.5018, -0.1]] }               // an early draft: one a minute
      await fs.writeFile(file('a', 'summary.json'), JSON.stringify(sum))
      expect(decodePlaces(sum.places)).toEqual([])
      const s = await byId()
      expect(s.a.places?.every).toBe(20)
      expect(decodePlaces(s.a.places!).length).toBeGreaterThan(0)
    })

    it('mark an unreadable paddle so it is not tried on every call, and never fail the list', async () => {
      await old('a', '2026-09-01T10:00:00Z')
      await old('b', '2026-09-01T10:00:30Z')
      await old('c', '2026-09-01T10:00:40Z')
      await fs.writeFile(file('a', 'session.json'), '{ not json')                 // read, but corrupt
      await fs.writeFile(file('b', 'session.json'), JSON.stringify({ id: 'b' }))  // readable, but no result: toSummary throws
      const s = await byId()
      expect(s.a.places).toEqual({ from: 0, every: 20, d: [] })                   // marked: empty places, never grouped
      expect(s.b.places).toEqual({ from: 0, every: 20, d: [] })
      expect(s.c.places?.d.length).toBeGreaterThan(0)
      expect((await stored('a')).places.d).toEqual([])
    })

    it('a paddle without a summary that cannot be read is left out, not the whole list', async () => {
      await saveSession(paddle('good') as never)
      await fs.mkdir(path.dirname(file('bad', 'session.json')), { recursive: true })
      await fs.writeFile(file('bad', 'session.json'), JSON.stringify({ id: 'bad', paddledAt: '2026-09-01T10:00:00Z' }))
      expect((await listSessionSummaries(U)).map(s => s.id)).toEqual(['good'])
    })

    it("are never written for anyone but the owner (a buddy's list, their sections)", async () => {
      await old('a', '2026-09-01T10:00:00Z')
      await old('b', '2026-09-01T10:00:30Z')
      await fs.mkdir(path.dirname(file('nosum', 'session.json')), { recursive: true })
      await fs.writeFile(file('nosum', 'session.json'), JSON.stringify({ ...paddle('nosum'), paddledAt: '2026-09-07T10:00:00Z' }))
      const before = await stored('a')
      const s = await byId({ writeBack: false })
      expect(Object.keys(s).sort()).toEqual(['a', 'b', 'nosum'])
      expect(s.a.places).toBeUndefined()
      expect(await stored('a')).toEqual(before)
      await expect(fs.stat(file('nosum', 'summary.json'))).rejects.toThrow()
    })
  })

  it('rebuilds at most four at a time', async () => {
    let now = 0, most = 0
    await eachLimited(Array.from({ length: 20 }, (_, i) => i), PLACES_REBUILD_AT_ONCE, async () => {
      most = Math.max(most, ++now)
      await new Promise(r => setTimeout(r, 2))
      now--
    })
    expect(most).toBe(4)
  })

  it('follow an edit and go with a delete', async () => {
    await saveSession(paddle('p2') as never)
    await updateSessionNote(U, 'p2', 'windy')
    expect((await listSessionSummaries(U))[0].note).toBe('windy')
    await deleteSession(U, 'p2')
    expect(await listSessionSummaries(U)).toEqual([])
    await expect(fs.stat(file('p2', 'summary.json'))).rejects.toThrow()
  })
})

// A paddle written any other way than saveSession would leave its summary
// stale. Only the analysis store may write a paddle's session.json.
describe('who writes a paddle', () => {
  const repo = path.resolve(__dirname, '../../../..')
  const walk = (d: string): string[] => readdirSync(d).flatMap(f => {
    const p = path.join(d, f)
    if (/node_modules|\.next|\.local-data|\.open-next|dist/.test(p)) return []
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : []
  })
  it('is only the analysis store', () => {
    const offenders = [...walk(path.join(repo, 'packages')), ...walk(path.join(repo, 'apps/web/src')), ...walk(path.join(repo, 'apps/web/scripts'))]
      .filter(f => !f.endsWith('analysis-store.ts'))
      .filter(f => {
        // Mentions paddle files (analysis/…/session.json) AND writes objects:
        // catches a key built in a variable, as yesterday's backfill script did.
        const src = readFileSync(f, 'utf8')
        return /analysis\//.test(src) && /session\\?\.json/.test(src) && /\bput(Json|Object)\(/.test(src)
      })
    expect(offenders).toEqual([])
  })
})
