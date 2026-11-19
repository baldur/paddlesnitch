// clean-worktrees.sh removes a worktree only when its work is on main and
// nothing is using it. Builds a throwaway repo with one worktree per case.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, realpathSync, readFileSync, utimesSync, rmSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const script = join(import.meta.dirname, 'clean-worktrees.sh')
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim()
const old = new Date('2020-01-01')

function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'clean-wt-')))
  const origin = join(root, 'origin.git')
  const main = join(root, 'paddlesnitch.com')
  git(root, 'init', '-q', '--bare', '-b', 'main', origin)
  git(root, 'clone', '-q', origin, main)
  mkdirSync(join(main, '.claude', 'agents'), { recursive: true })
  writeFileSync(join(main, '.claude', 'agents', 'game.md'), 'x\n')
  writeFileSync(join(main, '.claude', 'agents', 'ios.md'), 'x\n')
  git(main, 'add', '.')
  git(main, 'commit', '-q', '-m', 'base')
  git(main, 'push', '-q', 'origin', 'HEAD:main')

  // Backdate a worktree's creation so the minimum-age rule doesn't keep it.
  const age = dir => {
    const admin = readFileSync(join(dir, '.git'), 'utf8').match(/^gitdir: (.*)$/m)[1]
    utimesSync(join(admin, 'commondir'), old, old)
  }
  const wt = (name, branch, { fresh = false } = {}) => {
    const dir = join(root, name)
    if (branch) git(main, 'worktree', 'add', '-q', '-b', branch, dir, 'origin/main')
    else git(main, 'worktree', 'add', '-q', '--detach', dir, 'origin/main')
    if (!fresh) age(dir)
    return dir
  }
  const commit = (dir, file) => {
    mkdirSync(join(dir, file, '..'), { recursive: true })
    writeFileSync(join(dir, file), file); git(dir, 'add', '.'); git(dir, 'commit', '-q', '-m', file)
    return git(dir, 'rev-parse', 'HEAD')
  }

  const d = {}
  const prs = []
  const merged = join(root, 'merged.json')
  const pr = (headRefName, headRefOid, baseRefName = 'main') => { prs.push({ headRefName, headRefOid, baseRefName }); writeFileSync(merged, JSON.stringify(prs)) }
  // Its commit was pushed to main (fast-forward).
  d.onMain = wt('paddlesnitch-on-main', 'on-main')
  commit(d.onMain, 'a'); git(d.onMain, 'push', '-q', 'origin', 'HEAD:main')
  // Squash-merged into main, head is the branch tip.
  d.squashed = wt('paddlesnitch-squashed', 'squashed')
  pr('squashed', commit(d.squashed, 'b'))
  // Squash-merged, then one more commit on the branch.
  d.after = wt('paddlesnitch-after', 'after')
  pr('after', commit(d.after, 'c')); commit(d.after, 'd')
  // Merged, but uncommitted changes.
  d.dirty = wt('paddlesnitch-dirty', 'dirty')
  pr('dirty', commit(d.dirty, 'e')); writeFileSync(join(d.dirty, 'scratch.txt'), 'wip')
  // No PR at all.
  d.noPr = wt('paddlesnitch-no-pr', 'no-pr')
  commit(d.noPr, 'f')
  // Merged into another PR's branch, not main (a stacked PR).
  d.stacked = wt('paddlesnitch-stacked', 'stacked')
  pr('stacked', commit(d.stacked, 'g'), 'feat/parent')
  // A role's home folder by its name (any branch), and by its branch (any folder).
  d.roleFolder = wt('paddlesnitch-game', 'some-branch')
  d.roleBranch = wt('elsewhere', 'role/ios')
  // Locked, though on main.
  d.locked = wt('paddlesnitch-locked', 'locked')
  git(main, 'worktree', 'lock', d.locked)
  // Just made, nothing in it yet: an agent is about to start here.
  d.fresh = wt('paddlesnitch-fresh', 'fresh-task', { fresh: true })
  // Detached at a commit on main.
  d.detached = wt('paddlesnitch-detached', null)
  // Folders deleted by hand: one unmerged, one merged.
  d.goneUnmerged = wt('paddlesnitch-gone-unmerged', 'gone-unmerged')
  commit(d.goneUnmerged, 'h'); rmSync(d.goneUnmerged, { recursive: true })
  d.goneMerged = wt('paddlesnitch-gone-merged', 'gone-merged')
  pr('gone-merged', commit(d.goneMerged, 'i')); rmSync(d.goneMerged, { recursive: true })

  const env = { ...process.env, PADDLESNITCH_REPO: main, CLEAN_WORKTREES_MERGED: merged }
  delete env.CLEAN_WORKTREES_MIN_AGE_HOURS
  const run = (args = [], extraEnv = {}) => spawnSync('bash', [script, ...args], { encoding: 'utf8', env: { ...env, ...extraEnv } })
  return { root, main, d, run, commit, pr }
}

