// Every call to an outside service gives up in seconds, not at the 30 s Lambda
// limit (resilience audit 2026-09: Strava, the GitHub issue call and the
// Cognito key fetch had no timeout, so one slow service held requests open).
// Reads the source: every fetch( in these files must carry a signal.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const repo = path.resolve(__dirname, '../../../..')
const FILES = [
  'packages/core/src/strava.ts',
  'packages/core/src/cognito.ts',
  'apps/web/src/app/att/api/feedback/route.ts',
]

describe('outside calls time out', () => {
  it.each(FILES)('%s', f => {
    const src = readFileSync(path.join(repo, f), 'utf8')
    const calls = [...src.matchAll(/\bfetch\(/g)].map(m => src.slice(m.index!, m.index! + 400))
    expect(calls.length, f).toBeGreaterThan(0)
    for (const c of calls) expect(c.slice(0, c.indexOf('\n})') > 0 ? c.indexOf('\n})') + 3 : 400), f).toMatch(/signal:/)
  })
})
