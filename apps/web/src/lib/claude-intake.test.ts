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
    // Claude only reads: no shell, no Edit/Write (2026-10-24).
    expect(tools.sort()).toEqual(['Glob', 'Grep', 'Read'])
  })

  it('the workflow, not Claude, claims the issue and posts the comment', () => {
    // Claude's `gh issue` calls were silently denied by the tool permission
    // rules, so runs "succeeded" with no comment; its final answer is posted instead.
    expect(intake).toMatch(/gh issue edit "\$ISSUE" --add-label claude-active/)
    expect(intake).toMatch(/execution_file/)
    expect(intake).toMatch(/gh issue comment "\$ISSUE" --body-file/)
  })

  it('only auto-runs on customer issues, never for a bot', () => {
    expect(intake).toMatch(/contains\(github\.event\.issue\.labels\.\*\.name, 'customer-reported'\)/)
    expect(intake).toMatch(/github\.actor != 'claude\[bot\]'/)
    expect(intake).toMatch(/github\.actor != 'github-actions\[bot\]'/)
  })

  it('both Claude workflows pin the action to a commit', () => {
    for (const f of ['claude-intake.yml', 'claude-fast-loop.yml']) {
      expect(read(f), f).toMatch(/anthropics\/claude-code-action@[0-9a-f]{40}\b/)
    }
  })
})
