// The site's words follow a short style guide (docs: CLAUDE.md "Writing for
// the site"): one name per thing, plain words, errors that say what to do.
// This scans every page, component and route for phrases we removed, so they
// don't creep back. Comments are skipped; only code and text are checked.
// The Android and iPhone apps' words get the same list (#794): their string
// resources and the quoted text in their main sources, without comments, log
// lines, keys or tests.
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
  [/\bMy (Paddles|Devices|Profile|Tracker)\b/, 'the pages dropped "My", in prose too'],
  [/\bREVOKE\b|was revoked/, 'plain words: "turn off" a link, "remove" a tracker'],
  [/>not linked</, 'a tracker taken off an account is "removed"'],
  [/doesn&apos;t exist, or you can&apos;t see it|doesn't exist, or you can't see it/, "don't blame the reader: \"We can't find this …\""],
  [/📓|🔒|(COPIED|SAVED|saved) ✓/, 'no emoji, and no ticks inside button labels'],
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

// ── The apps (#794) ─────────────────────────────────────────────────────────
// Kotlin and Swift: every "…" or """…""" literal outside comments, with its
// line. Android resources: the text of each <string> and <item>. iOS
// project.yml: the Info.plist texts iOS shows (app name, permission prompts).
// Not checked: test folders, log calls, and literals that read like a key,
// URL or identifier (no spaces, no capitals).

type Hit = { line: number; text: string }

// Logging and debug output, never shown to a paddler: a literal is skipped
// when its own statement (the line before it, back to the last `;`) is one.
const LOG_CALL = /\b(Log\.[a-z]|println|print|debugPrint|NSLog|os_log|logger\.\w+)\(/
// A key, URL, path, format or identifier, not words. This also skips a lone
// lowercase word such as "unlock": the cost of not reading keys as text.
const KEY_LIKE = /^[a-z0-9_.:/%+-]*$/

function literals(src: string): Hit[] {
  const out: Hit[] = []
  let line = 1
  let i = 0
  while (i < src.length) {
    if (src[i] === '\n') { line++; i++; continue }
    if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; continue }
    if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2)
      const stop = end < 0 ? src.length : end + 2
      line += src.slice(i, stop).split('\n').length - 1
      i = stop
      continue
    }
    if (src.startsWith(`'"'`, i)) { i += 3; continue } // Kotlin's '"' char
    if (src[i] === '"') {
      const triple = src.startsWith('"""', i)
      const open = triple ? 3 : 1
      let j = i + open
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue }
        if (triple ? src.startsWith('"""', j) : src[j] === '"' || src[j] === '\n') break
        j++
      }
      // Interpolated code (Kotlin ${…} and $name, Swift \(…)) is not text.
      const text = src.slice(i + open, j).replace(/\$\{[^}]*\}|\$\w+|\\\([^)]*\)/g, '…')
      const statement = src.slice(src.lastIndexOf('\n', i) + 1, i).split(';').pop() ?? ''
      if (!LOG_CALL.test(statement) && !KEY_LIKE.test(text)) out.push({ line, text })
      line += text.split('\n').length - 1
      // A one-line string cut short at a newline (a '"' char, a Swift raw
      // string) leaves the newline to be counted, so lines stay right.
      i = triple ? j + 3 : src[j] === '\n' ? j : j + 1
      continue
    }
    i++
  }
  return out
}

