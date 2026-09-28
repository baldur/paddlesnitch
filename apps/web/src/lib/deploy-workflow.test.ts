// The deploy workflow's safety rails (resilience audit 2026-09).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const wf = readFileSync(path.resolve(__dirname, '../../../../.github/workflows/deploy.yml'), 'utf8')

describe('deploy workflow', () => {
  it('runs one deploy at a time and never cancels one mid-update', () => {
    expect(wf).toMatch(/concurrency:\n\s+group: deploy\n\s+cancel-in-progress: false/)
  })
  it('checks the live site after deploying', () => {
    expect(wf).toMatch(/name: Smoke test/)
    expect(wf.indexOf('name: Smoke test')).toBeGreaterThan(wf.indexOf('name: Deploy'))
  })
})
