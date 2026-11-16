#!/usr/bin/env node
// scripts/night-shift/mutate.mjs
// Mutation testing for ONE source file.
//
//   node scripts/night-shift/mutate.mjs <source file> "<test command>" [timeoutMs]
//   node scripts/night-shift/mutate.mjs --list <source file>
//
// Generates one-at-a-time mutants of the file, runs the test command for each
// (with a per-mutant timeout), and restores the file exactly (in finally, so it
// is left untouched even on crash; a copy is kept beside it until the end).
//
// Mutant types (one per occurrence, one occurrence applied at a time):
//   < <-> <=,  > <-> >=,  === <-> !==,  + <-> -,  && <-> ||,
//   true <-> false,  a number +/-1,  removing one leading !,  return early.
//
// Node-only (child_process, fs, path): no new packages, runs the repo's vitest.
// Prints JSON to stdout: { file, total, killed, survived: [{line, from, to, op}] }.
// Progress + a breakdown by op go to stderr. A hang/timeout counts as killed.

import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'

const cwd = process.cwd()

// ---- args ---------------------------------------------------------------
const args = process.argv.slice(2)
if (args[0] === '--list') {
  const file = resolve(args[1])
  const original = readFileSync(file, 'utf8')
  const mutants = buildMutants(original, file)
  const byOp = {}
  for (const m of mutants) byOp[m.op] = (byOp[m.op] || 0) + 1
  process.stdout.write(JSON.stringify({ file, total: mutants.length, byOp }, null, 2) + '\n')
  process.exit(0)
}
if (!args[0] || !args[1]) {
  process.stderr.write('usage: mutate.mjs <source file> "<test command>" [timeoutMs] [limit]\n')
  process.exit(2)
}
const file = resolve(args[0])
const testCmd = args[1]
const perMutantTimeoutMs = Number(args[2] || 30000)
const limit = args[3] ? Number(args[3]) : Infinity // optional: first N mutants only
if (!file || !testCmd) {
  process.stderr.write('usage: mutate.mjs <source file> "<test command>" [timeoutMs] [limit]\n')
  process.exit(2)
}

// ---- restore exactly, always --------------------------------------------
const original = readFileSync(file, 'utf8')
let restored = true
function restore() {
  try {
    if (!restored) {
      writeFileSync(file, original)
      restored = true
    }
  } catch (e) {
    process.stderr.write('restore failed: ' + e.message + '\n')
  }
}
process.on('exit', restore)
process.on('SIGINT', () => { restore(); process.exit(130) })
process.on('SIGTERM', () => { restore(); process.exit(143) })
process.on('SIGHUP', () => { restore(); process.exit(129) })
// A SIGKILL can't be caught: keep a copy beside the file while mutants run.
const backup = file + '.mutate-backup'

// ---- run the test command for the current on-disk file -------------------
function runTest() {
  return new Promise((resolveOne) => {
    const child = spawn('/bin/sh', ['-c', testCmd], {
      cwd, stdio: ['ignore', 'ignore', 'ignore'],
    })
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      try { child.kill('SIGKILL') } catch { /* already gone */ }
      resolveOne(124) // timeout: treat as killed
    }, perMutantTimeoutMs)
    child.on('error', (err) => {
      if (done) return
      done = true; clearTimeout(timer); resolveOne(127)
    })
    child.on('exit', (code) => {
      if (done) return
      done = true; clearTimeout(timer); resolveOne(code === null ? 124 : code)
    })
  })
}

// ---- mutant generation --------------------------------------------------
// Replace the k-th match of `re` in `s`, one mutant per match.
function eachMatch(s, re, make) {
  const out = []
  re.lastIndex = 0
  let m
  while ((m = re.exec(s)) !== null) {
    out.push(s.slice(0, m.index) + make(m[0], m) + s.slice(m.index + m[0].length))
    if (m.index === re.lastIndex) re.lastIndex++ // avoid zero-length loop
  }
  return out
}

function isSkippableLine(line) {
  const t = line.trim()
  if (t === '') return true
  if (t.startsWith('//')) return true
  if (t.startsWith('/*') || t.startsWith('*') || t.startsWith('*/')) return true
  if (t.startsWith('import ')) return true
  if (t.startsWith('export type ') || t.startsWith('type ')) return true
  return false
}

// Split a trailing line comment (// or */), string-aware, so numbers and
// operators inside a comment are never mutated (they are equivalent mutants).
function splitComment(line) {
  let inS = null // active quote char: ' " or `
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inS) {
      if (c === '\\') { i++; continue }
      if (c === inS) inS = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') { inS = c; continue }
    if (c === '/' && line[i + 1] === '/') return { code: line.slice(0, i), comment: line.slice(i) }
    if (c === '*' && line[i + 1] === '/') return { code: line.slice(0, i), comment: line.slice(i) }
  }
  return { code: line, comment: '' }
}

