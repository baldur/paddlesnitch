// Every agent brief in .claude/agents/ has a name matching its file and a
// description (the description is what decides when lead calls it), and is
// listed in docs/agents.md, which the help agent answers from.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const dir = join(root, '.claude', 'agents')
const roles = readdirSync(dir).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3))
const map = readFileSync(join(root, 'docs', 'agents.md'), 'utf8')

test('there are agent briefs', () => {
  assert.ok(roles.length > 0)
})

for (const role of roles) {
  test(`${role}: front matter has its own name and a description`, () => {
    const text = readFileSync(join(dir, `${role}.md`), 'utf8')
    const front = text.match(/^---\n([\s\S]*?)\n---\n/)
    assert.ok(front, 'starts with a --- front matter block')
    assert.match(front[1], new RegExp(`^name: ${role}$`, 'm'))
    assert.match(front[1], /^description: .{20,}$/m)
  })

  test(`${role}: is listed in docs/agents.md`, () => {
    assert.ok(map.includes(`| \`${role}\` |`), `docs/agents.md has a table row for ${role}`)
  })
}

test('docs/agents.md lists no role without a brief', () => {
  const listed = [...map.matchAll(/^\| `([a-z-]+)` \| (?:coordinator|guide|builder|reviewer) \|/gm)].map(m => m[1])
  assert.ok(listed.length > 0)
  for (const role of listed) assert.ok(roles.includes(role), `${role} has .claude/agents/${role}.md`)
})
