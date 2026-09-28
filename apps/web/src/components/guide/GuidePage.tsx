import Link from 'next/link'
import type { ReactNode } from 'react'
import AppHeader from '@/components/AppHeader'
import { GUIDE_STEPS, guideStep } from '@/lib/guide'

// The frame every guide page shares: breadcrumb back to the guide, "Step N of M",
// the title, the page's own content, then BACK / NEXT and a way out to
// troubleshooting. Pass `slug` for a step; leave it out for the overview and
// troubleshooting pages; `overview` marks /guide itself.
export default function GuidePage({ slug, title, overview, children }: { slug?: string; title: string; overview?: boolean; children: ReactNode }) {
  const at = slug ? guideStep(slug) : undefined
  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={
          <>
            <Link href="/" className="tt-nav-link text-sm">← HOME</Link>
            <span className="text-muted">/</span>
            {overview
              ? <span className="text-fg text-sm">GUIDE</span>
              : <Link href="/guide" className="tt-nav-link text-sm">GUIDE</Link>}
          </>
        }
      />
      <article className="flex-1 px-4 py-8 max-w-2xl mx-auto w-full flex flex-col gap-6">
        <header>
          {at && <p className="text-xs text-muted tracking-widest uppercase">Step {at.number} of {GUIDE_STEPS.length}</p>}
          <h1 className="text-lg font-bold text-fg tracking-widest mt-1">{title.toUpperCase()}</h1>
        </header>

        <div className="flex flex-col gap-5 text-sm text-muted leading-relaxed [&_strong]:text-fg [&_a]:text-primary">
          {children}
        </div>

        {at && (
          <nav className="border-t border-border pt-5 flex justify-between gap-4 text-sm" aria-label="Guide steps">
            {at.prev
              ? <Link href={`/guide/${at.prev.slug}`} className="tt-link">← {at.prev.title}</Link>
              : <Link href="/guide" className="tt-link">← All steps</Link>}
            {at.next
              ? <Link href={`/guide/${at.next.slug}`} className="tt-link text-right">{at.next.title} →</Link>
              : <Link href="/guide/troubleshooting" className="tt-link text-right">If something goes wrong →</Link>}
          </nav>
        )}
        {slug && (
          <p className="text-xs text-muted">
            Stuck? See <Link href="/guide/troubleshooting" className="text-primary">troubleshooting</Link>.
          </p>
        )}
      </article>
    </main>
  )
}

// A numbered list of things to do, in order.
export function Steps({ children }: { children: ReactNode }) {
  return <ol className="list-decimal pl-5 flex flex-col gap-2 marker:text-muted">{children}</ol>
}

// Something worth knowing before it bites.
export function Note({ children }: { children: ReactNode }) {
  return <div className="border-l-2 border-primary bg-surface px-4 py-3">{children}</div>
}

export function Screens({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-4">{children}</div>
}
