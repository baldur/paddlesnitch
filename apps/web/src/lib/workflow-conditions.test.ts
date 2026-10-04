// A `#` line inside a block-scalar `if: >` is NOT a YAML comment: it becomes
// part of the expression, GitHub can't parse it, and the whole workflow stops
// running. That silently disabled the Claude fast loop from 29 Sep 2026 (#305)
// — every push showed "workflow file issue" and no comment ever triggered it.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import path from 'path'

const dir = path.resolve(__dirname, '../../../../.github/workflows')
const workflows = readdirSync(dir).filter(f => /\.ya?ml$/.test(f))

// Lines of every `if: >` / `if: |` block (the more-indented lines after it).
function blockIfLines(src: string): string[] {
  const lines = src.split('\n'), out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)if:\s*[>|][-+]?\s*$/.exec(lines[i])
    if (!m) continue
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]
      if (l.trim() && l.search(/\S/) <= m[1].length) break
      out.push(l)
    }
  }
  return out
}

describe('workflow conditions', () => {
  it.each(workflows)('%s has no comment lines inside a multi-line if:', f => {
    const comments = blockIfLines(readFileSync(path.join(dir, f), 'utf8')).filter(l => l.trim().startsWith('#'))
    expect(comments).toEqual([])
  })
})