function buildMutants(src, file) {
  const lines = src.split('\n')
  const out = []
  const seen = new Set()
  const push = (lineIdx, newLine, op) => {
    if (newLine === lines[lineIdx]) return // no change → not a mutant
    const content = lines.slice()
    content[lineIdx] = newLine
    const full = content.join('\n')
    if (seen.has(full)) return
    seen.add(full)
    out.push({ line: lineIdx + 1, from: lines[lineIdx], to: newLine, op, content: full })
  }

  for (let i = 0; i < lines.length; i++) {
    const s = lines[i]
    // Mutate only the code portion; a trailing comment is reattached verbatim.
    const { code, comment } = splitComment(s)
    if (isSkippableLine(code)) continue
    const emit = (newCode, op) => push(i, newCode + comment, op)
    // Numbers in a numeric type union (e.g. `1 | -1`) are type literals, not
    // runtime values, so leave them alone — mutating them is an equivalent mutant.
    const skipNums = /\|\s*-?\d/.test(code)

    // === comparison operators, both directions. Only space-delimited ones, so
    // === generics (Array<number>), arrows (=>) and <= / >= themselves are never
    // === turned into a syntax error that would count as a kill. -------------
    for (const v of eachMatch(code, /(?<= )<(?= )/g, () => '<=')) emit(v, '< -> <=')
    for (const v of eachMatch(code, /(?<= )>(?= )/g, () => '>=')) emit(v, '> -> >=')
    for (const v of eachMatch(code, /(?<= )<=(?= )/g, () => '<')) emit(v, '<= -> <')
    for (const v of eachMatch(code, /(?<= )>=(?= )/g, () => '>')) emit(v, '>= -> >')

    // === === <-> !== -------------------------------------------------------
    for (const v of eachMatch(code, /===/g, () => '!==')) emit(v, '=== -> !==')
    for (const v of eachMatch(code, /!==/g, () => '===')) emit(v, '!== -> ===')

    // === && <-> || ---------------------------------------------------------
    for (const v of eachMatch(code, /&&/g, () => '||')) emit(v, '&& -> ||')
    for (const v of eachMatch(code, /\|\|/g, () => '&&')) emit(v, '|| -> &&')

    // === true <-> false (whole word) --------------------------------------
    for (const v of eachMatch(code, /\btrue\b/g, () => 'false')) emit(v, 'true -> false')
    for (const v of eachMatch(code, /\bfalse\b/g, () => 'true')) emit(v, 'false -> true')

    // === + <-> - (binary, space-delimited) --------------------------------
    for (const v of eachMatch(code, /(?<=\s)\+\s(?=\S)/g, () => '- ')) emit(v, '+ -> -')
    for (const v of eachMatch(code, /(?<=\s)-\s(?=\S)/g, () => '+ ')) emit(v, '- -> +')

    // === remove one leading ! (not part of != or !==) ----------------------
    for (const v of eachMatch(code, /(?<![=!])!(?!=)/g, () => '')) emit(v, '! removed')

    // === number +/- 1 (not inside identifiers, decimals-as-exponents, string
    // === lines, or numeric type unions) ------------------------------------
    if (!skipNums && !/['"`]/.test(code)) {
      for (const v of eachMatch(code, /(?<![A-Za-z0-9_.])\d+(?:\.\d+)?(?![A-Za-z0-9_.])/g, (m0) => {
        return String(parseFloat(m0) + 1)
      })) emit(v, 'num +1')
      for (const v of eachMatch(code, /(?<![A-Za-z0-9_.])\d+(?:\.\d+)?(?![A-Za-z0-9_.])/g, (m0) => {
        return String(parseFloat(m0) - 1)
      })) emit(v, 'num -1')
    }

    // === return early (single-line block-body function / arrow) -----------
    if (/(?:async\s+)?function\s+[\w$]+\s*\(.*\)\s*(?::\s*[^\n{]*)?\{\s*$/.test(s)) {
      emit(s.replace(/\{\s*$/, '{ return undefined;'), 'return early (fn)')
    }
    if (/=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*[^\n{]*)?\{\s*$/.test(s) &&
        !/=>\s*[^{]/.test(s)) {
      emit(s.replace(/\{\s*$/, '{ return undefined;'), 'return early (arrow)')
    }
  }
  return out
}

// ---- drive --------------------------------------------------------------
async function main() {
  // The suite must pass on the unmutated file, or every mutant looks "killed"
  // (a wrong command, an already-red suite or a timeout all exit non-zero).
  const baseline = await runTest()
  if (baseline !== 0) {
    process.stderr.write(`the test command fails on the unmutated file (exit ${baseline}); fix it first\n`)
    process.exit(3)
  }
  writeFileSync(backup, original)
  let mutants = buildMutants(original, file)
  if (limit !== Infinity) mutants = mutants.slice(0, limit)
  process.stderr.write(`mutants: ${mutants.length}${limit !== Infinity ? ` (of ${buildMutants(original, file).length}, limit ${limit})` : ''}\n`)
  const survived = []
  let killed = 0
  for (let k = 0; k < mutants.length; k++) {
    const m = mutants[k]
    writeFileSync(file, m.content)
    restored = false
    try {
      const code = await runTest()
      if (code === 0) {
        survived.push({ line: m.line, from: m.from, to: m.to, op: m.op })
      } else {
        killed++
      }
    } catch (e) {
      process.stderr.write('mutant ' + (k + 1) + ' error: ' + e.message + '\n')
      killed++
    } finally {
      restore()
    }
    if (k % 20 === 0) {
      process.stderr.write(`  ${k + 1}/${mutants.length} killed=${killed} survived=${survived.length}\n`)
    }
  }
  // The file must be exactly as we found it.
  restored = false
  restore()
  const clean = readFileSync(file, 'utf8') === original
  if (clean) unlinkSync(backup)
  process.stderr.write(clean ? 'file restored cleanly\n' : `WARNING: file not restored; the original is in ${backup}\n`)
  const result = {
    file,
    total: mutants.length,
    killed,
    survived: survived.map(({ line, from, to, op }) => ({ line, from, to, op })),
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
}

main().catch((e) => {
  restore()
  process.stderr.write('fatal: ' + (e && e.stack || e) + '\n')
  process.exit(1)
})
