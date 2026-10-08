// Phase 3 of docs/features/performance.md: the server runs on Graviton and is
// kept warm. Both are one-line reverts; these tests keep the pieces in step.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const repo = path.resolve(__dirname, '../../../..')
const stack = readFileSync(path.join(repo, 'infra/lib/att-stack.ts'), 'utf8')
const openNext = readFileSync(path.join(repo, 'apps/web/open-next.config.ts'), 'utf8')
const serverFn = stack.slice(stack.indexOf("new lambda.Function(this, 'ServerFn'"), stack.indexOf('const serverUrl'))

describe('server warm + Graviton', () => {
  it('runs the server on arm64 and installs its packages for arm64', () => {
    expect(serverFn).toContain('architecture: lambda.Architecture.ARM_64')
    expect(openNext).toMatch(/arch: 'arm64'/)
  })

  it("sends OpenNext's warmer event every 5 minutes, without retries", () => {
    const rule = stack.slice(stack.indexOf("new events.Rule(this, 'ServerWarmer'"), stack.indexOf('const serverUrl'))
    expect(rule).toContain('rate(cdk.Duration.minutes(5))')
    expect(rule).toContain('new eventsTargets.LambdaFunction(serverFn')
    // The handler only skips Next for an event with a `type` of 'warmer'.
    expect(rule).toMatch(/type: 'warmer'/)
    expect(rule).toContain('retryAttempts: 0')
  })
})
