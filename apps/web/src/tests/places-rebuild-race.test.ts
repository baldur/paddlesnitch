// @vitest-environment node
// Rebuilding an old summary's places (#852) reads the full paddle, then writes
// the summary. If the owner saves the paddle in between (Hide from buddies, a
// note) or deletes it, the rebuild must not write its older copy over that.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'

// Runs while the rebuild reads a full paddle: the owner acting meanwhile.
let meanwhile: ((key: string) => Promise<void>) | null = null
// Full-paddle reads: how many at once, at most; and ones that fail outright.
let reading = 0, mostAtOnce = 0, slowMs = 0
const failing = new Set<string>()
vi.mock('@paddlesnitch/core/storage', async importOriginal => {
  const real = await importOriginal<typeof import('@paddlesnitch/core/storage')>()
  return {
    ...real,
    getObject: async (key: string) => {
      if (!key.endsWith('/session.json')) return real.getObject(key)
      if (failing.has(key.split('/').at(-2)!)) throw new Error('storage unavailable')
      mostAtOnce = Math.max(mostAtOnce, ++reading)
      try {
        if (slowMs) await new Promise(r => setTimeout(r, slowMs))
        const v = await real.getObject(key)
        if (meanwhile) { const f = meanwhile; meanwhile = null; await f(key) }
        return v
      } finally { reading-- }
    },
  }
})

const { saveSession, deleteSession, listSessionSummaries, updateSessionHidden, PLACES_REBUILD_AT_ONCE } = await import('@paddlesnitch/analysis/analysis-store')
const { analyseTrack } = await import('@paddlesnitch/analysis/analysis')

const U = 'user-race'
let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'places-race-'))
  process.env.USE_LOCAL_STORAGE = 'true'
  process.env.DATA_DIR = dir
})
afterEach(async () => { meanwhile = null; failing.clear(); slowMs = 0; mostAtOnce = 0; await fs.rm(dir, { recursive: true, force: true }); delete process.env.DATA_DIR })

const t0 = Date.parse('2026-09-01T10:00:00Z')
const file = (id: string, name: string) => path.join(dir, 'analysis', U, id, name)
async function old(id: string, paddledAt: string) {
  await saveSession({
    id, userId: U, createdAt: paddledAt, paddledAt, source: { type: 'file' }, doubleStrokeRate: false, note: '', insight: '',
    result: analyseTrack(Array.from({ length: 300 }, (_, i) => ({ lat: 51.5 + i * 0.00003, lng: -0.1, timestamp: new Date(t0 + i * 1000), strokeRate: 56 })), {}),
  } as never)
  const sum = JSON.parse(await fs.readFile(file(id, 'summary.json'), 'utf8'))
  delete sum.places
  await fs.writeFile(file(id, 'summary.json'), JSON.stringify(sum))
}

describe('rebuilding places while the owner acts', () => {
  it('keeps a hide made meanwhile', async () => {
    await old('a', '2026-09-01T10:00:00Z')
    await old('b', '2026-09-01T10:00:30Z')
    meanwhile = async key => { await updateSessionHidden(U, key.split('/').at(-2)!, true) }
    await listSessionSummaries(U)
    const hidden = await Promise.all(['a', 'b'].map(async id => JSON.parse(await fs.readFile(file(id, 'summary.json'), 'utf8')).hiddenFromBuddies))
    expect(hidden.filter(Boolean)).toHaveLength(1)                     // the one hidden meanwhile stayed hidden
  })

  it('does not bring back the summary of a paddle deleted meanwhile', async () => {
    await old('a', '2026-09-01T10:00:00Z')
    await old('b', '2026-09-01T10:00:30Z')
    let gone = ''
    meanwhile = async key => { gone = key.split('/').at(-2)!; await deleteSession(U, gone) }
    await listSessionSummaries(U)
    await expect(fs.stat(file(gone, 'summary.json'))).rejects.toThrow()
  })

  it(`reads at most ${PLACES_REBUILD_AT_ONCE} paddles at once`, async () => {
    for (let i = 0; i < 12; i++) await old(`p${i}`, new Date(t0 + i * 1000).toISOString())
    slowMs = 5
    await listSessionSummaries(U)
    expect(mostAtOnce).toBe(PLACES_REBUILD_AT_ONCE)
  })

  it('a read that fails is tried again next call, not marked', async () => {
    await old('a', '2026-09-01T10:00:00Z')
    await old('b', '2026-09-01T10:00:30Z')
    failing.add('a')
    const first = Object.fromEntries((await listSessionSummaries(U)).map(s => [s.id, s]))
    expect(first.a.places).toBeUndefined()                            // not marked empty
    expect(first.b.places?.d.length).toBeGreaterThan(0)
    expect(JSON.parse(await fs.readFile(file('a', 'summary.json'), 'utf8')).places).toBeUndefined()
    failing.clear()
    const second = Object.fromEntries((await listSessionSummaries(U)).map(s => [s.id, s]))
    expect(second.a.places?.d.length).toBeGreaterThan(0)
  })
})
