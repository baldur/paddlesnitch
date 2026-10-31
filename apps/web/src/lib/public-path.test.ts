// Paths recorded in analytics (CloudWatch, kept for months) and put in feedback
// issues (a PUBLIC GitHub repo) must not carry who someone is or a secret:
// a share id in a public issue publishes that paddle's full route (privacy
// audit 2026-09). Public ids that aren't about a person stay, because "which
// trial do people look at" is the point of the analytics.
import { describe, it, expect } from 'vitest'
import { publicPath } from '@paddlesnitch/ui/metrics-events'

describe('publicPath', () => {
  it.each([
    ['/paddles/shared/Xy12abC_9', '/paddles/shared/[id]'],
    ['/paddles/k3j4h5', '/paddles/[id]'],
    ['/profile/baldur', '/profile/[id]'],
    ['/devices/435C09C8', '/devices/[id]'],
    ['/devices/435C09C8/s_abc', '/devices/[id]/[id]'],
    ['/l/K7P2QM', '/l/[code]'],
    ['/L/K7P2QM', '/L/[code]'],
  ])('%s → %s', (raw, want) => expect(publicPath(raw)).toBe(want))

  it.each([
    '/', '/paddles', '/paddles/new', '/paddles/compare', '/paddles/compare/section',
    '/profile/me', '/devices', '/account', '/guide/wifi', '/att/trials/abc123', '/att/courses/c1',
  ])('keeps %s', p => expect(publicPath(p)).toBe(p))
})

// Every dynamic page, found on disk, so a new route can't slip through: each
// [param] gets a secret-looking value, and only the public trial and course
// ids may survive. The analytics archive keeps paths indefinitely (#781 era,
// docs/features/observability.md § Archive), so a buddy's account id or a
// share link in a path would be kept for good.
import { readdirSync, statSync } from 'fs'
import { join } from 'path'

const APP = join(__dirname, '../app')
const PUBLIC_PARAMS = new Set(['trialId', 'courseId'])
function pages(dir: string, rel: string[] = []): string[][] {
  const out: string[][] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (!statSync(full).isDirectory()) continue
    if (name === 'api' || name.startsWith('_')) continue
    const seg = name.startsWith('(') ? [] : [name]
    if (readdirSync(full).includes('page.tsx')) out.push([...rel, ...seg])
    out.push(...pages(full, [...rel, ...seg]))
  }
  return out
}

describe('publicPath on every page with an id in its address', () => {
  const dynamic = pages(APP).filter(r => r.some(s => s.startsWith('[')))
  it('finds the pages', () => expect(dynamic.length).toBeGreaterThan(10))
  it.each(dynamic.map(r => [r.join('/')]))('/%s keeps nothing personal', (route) => {
    const secret = (param: string) => `Zq9sEcReT${param}`
    const raw = '/' + route.split('/').map(s => s.startsWith('[') ? secret(s.replace(/[[\].]/g, '')) : s).join('/')
    const out = publicPath(raw)
    for (const s of route.split('/').filter(s => s.startsWith('['))) {
      const param = s.replace(/[[\].]/g, '')
      if (PUBLIC_PARAMS.has(param)) expect(out).toContain(secret(param))
      else expect(out, `${param} in ${raw}`).not.toContain(secret(param))
    }
  })

  it("the analytics archive's copy cleans every one the same way", async () => {
    const { cleanPath } = await import('../../../../infra/lambdas/analytics-archive/index.mjs')
    for (const r of dynamic) {
      const raw = '/' + r.map(s => s.startsWith('[') ? 'Zq9sEcReT' : s).join('/') + '?q=1'
      expect(cleanPath(raw), raw).toBe(publicPath(raw))
    }
  })

  it('drops a query string or fragment', () => {
    expect(publicPath('/att?email=a@b.c#x')).toBe('/att')
  })
})
