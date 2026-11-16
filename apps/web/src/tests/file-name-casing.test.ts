import { describe, it, expect } from 'vitest'
import { readdirSync } from 'fs'
import { join, parse } from 'path'

// On a case-insensitive disk (macOS) `import './analytics'` from Analytics.tsx
// resolved to Analytics.tsx itself under webpack, because .tsx is tried before
// .ts. Every page then crashed with "startAnalytics is not a function". Two
// files in one folder whose import names differ only in case must never exist.
const ROOT = join(__dirname, '..', '..', '..', '..')
const DIRS = ['packages', 'apps/web/src']
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/

function clashes(dir: string, out: string[]) {
  const entries = readdirSync(dir, { withFileTypes: true })
  const seen = new Map<string, string>()
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      clashes(full, out)
      continue
    }
    if (!CODE.test(e.name)) continue
    // What an extensionless import sees: the name without its extension.
    const key = parse(e.name).name.toLowerCase()
    const other = seen.get(key)
    if (other && parse(other).name !== parse(e.name).name) out.push(`${join(dir, other)} vs ${e.name}`)
    else seen.set(key, e.name)
  }
}

describe('file names', () => {
  it('has no two code files in one folder whose import names differ only in case', () => {
    const out: string[] = []
    for (const d of DIRS) clashes(join(ROOT, d), out)
    expect(out).toEqual([])
  })
})
