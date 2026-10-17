import Link from 'next/link'
import type { ReactNode } from 'react'
import AppHeader from '@/components/AppHeader'
import { GUIDE_STEPS, guideStep } from '@/lib/guide'
import { Page, PageHeader } from '@paddlesnitch/ui/Layout'
import { cardLinkClass, Chevron } from '@paddlesnitch/ui/Card'

// The frame every guide page shares: breadcrumb back to the guide, "Step N of M",
// the title, the page's own content, then previous / next and a way out to
// troubleshooting. Pass `slug` for a step; leave it out for the overview and
// troubleshooting pages; `overview` marks /guide itself.
export default function GuidePage({ slug, title, overview, children }: { slug?: string; title: string; overview?: boolean; children: ReactNode }) {
  const at = slug ? guideStep(slug) : undefined
  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={overview
          ? <Link href="/" className="tt-nav-link text-sm">← Home</Link>
          : <Link href="/guide" className="tt-nav-link text-sm">← Tracker guide</Link>}
      />
      <Page>
        <PageHeader eyebrow={at ? `Step ${at.number} of ${GUIDE_STEPS.length}` : undefined} title={title} />

        <div className="flex flex-col gap-5 text-base text-muted leading-relaxed max-w-[65ch] [&_strong]:text-fg [&_a]:text-primary-text [&_a]:underline [&_a]:underline-offset-2">
          {children}
        </div>

        {at && (
          <nav className="border-t border-border pt-6 grid gap-2 sm:grid-cols-2" aria-label="Guide steps">
            {at.prev
              ? <StepLink href={`/guide/${at.prev.slug}`} label="Previous" title={at.prev.title} dir="prev" />
              : <StepLink href="/guide" label="Back to" title="All steps" dir="prev" />}
            {at.next
              ? <StepLink href={`/guide/${at.next.slug}`} label="Next" title={at.next.title} dir="next" primary />
              : <StepLink href="/guide/troubleshooting" label="Next" title="If something goes wrong" dir="next" />}
          </nav>
        )}
        {slug && (
          <p className="text-sm text-muted">
            Stuck? See <Link href="/guide/troubleshooting" className="tt-link">troubleshooting</Link>.
          </p>
        )}
      </Page>
    </main>
  )
}

// Previous / next at the foot of a step: big enough to tap, saying where it goes.
function StepLink({ href, label, title, dir, primary }: { href: string; label: string; title: string; dir: 'prev' | 'next'; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={`${cardLinkClass} px-4 py-3 min-h-11 flex items-center gap-3 ${dir === 'next' ? 'sm:col-start-2 text-right flex-row-reverse' : ''} ${primary ? 'border-primary/60' : ''}`}
    >
      <Chevron className={dir === 'prev' ? 'rotate-180' : ''} />
      <span className="flex-1 min-w-0 flex flex-col">
        <span className="text-sm text-muted">{label}</span>
        <span className="text-base font-medium text-fg">{title}</span>
      </span>
    </Link>
  )
}

// A numbered list of things to do, in order.
export function Steps({ children }: { children: ReactNode }) {
  return <ol className="list-decimal pl-5 flex flex-col gap-2 marker:text-muted">{children}</ol>
}

// Something worth knowing before it bites.
export function Note({ children }: { children: ReactNode }) {
  return <div className="rounded-control border-l-2 border-primary-text bg-surface px-4 py-3">{children}</div>
}

export function Screens({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-4">{children}</div>
}
