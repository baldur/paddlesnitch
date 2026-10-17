import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi } from 'vitest'

// AttAccountNav is a client component (useRouter/fetch on mount) — stub it so we
// can test AppHeader's markup in isolation. AppHeader is now a thin wrapper over
// the shared @paddlesnitch/ui AppShell.
vi.mock('@/components/AccountMenu', () => ({ default: () => <span>ACCOUNTNAV</span> }))
let pathname = '/att'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))

import AppHeader from './AppHeader'

describe('AppHeader (shared AppShell wrapper)', () => {
  // #100: the header row used to overlap on narrow screens. Now the section
  // tabs leave the header on phones (hidden below sm) for a bottom tab bar, and
  // the breadcrumb has its own row, so the top row only holds brand + extras.
  it('on phones the section tabs move to a bottom bar with a You tab; the breadcrumb gets its own row', () => {
    const html = renderToStaticMarkup(<AppHeader breadcrumb={<span>GROUPS</span>} />)
    expect(html).toContain('<header')
    expect(html).toMatch(/<nav aria-label="Sections" class="hidden sm:flex/)
    expect(html).toMatch(/<nav aria-label="Sections" class="sm:hidden fixed inset-x-0 bottom-0/)
    const bottomBar = html.slice(html.lastIndexOf('<nav aria-label="Sections"'))
    expect(bottomBar.match(/<a href=/g)).toHaveLength(3)   // Paddles, Trials, Plan…
    expect(bottomBar).toContain('ACCOUNTNAV')               // …and the You tab
    expect(html).toMatch(/<div class="px-4 pb-2[^"]*"><span>GROUPS<\/span>/)
  })

  it('renders the brand, cross-app nav, breadcrumb, extra (section) children and account', () => {
    const html = renderToStaticMarkup(
      <AppHeader breadcrumb={<span>BREADCRUMB</span>}>
        <a href="/x">EXTRA</a>
      </AppHeader>,
    )
    expect(html).toContain('paddlesnitch')      // brand
    expect(html).toContain('>Trials<')          // section tabs, sentence case
    expect(html).toContain('>Paddles<')
    expect(html).toContain('>Plan<')
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
    // the header tabs only (the bottom bar repeats them)
    const header = html.slice(0, html.indexOf('</header>'))
    return [...header.matchAll(/<a href="([^"]+)" aria-current="page"/g)].map(m => m[1])
  }
  it.each([
    ['/att', ['/att']],
    ['/att/trials/abc', ['/att']],
    ['/paddles/xyz', ['/paddles']],
    ['/plan', ['/plan']],
    ['/plan/abc', ['/plan']],
    ['/', []],
    ['/profile/abc', []],
    ['/account', []],
    ['/devices', []],
  ])('%s lights %j', (path, expected) => {
    pathname = path
    expect(lit(renderToStaticMarkup(<AppHeader breadcrumb={null} />))).toEqual(expected)
  })
})
