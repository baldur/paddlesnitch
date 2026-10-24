'use client'
import type { ReactNode } from 'react'

// The platform header. Left: the paddlesnitch brand + the section tabs
// (Paddles, Trials, Plan, Games). On phones the tabs move to a bottom bar with a
// fifth "You" tab (the account menu as a sheet). Right:
// an optional page-specific (section) nav slot + the account nav (passed as
// `account` so the host app supplies the wired AccountNav). Everything common to
// every page — My profile, Settings, Report an issue, Sign out — now lives inside
// the account dropdown, so the top-level header stays uncluttered. Theme-aware
// (semantic tokens).
//
// `active` highlights the current section's tab; leave it out on pages that
// belong to neither (home, profile, account, devices, legal).

export type Section = 'trials' | 'paddles' | 'plan' | 'games'

// Which top-level tab a path belongs to, if any.
export function sectionFor(pathname: string): Section | undefined {
  if (pathname === '/att' || pathname.startsWith('/att/')) return 'trials'
  if (pathname === '/paddles' || pathname.startsWith('/paddles/')) return 'paddles'
  if (pathname === '/plan' || pathname.startsWith('/plan/')) return 'plan'
  if (pathname === '/games' || pathname.startsWith('/games/')) return 'games'
  return undefined
}

// Line icons for the phone's bottom tabs (24 px, currentColor).
const ICONS: Record<Section, ReactNode> = {
  // a route line with a start and finish
  paddles: <><circle cx="5" cy="18" r="2" /><circle cx="19" cy="6" r="2" /><path d="M6.5 16.5C9 14 8 11 11 10s5-1 6.5-2.5" /></>,
  // a stopwatch
  trials: <><circle cx="12" cy="13" r="7.5" /><path d="M12 13V9.5M10 2.5h4M18.5 6.5l1.5-1.5" /></>,
  // a folded map
  plan: <><path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z" /><path d="M9 4v13.5M15 6.5V20" /></>,
  // a game controller
  games: <><path d="M7 8h10a4 4 0 0 1 4 4v1a4 4 0 0 1-7 2.6l-.6-.6h-2.8l-.6.6A4 4 0 0 1 3 13v-1a4 4 0 0 1 4-4z" /><path d="M8 11v3M6.5 12.5h3" /><circle cx="15.5" cy="11.5" r=".6" /><circle cx="17" cy="13.5" r=".6" /></>,
}

export default function AppShell({
  active,
  trialsHref = '/att',
  paddlesHref = '/paddles',
  planHref = '/plan',
  gamesHref = '/games',
  breadcrumb,
  nav,
  account,
  you,
}: {
  active?: Section
  trialsHref?: string
  paddlesHref?: string
  planHref?: string
  gamesHref?: string
  breadcrumb?: ReactNode
  nav?: ReactNode        // optional page-specific nav items
  account?: ReactNode    // the host app's wired <AccountNav /> (header, from sm up)
  you?: ReactNode        // the same, as the phone bottom bar's "You" tab (variant 'tab')
}) {
  // Plain <a>, not next/link, for the section tabs — simple full-nav between the
  // top-level sections (root, /att, /paddles, /plan, /games). App-supplied `nav` children can
  // still use next/link for same-section navigation.
  const sections: { id: Section; href: string; label: string }[] = [
    { id: 'paddles', href: paddlesHref, label: 'Paddles' },
    { id: 'trials', href: trialsHref, label: 'Trials' },
    { id: 'plan', href: planHref, label: 'Plan' },
    { id: 'games', href: gamesHref, label: 'Games' },
  ]
  return (
    <>
      <header className="border-b border-border">
        <div className="px-4 min-h-14 flex items-center gap-x-6 gap-y-2">
          <a href="/" className="font-mono font-bold tracking-wider text-fg shrink-0">paddlesnitch</a>
          {/* Section tabs live here from sm up; on phones they're the bottom bar. */}
          <nav aria-label="Sections" className="hidden sm:flex self-stretch gap-5">
            {sections.map(t => (
              <a
                key={t.id}
                href={t.href}
                aria-current={active === t.id ? 'page' : undefined}
                className={`flex items-center border-b-2 text-sm font-medium transition-colors ${
                  active === t.id ? 'border-primary-text text-fg' : 'border-transparent text-muted hover:text-fg'
                }`}
              >
                {t.label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-4 text-sm text-muted min-w-0">
            {nav}
            {account && <div className="hidden sm:block">{account}</div>}
          </div>
        </div>
        {breadcrumb && (
          <div className="px-4 pb-2 -mt-1 text-sm text-muted truncate">{breadcrumb}</div>
        )}
      </header>

      {/* Phone navigation: five tabs at the bottom, in thumb reach. The same
          pattern as the native apps will use. Pages get bottom padding for it
          from the root layout. */}
      <nav
        aria-label="Sections"
        className="sm:hidden fixed inset-x-0 bottom-0 z-[1050] border-t border-border bg-bg/95 backdrop-blur grid grid-cols-5 pb-[env(safe-area-inset-bottom,0px)]"
      >
        {sections.map(t => (
          <a
            key={t.id}
            href={t.href}
            aria-current={active === t.id ? 'page' : undefined}
            className={`flex flex-col items-center justify-center gap-0.5 min-h-14 text-xs font-medium ${
              active === t.id ? 'text-primary-text' : 'text-muted hover:text-fg'
            }`}
          >
            <svg aria-hidden viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              {ICONS[t.id]}
            </svg>
            {t.label}
          </a>
        ))}
        {you ?? <span />}
      </nav>
    </>
  )
}
