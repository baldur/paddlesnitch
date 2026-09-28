import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi } from 'vitest'

// AttAccountNav is a client component (useRouter/fetch on mount) — stub it so we
// can test AppHeader's markup in isolation. AppHeader is now a thin wrapper over
// the shared @paddlesnitch/ui AppShell.
vi.mock('@/components/AttAccountNav', () => ({ default: () => <span>ACCOUNTNAV</span> }))
let pathname = '/att'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))

import AppHeader from './AppHeader'

describe('AppHeader (shared AppShell wrapper)', () => {
  it('header row wraps on narrow viewports instead of overlapping (#100)', () => {
    const html = renderToStaticMarkup(<AppHeader breadcrumb={<span>GROUPS</span>} />)
    expect(html).toContain('<header')
    expect(html).toContain('flex-wrap')
  })

  it('renders the brand, cross-app nav, breadcrumb, extra (section) children and account', () => {
    const html = renderToStaticMarkup(
      <AppHeader breadcrumb={<span>BREADCRUMB</span>}>
        <a href="/x">EXTRA</a>
      </AppHeader>,
    )
    expect(html).toContain('paddlesnitch')      // brand
    expect(html).toContain('TRIALS')            // cross-section nav
    expect(html).toContain('PADDLES')
    expect(html).toContain('BREADCRUMB')
    expect(html).toContain('EXTRA')
    // Report/Profile/Settings/Sign out moved into the account dropdown
    // (AttAccountNav, stubbed here as ACCOUNTNAV) — no standalone REPORT link.
    expect(html).not.toContain('REPORT')
    expect(html).toContain('ACCOUNTNAV')
    expect(html.indexOf('EXTRA')).toBeLessThan(html.indexOf('ACCOUNTNAV'))
  })
})

// The header used to pass active="att" everywhere, so TRIALS was lit on home,
// profile, account and devices pages too.
describe('the highlighted tab follows the URL', () => {
  const lit = (html: string) => {
    const on = [...html.matchAll(/<a href="([^"]+)" class="tracking-widest transition-colors text-fg"/g)].map(m => m[1])
    return on
  }
  it.each([
    ['/att', ['/att']],
    ['/att/trials/abc', ['/att']],
    ['/paddles/xyz', ['/paddles']],
    ['/', []],
    ['/profile/abc', []],
    ['/account', []],
    ['/devices', []],
  ])('%s lights %j', (path, expected) => {
    pathname = path
    expect(lit(renderToStaticMarkup(<AppHeader breadcrumb={null} />))).toEqual(expected)
  })
})
