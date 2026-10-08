// Pull requests run the unit tests and the typecheck before they merge, not
// only the deploy after (a failing test once reached main and stopped the
// deploy: #381). Read-only: a PR from anyone must not reach secrets or AWS.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const workflow = readFileSync(path.resolve(__dirname, '../../../../.github/workflows/checks.yml'), 'utf8')
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../../../package.json'), 'utf8'))

describe('PR checks', () => {
  it('run on every pull request', () => expect(workflow).toMatch(/on:\n\s+pull_request:/))
  it('run the unit tests and the typecheck', () => {
    expect(workflow).toContain('run: pnpm test')
    expect(workflow).toContain('run: pnpm typecheck')
    expect(pkg.scripts.typecheck).toContain('tsc --noEmit')
  })
  it('are read-only: no secrets, no AWS, no environment', () => {
    expect(workflow).toMatch(/permissions:\n\s+contents: read/)
    expect(workflow).not.toMatch(/secrets\.|id-token|environment:|aws-actions/)
  })
})