const verdicts = out => Object.fromEntries(out.split('\n').filter(l => l.includes('\t')).map(l => { const [v, p, why] = l.split('\t'); return [p, `${v} ${why}`] }))
const branchesOf = main => git(main, 'branch', '--format=%(refname:short)').split('\n')

test('without --apply it lists a verdict for every worktree and removes nothing', () => {
  const { main, d, run } = setup()
  const r = run()
  assert.equal(r.status, 0, r.stderr)
  const v = verdicts(r.stdout)
  assert.match(v[main], /^KEEP main checkout/)
  assert.match(v[d.onMain], /^REMOVE its commit is on main/)
  assert.match(v[d.squashed], /^REMOVE PR for squashed is merged/)
  assert.match(v[d.after], /^KEEP commits on after after its PR merged/)
  assert.match(v[d.dirty], /^KEEP has uncommitted changes/)
  assert.match(v[d.noPr], /^KEEP no PR for no-pr merged into main/)
  assert.match(v[d.stacked], /^KEEP no PR for stacked merged into main/)
  assert.match(v[d.roleFolder], /^KEEP home folder of the game role/)
  assert.match(v[d.roleBranch], /^KEEP home folder of the ios role/)
  assert.match(v[d.locked], /^KEEP locked/)
  assert.match(v[d.fresh], /^KEEP made less than 24 h ago/)
  assert.match(v[d.detached], /^REMOVE its commit is on main/)
  assert.match(v[d.goneUnmerged], /^KEEP no PR for gone-unmerged/)
  assert.match(v[d.goneMerged], /^REMOVE PR for gone-merged is merged/)
  for (const k of Object.keys(d)) if (!k.startsWith('gone')) assert.ok(existsSync(d[k]), `${k} still there`)
  assert.ok(branchesOf(main).includes('squashed'))
})

test('--apply removes only the merged, clean, old ones and their branches', () => {
  const { main, d, run } = setup()
  const r = run(['--apply'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /removed 4, kept 10, failed 0/)
  for (const k of ['onMain', 'squashed', 'detached']) assert.ok(!existsSync(d[k]), `${k} removed`)
  for (const k of ['after', 'dirty', 'noPr', 'stacked', 'roleFolder', 'roleBranch', 'locked', 'fresh']) assert.ok(existsSync(d[k]), `${k} kept`)
  const b = branchesOf(main)
  for (const gone of ['squashed', 'on-main', 'gone-merged']) assert.ok(!b.includes(gone), `branch ${gone} deleted`)
  for (const kept of ['after', 'no-pr', 'stacked', 'gone-unmerged', 'fresh-task']) assert.ok(b.includes(kept), `branch ${kept} kept`)
})

test('a process running in a worktree or a folder inside it keeps it; one in a look-alike sibling does not', async () => {
  const { root, d, run } = setup()
  mkdirSync(join(d.squashed, 'sub'))
  const sibling = join(root, 'paddlesnitch-detached-view')
  mkdirSync(sibling)
  const procs = [spawn('sleep', ['30'], { cwd: d.onMain }), spawn('sleep', ['30'], { cwd: join(d.squashed, 'sub') }), spawn('sleep', ['30'], { cwd: sibling })]
  try {
    await new Promise(r => setTimeout(r, 300))
    const v = verdicts(run().stdout)
    assert.match(v[d.onMain], /^KEEP a running process is using it/)
    assert.match(v[d.squashed], /^KEEP a running process is using it/)
    assert.match(v[d.detached], /^REMOVE/)
  } finally { for (const p of procs) p.kill() }
})

test('if lsof fails it stops before removing anything', () => {
  const { root, d, run } = setup()
  const bin = join(root, 'bin'); mkdirSync(bin)
  writeFileSync(join(bin, 'lsof'), '#!/bin/sh\nexit 1\n'); chmodSync(join(bin, 'lsof'), 0o755)
  const r = run(['--apply'], { PATH: `${bin}:${process.env.PATH}` })
  assert.notEqual(r.status, 0)
  assert.match(r.stdout, /lsof listed no processes/)
  assert.ok(existsSync(d.squashed))
})

test('a removal that fails is reported, and the rest still run', () => {
  const { d, run, commit, pr } = setup()
  pr('squashed', commit(d.squashed, 'locked-dir/file'))
  chmodSync(join(d.squashed, 'locked-dir'), 0o555)
  try {
    const r = run(['--apply'])
    assert.equal(r.status, 1, r.stdout + r.stderr)
    assert.match(r.stdout, /^FAILED\t.*paddlesnitch-squashed\t/m)
    assert.match(r.stdout, /removed 3, kept 10, failed 1/)
    assert.ok(!existsSync(d.onMain) && !existsSync(d.detached))
  } finally { if (existsSync(join(d.squashed, 'locked-dir'))) chmodSync(join(d.squashed, 'locked-dir'), 0o755) }
})
