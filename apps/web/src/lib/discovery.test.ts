// robots.txt, sitemap.xml, llms.txt and trial JSON-LD (#513): public only.
import { describe, expect, it } from 'vitest'
import { LLMS_TXT, robots, sitemap, SITE, trialJsonLd } from './discovery'
import type { CourseMetadata, TrialMetadata } from './types'

const course = (over: Partial<CourseMetadata>): CourseMetadata => ({
  id: 'c1', name: 'Elliðaár 1000m Sprint', type: 'point_to_point', sport: 'kayak', distanceMetres: 1000,
  startLine: [[64.12, -21.84], [64.122, -21.842]], adminUserId: 'u1', visibility: 'public', createdAt: '2026-01-01T00:00:00Z', ...over,
} as CourseMetadata)
const trial = (over: Partial<TrialMetadata>): TrialMetadata => ({
  id: 't1', courseId: 'c1', name: 'Spring Sprint', date: '2026-05-01', status: 'open', adminUserId: 'u1',
  visibility: 'public', participation: 'public', invitedUserIds: [], createdAt: '2026-04-01T00:00:00Z', ...over,
})

describe('robots.txt', () => {
  it('lets everyone read public pages, not APIs or your own account, and points at the sitemap', () => {
    const r = robots()
    expect(r.rules).toEqual([expect.objectContaining({ userAgent: '*', allow: '/', disallow: expect.arrayContaining(['/api/', '/att/api/', '/profile/me']) })])
    expect(r.sitemap).toBe(`${SITE}/sitemap.xml`)
  })
})

describe('sitemap.xml', () => {
  it('lists the public pages and public trials and courses, never private or group ones', () => {
    const urls = sitemap(
      [trial({ id: 'pub' }), trial({ id: 'priv', visibility: 'private' }), trial({ id: 'grp', visibility: 'group', visibleToGroupId: 'g' })],
      [course({ id: 'cpub' }), course({ id: 'cpriv', visibility: 'private' })],
    ).map(u => u.url)
    expect(urls).toEqual(expect.arrayContaining([SITE, `${SITE}/plan`, `${SITE}/att/trials/pub`, `${SITE}/att/courses/cpub`]))
    expect(urls.join(' ')).not.toMatch(/trials\/(priv|grp)|courses\/cpriv/)
  })
})

describe('llms.txt', () => {
  it('says what the site is, how to link a plan, and the licences', () => {
    expect(LLMS_TXT).toMatch(/^# paddlesnitch/)
    expect(LLMS_TXT).toContain('not a navigation authority')
    expect(LLMS_TXT).toContain(`${SITE}/plan?from=`)
    expect(LLMS_TXT).toContain('ODbL')
  })
})

describe('trial JSON-LD', () => {
  it('describes a public trial as a SportsEvent at the start line', () => {
    expect(trialJsonLd(trial({}), course({}))).toMatchObject({
      '@type': 'SportsEvent', name: 'Spring Sprint', startDate: '2026-05-01', url: `${SITE}/att/trials/t1`, sport: 'Kayaking',
      location: { '@type': 'Place', name: 'Elliðaár 1000m Sprint', geo: { latitude: 64.121, longitude: -21.841 } },
    })
  })

  it('says nothing about a trial a signed-out visitor could not see', () => {
    expect(trialJsonLd(trial({ visibility: 'private' }), course({}))).toBeNull()
  })
})
