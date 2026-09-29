// The automatic intake runs on issues anyone can write (the anonymous feedback
// widget files them in this public repo), so it may read and comment, nothing
// more (security audit 2026-09; the owner chose "keep it running, restricted").
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const read = (f: string) => readFileSync(path.resolve(__dirname, '../../../../.github/workflows', f), 'utf8')
const intake = read('claude-intake.yml')

describe('Claude intake is read-and-comment only', () => {
  it('cannot push or edit files', () => {
    expect(intake).toMatch(/contents: read/)
    expect(intake).not.toMatch(/contents: write|pull-requests: write/)
    const tools = /--allowedTools ([^"]+)/.exec(intake)![1].split(',')
    expect(tools).not.toContain('Edit')
    expect(tools).not.toContain('Write')
    // Bash only as specific `gh issue` commands, never bare.
    for (const t of tools.filter(t => t.startsWith('Bash'))) expect(t).toMatch(/^Bash\(gh issue (view|comment|edit):\*\)$/)
  })

  it('both Claude workflows pin the action to a commit', () => {
    for (const f of ['claude-intake.yml', 'claude-fast-loop.yml']) {
      expect(read(f), f).toMatch(/anthropics\/claude-code-action@[0-9a-f]{40}\b/)
    }
  })
})
