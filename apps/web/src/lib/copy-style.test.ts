// The site's words follow a short style guide (docs: CLAUDE.md "Writing for
// the site"): one name per thing, plain words, errors that say what to do.
// This scans every page, component and route for phrases we removed, so they
// don't creep back. Comments are skipped; only code and text are checked.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'

const repo = path.resolve(__dirname, '../../../..')
const ROOTS = ['apps/web/src/app', 'apps/web/src/components', 'apps/web/src/lib', 'packages/ui/src', 'packages/analysis/src']

function files(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...files(full))
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(full)
  }
  return out
}

// Code and visible text only: drop // and /* */ comments and JSX {/* */}.
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')
}

// [phrase, why it's banned]
const BANNED: [RegExp, string][] = [
  [/narrated by/, 'no AI model names on screen'],
  [/\bMY (PADDLES|DEVICES|PROFILE|TRACKER)\b/, 'the menu and pages dropped "My"'],
  [/['">]SETTINGS['"<]/, 'the page is called Account'],
  [/YOUR ACCOUNT/, 'the page is called Account'],
  [/Automated Time Trials|AUTOMATED TIME TRIALS|PADDLE ANALYSIS/, 'the sections are Trials and Paddles'],
  [/Missing required fields|Invalid token|state mismatch|token exchange|not configured on this/, 'errors say what to do, not what broke inside'],
  [/'Could not |"Could not |>Could not /, 'errors start with "Couldn’t …"'],
  [/'[A-Z][a-z]+ failed'/, 'errors say what failed and what to do'],
  [/\bdigs?\b|breathers?\b|rock-steady|\(fatigue\)/, 'plain words for efforts and rests'],
  [/growing suite|seamless|unlock|journey|actually happened|no-bloat|GO DEEPER/i, 'no marketing filler'],
  [/RESCIND|Tears down|GEOMETRY \(/, 'plain words'],
  [/not derivable|motion sidecar|OPEN FULL VIEW|Boat attitude|Rock evenness|no cadence|\bfw \b/, 'tracker pages speak to paddlers, not firmware developers (engineering detail lives under TECHNICAL DETAILS)'],
]

describe('site copy follows the style guide', () => {
  const sources = ROOTS.flatMap(r => files(path.join(repo, r))).map(f => ({ f: path.relative(repo, f), text: withoutComments(readFileSync(f, 'utf8')) }))

  it.each(BANNED)('nothing says %s', (re, why) => {
    const hits = sources.flatMap(({ f, text }) =>
      text.split('\n').flatMap((line, i) => (re.test(line) ? [`${f}:${i + 1}: ${line.trim().slice(0, 100)}`] : [])))
    expect(hits, why).toEqual([])
  })
})
