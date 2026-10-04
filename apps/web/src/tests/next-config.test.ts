// `next dev` (16.3+) writes AGENTS.md + CLAUDE.md into apps/web whenever an AI
// coding agent starts it, and re-creates them if deleted, leaving untracked
// files in every worktree. The repo's root CLAUDE.md already covers this.
import { describe, it, expect } from 'vitest'
import nextConfig from '../../next.config'

describe('next.config', () => {
  it('next dev does not write AGENTS.md / CLAUDE.md into the app', () => {
    expect(nextConfig.agentRules).toBe(false)
  })
})
