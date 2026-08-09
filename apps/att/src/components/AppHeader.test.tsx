import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi } from 'vitest'

// AttAccountNav is a client component (useRouter/fetch on mount) — stub it so we
// can test AppHeader's markup in isolation. AppHeader is now a thin wrapper over
// the shared @paddlesnitch/ui AppShell.
vi.mock('@/components/AttAccountNav', () => ({ default: () => <span>ACCOUNTNAV</span> }))

import AppHeader from './AppHeader'

describe('AppHeader (shared AppShell wrapper)', () => {
  it('header row wraps on narrow viewports instead of overlapping (#100)', () => {
    const html = renderToStaticMarkup(<AppHeader breadcrumb={<span>GROUPS</span>} />)
    expect(html).toContain('<header')
    expect(html).toContain('flex-wrap')
  })

  it('renders the brand, cross-app nav, breadcrumb, extra children, REPORT and account', () => {
    const html = renderToStaticMarkup(
      <AppHeader breadcrumb={<span>BREADCRUMB</span>}>
        <a href="/x">EXTRA</a>
      </AppHeader>,
    )
    expect(html).toContain('paddlesnitch')      // brand
    expect(html).toContain('TRIALS')            // cross-app nav
    expect(html).toContain('ANALYSE')
    expect(html).toContain('BREADCRUMB')
    expect(html).toContain('EXTRA')
    expect(html).toContain('REPORT')
    expect(html).toContain('ACCOUNTNAV')
    expect(html.indexOf('EXTRA')).toBeLessThan(html.indexOf('ACCOUNTNAV'))
  })
})