function xmlStrings(src: string): Hit[] {
  const clean = src.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '))
  return [...clean.matchAll(/<(string|item)\b[^>]*>([\s\S]*?)<\/\1>/g)].map(m => ({
    line: clean.slice(0, m.index).split('\n').length,
    text: m[2].replace(/\\'/g, "'"),
  }))
}

// project.yml's Info.plist keys that iOS shows: the app's name and the
// *UsageDescription permission prompts.
function plistTexts(src: string): Hit[] {
  return src.split('\n').flatMap((l, i) => {
    const m = l.match(/^\s*(CFBundleDisplayName|NS\w+UsageDescription):\s*(.+)$/)
    return m ? [{ line: i + 1, text: m[2].replace(/^(["'])(.*)\1$/, '$2') }] : []
  })
}

function appStrings(file: string): Hit[] {
  const src = readFileSync(file, 'utf8')
  if (file.endsWith('.xml')) return xmlStrings(src)
  if (file.endsWith('.yml')) return plistTexts(src)
  return literals(src)
}

const APP_ROOTS: [string, RegExp][] = [
  ['mobile/android/app/src/main/kotlin', /\.kt$/],
  ['mobile/android/app/src/main/res', /\.xml$/],
  ['mobile/ios/project.yml', /./],
  ['mobile/ios/App', /\.swift$/],
  ['mobile/ios/Packages/PaddleKit/Sources', /\.swift$/],
]
// Not the apps' words: test folders, the contract's generated code and its
// generator, and SampleServer, the stand-in paddlesnitch.com the UI tests use.
const APP_SKIP = /\/(Tests?|Generated|ContractGen|ContractGenKit|SampleServer)$/

function appFiles(dir: string, name: RegExp): string[] {
  if (!statSync(dir).isDirectory()) return [dir]
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) { if (!APP_SKIP.test(full)) out.push(...appFiles(full, name)) }
    else if (name.test(entry)) out.push(full)
  }
  return out
}

// The list was written against the site's TypeScript, where text sits in
// '…', "…" or >…<, and some phrases include the quote. Wrap each app string
// all three ways so those phrases still match.
function banned(text: string): [RegExp, string][] {
  const wrapped = `'${text}' "${text}" >${text}<`
  return BANNED.filter(([re]) => re.test(wrapped))
}

// Words in the apps today that break the list, as `file: text`, so the test
// stays green while the apps' owners fix them.
// TODO(#794): remove each line here once the app no longer says it.
const APP_KNOWN: string[] = []

describe("the apps' words follow the same guide (#794)", () => {
  const fixtures = path.join(__dirname, '../tests/fixtures/copy-style')
  const found = (f: string) =>
    appStrings(path.join(fixtures, f)).filter(h => banned(h.text).length).map(h => `${h.line}: ${h.text.trim()}`)

  it('catches a retired phrase in a Kotlin string, not in an identifier, comment, log line or key', () => {
    expect(found('Fixture.kt')).toEqual([
      '8: MY PADDLES',
      '9: Could not save your paddle. Please try again.',
      '14: Could not open the paddle', // after a log call on the same line
      '15: He said \\"YOUR ACCOUNT\\" twice', // escaped quotes
      '16: Tears down the tracker', // a """ string
      '19: Rock evenness', // after a '"' char
      '21: Boat attitude', // line numbers stay right after '\"'
    ])
  })

  it('catches a retired phrase in a Swift string, not in an identifier, comment, log line or key', () => {
    expect(found('Fixture.swift')).toEqual(['8: A seamless upload', '9: Upload failed', '11: Boat attitude'])
  })

  it('catches a retired phrase in a string resource or plural, not in a comment', () => {
    expect(found('strings.xml')).toEqual(['4: YOUR ACCOUNT', '8: MY PADDLES'])
  })

  it('catches a retired phrase in an iOS permission prompt, not in other project.yml keys', () => {
    expect(found('project.yml')).toEqual(['6: Unlock your paddling journey.'])
  })

  it('reads the strings of every app root (a moved folder fails here, not silently)', () => {
    for (const [root, name] of APP_ROOTS) {
      const count = appFiles(path.join(repo, root), name).flatMap(appStrings).length
      expect(count, root).toBeGreaterThan(0)
    }
  })

  it('nothing in the apps says a retired phrase', () => {
    const hits = APP_ROOTS.flatMap(([root, name]) => appFiles(path.join(repo, root), name)).flatMap(file => {
      const f = path.relative(repo, file)
      return appStrings(file).flatMap(({ line, text }) =>
        banned(text).map(([, why]) => ({ key: `${f}: ${text}`, at: `${f}:${line}: ${text.trim().slice(0, 100)} (${why})` })))
    })
    expect(hits.filter(h => !APP_KNOWN.includes(h.key)).map(h => h.at)).toEqual([])
    // An allowed line the app no longer says must leave the list too.
    expect(APP_KNOWN.filter(k => !hits.some(h => h.key === k))).toEqual([])
  })
})
