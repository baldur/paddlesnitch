'use client'
import type { ReactNode } from 'react'

// The platform header. Left: the paddlesnitch brand + the section tabs
// (TRIALS, PADDLES). Right:
// an optional page-specific (section) nav slot + the account nav (passed as
// `account` so the host app supplies the wired AccountNav). Everything common to
// every page — My profile, Settings, Report an issue, Sign out — now lives inside
// the account dropdown, so the top-level header stays uncluttered. Theme-aware
// (semantic tokens).
//
// `active` highlights the current section's tab; leave it out on pages that
// belong to neither (home, profile, account, devices, legal).

export type Section = 'trials' | 'paddles'

// Which top-level tab a path belongs to, if any.
export function sectionFor(pathname: string): Section | undefined {
  if (pathname === '/att' || pathname.startsWith('/att/')) return 'trials'
  if (pathname === '/paddles' || pathname.startsWith('/paddles/')) return 'paddles'
  return undefined
}

export default function AppShell({
  active,
  trialsHref = '/att',
  paddlesHref = '/paddles',
  breadcrumb,
  nav,
  account,
}: {
  active?: Section
  trialsHref?: string
  paddlesHref?: string
  breadcrumb?: ReactNode
  nav?: ReactNode        // optional page-specific nav items
  account?: ReactNode    // the host app's wired <AccountNav />
}) {
  // Plain <a>, not next/link, for the section tabs — simple full-nav between the
  // top-level sections (root, /att, /paddles). App-supplied `nav` children can
  // still use next/link for same-section navigation.
  const tab = (href: string, label: string, on: boolean) => (
    <a href={href} className={`tracking-widest transition-colors ${on ? 'text-fg' : 'text-muted hover:text-fg'}`}>{label}</a>
  )
  return (
    <header className="border-b border-border px-4 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
      <div className="flex items-center gap-4 min-w-0">
        <a href="/" className="font-bold tracking-widest text-fg shrink-0">paddlesnitch</a>
        <nav className="flex gap-3 shrink-0">
          {tab(trialsHref, 'TRIALS', active === 'trials')}
          {tab(paddlesHref, 'PADDLES', active === 'paddles')}
        </nav>
        {breadcrumb && <div className="min-w-0 text-muted truncate">{breadcrumb}</div>}
      </div>
      <nav className="flex gap-4 text-muted items-center shrink-0">
        {nav}
        {account}
      </nav>
    </header>
  )
}
