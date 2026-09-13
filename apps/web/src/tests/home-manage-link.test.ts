// @vitest-environment node
// #87 — the home page lists open trials but gave the owner no way to reach
// the close/manage action. These tests pin that a "manage" link to the
// admin page is rendered for trials the viewer owns, and for nobody else.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir, makeUser, makeCourse, makeTrial } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import Home from '@/app/att/page'
import { cookies } from 'next/headers'

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir) })

function mockAuth(idToken: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => name === 'tt_id' && idToken ? { name, value: idToken } : undefined,
  } as ReturnType<typeof cookies> extends Promise<infer T> ? T : never)
}

// Walk a React element tree (no DOM) and collect every `href` prop.
function collectHrefs(node: unknown, acc: string[] = []): string[] {
  if (node == null || typeof node !== 'object') return acc
  if (Array.isArray(node)) { node.forEach(n => collectHrefs(n, acc)); return acc }
  const props = (node as { props?: { href?: unknown; children?: unknown } }).props
  if (props) {
    if (typeof props.href === 'string') acc.push(props.href)
    if (props.children !== undefined) collectHrefs(props.children, acc)
  }
  return acc
}

describe('#87 — home page surfaces a manage link for trial owners', () => {
  it('links to the admin page for a trial the viewer owns', async () => {
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id, { visibility: 'public' })
    const trial = await makeTrial(course.id, owner.id, 'open')

    mockAuth(owner.idToken)
    const hrefs = collectHrefs(await Home())
    expect(hrefs).toContain(`/att/admin/trials/${trial.id}`)
  })

  it('does not show the manage link to a non-owner', async () => {
    const owner = await makeUser('Owner')
    const other = await makeUser('Other')
    const course = await makeCourse(owner.id, { visibility: 'public' })
    const trial = await makeTrial(course.id, owner.id, 'open')

    mockAuth(other.idToken)
    const hrefs = collectHrefs(await Home())
    expect(hrefs).not.toContain(`/att/admin/trials/${trial.id}`)
  })

  it('does not show the manage link to an anonymous visitor', async () => {
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id, { visibility: 'public' })
    const trial = await makeTrial(course.id, owner.id, 'open')

    mockAuth(null)
    const hrefs = collectHrefs(await Home())
    expect(hrefs).not.toContain(`/att/admin/trials/${trial.id}`)
  })
})
