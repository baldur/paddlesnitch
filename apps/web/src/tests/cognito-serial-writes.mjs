// Loaded into cognito-local with `node --import` (cognito-test-server.ts, and
// scripts/dev.ts for local dev and E2E).
//
// cognito-local keeps the pool in memory and, after every change, rewrites the
// whole pool to one JSON file with fs.writeFile (stormdb's async engine). Writes
// from parallel test files overlap on that one path: the file is truncated and
// half-written most of the time once the pool is a suite's size, and an older
// snapshot can land after a newer one. Tests read sign-up and reset codes from
// that file (cognito-db.ts), so they got no code, sent none, and got a 400
// (#901). Here every write goes to a temp file and is renamed into place, one
// after another in the order they were made: a reader only ever sees a whole
// file, and the file always ends on the newest snapshot.
// cognito-serial-writes.test.ts checks this, and that cognito-local's engine
// is the async one this replaces.
import { createRequire } from 'module'
import { promises as fs } from 'fs'
import path from 'path'

const require = createRequire(import.meta.url)
const cognitoDir = path.dirname(require.resolve('cognito-local/package.json'))
const StormDB = require(require.resolve('stormdb', { paths: [cognitoDir] }))
const Engine = StormDB.localFileEngine
const original = Engine.prototype.write
const queues = new Map()
let seq = 0

if (!original.serialWrites) {
  const write = function (data) {
    if (!this.async) return original.call(this, data)
    const text = this.serialize(data)   // the snapshot as of this call, as before
    const tmp = `${this.path}.${process.pid}.${++seq}.tmp`
    const done = (queues.get(this.path) ?? Promise.resolve())
      .catch(() => {})
      .then(() => fs.writeFile(tmp, text))
      .then(() => fs.rename(tmp, this.path))
    queues.set(this.path, done)
    return done
  }
  write.serialWrites = true
  Engine.prototype.write = write
}
