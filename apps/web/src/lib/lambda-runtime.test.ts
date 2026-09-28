// Every Lambda runs the same Node major as CI. Node 20 reached end of life in
// April 2026; AWS blocks updates to a deprecated runtime some months later,
// and from then on EVERY deploy fails (security audit 2026-09).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const repo = path.resolve(__dirname, '../../../..')
const stack = readFileSync(path.join(repo, 'infra/lib/att-stack.ts'), 'utf8')
const ci = readFileSync(path.join(repo, '.github/workflows/deploy.yml'), 'utf8')

describe('Lambda runtime', () => {
  it('every function runs the Node major CI builds with', () => {
    const ciMajor = /node-version: '(\d+)'/.exec(ci)![1]
    const runtimes = [...stack.matchAll(/lambda\.Runtime\.NODEJS_(\d+)_X/g)].map(m => m[1])
    expect(runtimes.length).toBeGreaterThanOrEqual(6)
    expect(new Set(runtimes)).toEqual(new Set([ciMajor]))
  })
})
