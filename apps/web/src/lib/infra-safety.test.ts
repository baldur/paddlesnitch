// Safety settings on the production stack (security audit 2026-09). Each one
// was missing; each is cheap; none is visible until the day it matters, so a
// refactor could drop it without anyone noticing. This reads the CDK source.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const repo = path.resolve(__dirname, '../../../..')
const stack = readFileSync(path.join(repo, 'infra/lib/att-stack.ts'), 'utf8')
const app = readFileSync(path.join(repo, 'infra/bin/att.ts'), 'utf8')
const privacy = readFileSync(path.join(repo, 'apps/web/src/app/privacy/page.tsx'), 'utf8')
const dataBucket = stack.slice(stack.indexOf("new s3.Bucket(this, 'DataBucket'"), stack.indexOf("new s3.Bucket(this, 'AssetsBucket'"))

describe('production safety settings', () => {
  it('the data bucket keeps earlier versions for 30 days and refuses plain HTTP', () => {
    expect(dataBucket).toMatch(/versioned: true/)
    expect(dataBucket).toMatch(/noncurrentVersionExpiration: cdk\.Duration\.days\(30\)/)
    expect(dataBucket).toMatch(/enforceSSL: true/)
  })

  it('the privacy page says deleted data lasts 30 days in those versions', () => {
    expect(privacy).toMatch(/30 days/)
  })

  it('the user pool and the stack are protected from deletion', () => {
    expect(stack).toMatch(/deletionProtection: true/)
    expect(app).toMatch(/terminationProtection: true/)
  })

  it('every Lambda keeps its logs for a set time, not for ever', () => {
    const fns = stack.match(/new lambda\.Function\(this, '[A-Za-z]+', \{[\s\S]*?\n    \}\)/g) ?? []
    expect(fns.length).toBeGreaterThanOrEqual(6)
    for (const f of fns) expect(f, f.slice(0, 60)).toMatch(/logRetention: LOG_RETENTION/)
  })

  it('alarms and a budget email someone', () => {
    expect(stack).toMatch(/new sns\.Topic\(this, 'AlertsTopic'/)
    for (const a of ['ServerCrashAlarm', 'ServerErrorLogAlarm', 'FirmwareBootFailedAlarm', 'SesBounceAlarm']) expect(stack).toContain(`'${a}'`)
    expect(stack).toMatch(/new budgets\.CfnBudget/)
  })
})
