// A profile showed races only, so a tracker tester saw an empty page. Their
// own view now has their paddling too; paddles are private, so a visitor's
// view never reads them, whatever the profile's setting.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('404') }, redirect: () => { throw new Error('redirect') } }))
vi.mock('@/components/AppHeader', () => ({ default: () => null }))
vi.mock('@/lib/auth', () => ({ getAuthUser: vi.fn() }))
vi.mock('@/lib/groups', () => ({ getUserGroupIds: async () => [] }))
vi.mock('@/lib/profile', () => ({
  resolveToUserId: async (s: string) => s,
  getProfileSettings: async () => ({ public: true }),
  buildProfileStats: async () => ({ displayName: 'Pat', totals: { races: 0, courses: 0, distanceMetres: 0, since: null }, bestRace: null, personalBests: [], races: [], boatClasses: [] }),
}))
vi.mock('@paddlesnitch/analysis/analysis-store', () => ({ listSessionSummaries: vi.fn() }))

import { getAuthUser } from '@/lib/auth'
import { listSessionSummaries } from '@paddlesnitch/analysis/analysis-store'
import ProfilePage from './page'

const render = async () => renderToStaticMarkup(await ProfilePage({ params: Promise.resolve({ id: 'u1' }) }))

beforeEach(() => {
  vi.mocked(listSessionSummaries).mockReset()
  vi.mocked(listSessionSummaries).mockResolvedValue([
    { id: 'p1', paddledAt: '2026-10-01T08:00:00Z', distanceKm: 8, durationS: 3600, cruiseSpeed: 3, source: { type: 'device' } },
  ] as never)
})

describe('a profile', () => {
  it("shows its owner their paddling, marked as only theirs", async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ id: 'u1', email: 'p@x', displayName: 'Pat' })
    const html = await render()
    expect(html).toContain('Your paddling')
    expect(html).toContain('Only you see this part.')
    expect(html).toContain('href="/paddles/p1"')
  })

  it("doesn't read or show paddles to a visitor, even on a public profile", async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ id: 'someone-else', email: 's@x', displayName: 'Sam' })
    const html = await render()
    expect(html).not.toContain('Your paddling')
    expect(listSessionSummaries).not.toHaveBeenCalled()
  })
})
