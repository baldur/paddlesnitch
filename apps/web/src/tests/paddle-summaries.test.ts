// @vitest-environment node
// The Paddles page read every paddle in full, twice (6.5 MB for 61 paddles,
// mostly map points). Each paddle now has a small summary beside it, written
// with the paddle, and lists read only those.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { saveSession, deleteSession, listSessionSummaries, updateSessionNote } from '@paddlesnitch/analysis/analysis-store'
import { listPaddleCards } from '@paddlesnitch/core/paddle-store'
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
    expect((await listPaddleCards(U)).map(c => c.id)).toEqual(['p1'])
  })

  it('are made for a paddle saved before they existed, the first time it is listed', async () => {
    await fs.mkdir(path.dirname(file('old', 'session.json')), { recursive: true })
    await fs.writeFile(file('old', 'session.json'), JSON.stringify(paddle('old')))
    expect((await listSessionSummaries(U)).map(s => s.id)).toEqual(['old'])
    expect(JSON.parse(await fs.readFile(file('old', 'summary.json'), 'utf8')).id).toBe('old')
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
