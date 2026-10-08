// Dates read one way across the site, from @paddlesnitch/core/format. Eight
// pages had their own formatter (browser locale and time zone: "13 Sept 2026"
// on one page, "Sep 13, 2026" on another), and on server-rendered pages the
// server's and the browser's versions disagreed (hydration errors, 2026-10-08).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'

const repo = path.resolve(__dirname, '../../../..')
const roots = ['apps/web/src', 'packages']
// The AI prompt spells the month out in full; it's never shown as a date on a page.
const allowed = new Set(['packages/analysis/src/llm.ts'])

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = path.join(dir, n)
    if (n === 'node_modules' || n.startsWith('.')) return []
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : []
  })
}

describe('one date format', () => {
  it('no page writes a date with the browser locale (toLocaleDateString / toLocaleTimeString / toLocaleString on a Date)', () => {
    const offenders = roots.flatMap(r => files(path.join(repo, r)))
      .filter(f => !allowed.has(path.relative(repo, f)))
      .filter(f => /toLocaleDateString|toLocaleTimeString|\)\.toLocaleString\((undefined|'en)/.test(readFileSync(f, 'utf8')))
      .map(f => path.relative(repo, f))
    expect(offenders).toEqual([])
  })
})
