import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/components/AppHeader', () => ({ default: () => <header>HEADER</header> }))

import SourcesPage from './page'
import { SOURCES } from '@paddlesnitch/waterways/sources'
import { PHOTO_CREDIT } from '@/lib/plan-ui'

// The refresh's User-Agent sends data providers to /plan/sources; it used to
// open "Sign in to open this plan" (the [id] route).
describe('the data sources page', () => {
  const html = renderToStaticMarkup(<SourcesPage />)

  it('lists every outside source with its licence, and says how we fetch', () => {
    for (const [id, s] of Object.entries(SOURCES)) {
      if (id === 'contribution' || id === 'curated') continue
      expect(html).toContain(s.name.replace(/&/g, '&amp;').replace(/'/g, '&#x27;'))
      expect(html).toContain(s.licence.replace(/&/g, '&amp;'))
    }
    expect(html).toContain('paddlesnitch-river-planner')
    expect(html).toContain('privacy@paddlesnitch.com')
  })

  it('credits every aerial photo provider', () => {
    for (const c of Object.values(PHOTO_CREDIT)) expect(html).toContain(c.replace(/&/g, '&amp;'))
  })
})
