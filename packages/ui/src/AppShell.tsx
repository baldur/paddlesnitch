'use client'
import Link from 'next/link'
import type { ReactNode } from 'react'

// The platform header, shared by both apps. Left: the paddlesnitch brand +
// cross-app nav (Trials ↔ Analyse) so the two apps feel like one product. Right:
// an optional page-specific nav slot, a REPORT link (opens the shared
// FeedbackWidget via a window event), and the account nav (passed as children so
// the host app supplies the wired AccountNav). Theme-aware (semantic tokens).
//
// `active` highlights the current app in the cross-app nav.
const OPEN_FEEDBACK = 'paddlesnitch:open-feedback'

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
  const tab = (href: string, label: string, on: boolean) => (
    <Link href={href} className={`tracking-widest transition-colors ${on ? 'text-fg' : 'text-muted hover:text-fg'}`}>{label}</Link>
  )
  return (
    <header className="border-b border-border px-4 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
      <div className="flex items-center gap-4 min-w-0">
        <Link href="/" className="font-bold tracking-widest text-fg shrink-0">paddlesnitch</Link>
        <nav className="flex gap-3 shrink-0">
          {tab(attHref, 'TRIALS', active === 'att')}
          {tab(analyseHref, 'ANALYSE', active === 'analyse')}
        </nav>
        {breadcrumb && <div className="min-w-0 text-muted truncate">{breadcrumb}</div>}
      </div>
      <nav className="flex gap-4 text-muted items-center shrink-0">
        {nav}
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_FEEDBACK))} className="text-muted hover:text-fg tracking-widest transition-colors">REPORT</button>
        {account}
      </nav>
    </header>
  )
}
