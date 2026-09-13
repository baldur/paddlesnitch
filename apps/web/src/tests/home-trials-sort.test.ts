// @vitest-environment node
// #103 — list pages should order trials by date rather than by storage key
// order (which, on S3, is effectively the random nanoid order). This pins
// that the home page "Open Time Trials" list comes back sorted by the trial's
// event date, most recent first, tie-broken by creation time. The two
// course-detail trial lists already sort by createdAt desc; the home list was
// the only one with no deterministic order.
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

// Walk a React element tree (no DOM) and collect every `href` prop, in tree order.
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

describe('#103 — home page orders open trials by event date, newest first', () => {
  it('renders open-trial cards sorted by date descending', async () => {
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id, { visibility: 'public' })
    // Created in a deliberately non-date order so a passing test can only come
    // from an explicit sort, not from creation/storage order.
    const jan = await makeTrial(course.id, owner.id, 'open', { date: '2024-01-15' })
    const dec = await makeTrial(course.id, owner.id, 'open', { date: '2024-12-15' })
    const jun = await makeTrial(course.id, owner.id, 'open', { date: '2024-06-15' })

    // Anonymous viewer: no manage links, no recent submissions — the only
    // /att/trials/{id} hrefs are the open-trial cards themselves.
    mockAuth(null)
    const trialHrefs = collectHrefs(await Home())
      .filter(h => /^\/att\/trials\/[^/]+$/.test(h))

    expect(trialHrefs).toEqual([
      `/att/trials/${dec.id}`,
      `/att/trials/${jun.id}`,
      `/att/trials/${jan.id}`,
    ])
  })
})
