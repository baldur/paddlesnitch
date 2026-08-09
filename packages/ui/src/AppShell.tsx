'use client'
import type { ReactNode } from 'react'

// The platform header, shared by both apps. Left: the paddlesnitch brand +
// cross-app nav (Trials ↔ Analyse) so the two apps feel like one product. Right:
// an optional page-specific (section) nav slot + the account nav (passed as
// `account` so the host app supplies the wired AccountNav). Everything common to
// every page — My profile, Settings, Report an issue, Sign out — now lives inside
// the account dropdown, so the top-level header stays uncluttered. Theme-aware
// (semantic tokens).
//
// `active` highlights the current app in the cross-app nav.

export default function AppShell({
  active,
  attHref = '/att',
  analyseHref = '/analyse',
  breadcrumb,
  nav,
  account,
}: {
  active: 'att' | 'analyse'
  attHref?: string
  analyseHref?: string
  breadcrumb?: ReactNode
  nav?: ReactNode        // optional page-specific nav items
  account?: ReactNode    // the host app's wired <AccountNav />
}) {
  // Plain <a>, not next/link: these are cross-app boundary links (root, /att,
  // /analyse). The Analyse app runs under basePath '/analyse', and next/link
  // prepends the basePath to absolute hrefs — which would turn /att into
  // /analyse/att, /analyse into /analyse/analyse, etc. A full-nav <a> is correct
  // here (att and Analyse are separate apps behind one CloudFront anyway) and
  // works identically in both apps. App-supplied `nav` children stay same-app
  // links (they SHOULD get the basePath).
  const tab = (href: string, label: string, on: boolean) => (
    <a href={href} className={`tracking-widest transition-colors ${on ? 'text-fg' : 'text-muted hover:text-fg'}`}>{label}</a>
  )
  return (
    <header className="border-b border-border px-4 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
      <div className="flex items-center gap-4 min-w-0">
        <a href="/" className="font-bold tracking-widest text-fg shrink-0">paddlesnitch</a>
        <nav className="flex gap-3 shrink-0">
          {tab(attHref, 'TRIALS', active === 'att')}
          {tab(analyseHref, 'ANALYSE', active === 'analyse')}
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
