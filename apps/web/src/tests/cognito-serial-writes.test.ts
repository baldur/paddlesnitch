// @vitest-environment node
// #901: the test cognito-local wrote its database file with overlapping
// fs.writeFile calls, so tests reading codes from it found a half-written file,
// sent no code and got a 400. cognito-serial-writes.mjs makes each write whole
// and in order; this checks it does, on the engine cognito-local really uses.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'module'
import { mkdtemp, rm, readFile } from 'fs/promises'
import { readFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const require = createRequire(import.meta.url)
const cognitoDir = path.dirname(require.resolve('cognito-local/package.json'))
type Engine = { path: string; async: boolean; init(): unknown; write(data: unknown): Promise<void> | null }
const StormDB = require(require.resolve('stormdb', { paths: [cognitoDir] })) as {
  localFileEngine: { new (path: string, opts?: { async?: boolean }): Engine; prototype: { write: { serialWrites?: boolean } } }
}

let dir: string
beforeAll(async () => {
  await import('./cognito-serial-writes.mjs')
  dir = await mkdtemp(path.join(tmpdir(), 'serial-writes-'))
})
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('cognito-local database file (#901)', () => {
  it('is written by the async engine the preload replaces', async () => {
    expect(StormDB.localFileEngine.prototype.write.serialWrites).toBe(true)
    // Build the store as cognito-local does: if stormdb or cognito-local stops
    // using the async engine, the patch does nothing, and this says so.
    const { StormDBDataStoreFactory } = require(path.join(cognitoDir, 'lib/services/dataStore/stormDb.js'))
    const quiet = { debug() {}, info() {}, warn() {}, error() {} }
    const store = await new StormDBDataStoreFactory(dir).create({ logger: quiet }, 'pool', { Users: {} })
    expect(store.db.engine).toBeInstanceOf(StormDB.localFileEngine)
    expect(store.db.engine.async).toBe(true)
  })

  it('a reader never sees a half-written file, and the last write wins, while writes overlap', async () => {
    const engine = new StormDB.localFileEngine(path.join(dir, 'p.json'), { async: true })
    engine.init()
    let torn = 0, reads = 0, stop = false
    const reader = (async () => {
      while (!stop) {
        reads++
        try { JSON.parse(readFileSync(engine.path, 'utf8')) } catch { torn++ }
        await new Promise(r => setImmediate(r))
      }
    })()
    const writes = []
    for (let i = 0; i < 200; i++) writes.push(engine.write({ i, pad: 'x'.repeat(i % 2 ? 2_000_000 : 10) }))
    await Promise.all(writes)
    stop = true
    await reader
    expect(torn).toBe(0)
    expect(reads).toBeGreaterThan(1)   // the reader ran while the writes did
    expect(JSON.parse(await readFile(engine.path, 'utf8')).i).toBe(199)
  })
})
