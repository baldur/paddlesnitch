// The web server must not be able to write tracker updates. Every tracker
// downloads whatever firmware/ points at, so a server bug or a break-in that
// could write there would reach every tracker. Releases are written by the
// release workflow's own role, never by the server. Trackers also check a
// signature now; this Deny keeps the channel pointer (which version is current)
// out of the server's reach too, so it cannot even roll trackers back.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const root = path.join(__dirname, '../../../..')
const read = (p: string) => readFileSync(path.join(root, p), 'utf8')

describe('the server cannot write firmware', () => {
  it('denies the server function writes and deletes under firmware/', () => {
    const stack = read('infra/lib/att-stack.ts')
    const at = stack.indexOf("sid: 'NoFirmwareWrites'")
    expect(at).toBeGreaterThan(-1)
    const stmt = stack.slice(at - 200, at + 400)
    expect(stmt).toContain('serverFn.addToRolePolicy')
    expect(stmt).toContain('effect: iam.Effect.DENY')
    expect(stmt).toContain("'s3:PutObject'")
    expect(stmt).toContain("'s3:DeleteObject'")
    expect(stmt).toContain("dataBucket.arnForObjects('firmware/*')")
  })

  it('no server code writes under firmware/ (it would be denied in production)', () => {
    // publishFirmware/promoteFirmware exist for tests and scripts only.
    for (const f of ['apps/web/src/app/api/devices/firmware/route.ts',
                     'apps/web/src/app/api/devices/firmware/ack/route.ts']) {
      expect(read(f)).not.toMatch(/publishFirmware|promoteFirmware/)
    }
  })
})
