import Link from 'next/link'
import { readFaqDoc, parseFaq, faqParagraphs } from '@/lib/faq'
import AppHeader from '@/components/AppHeader'
import { Page, PageHeader, Section } from '@paddlesnitch/ui/Layout'
import { cardClass, cardLinkClass, Chevron } from '@paddlesnitch/ui/Card'
import { ReportIssueButton } from '@paddlesnitch/ui/FeedbackWidget'

// Public read-only help page, rendered server-side from legal/faq.md.
// Kept as Markdown so editors can add questions without touching code —
// see #78. Each question is a <details> so the page is short to scan but
// every answer is still in the page (Ctrl-F finds it).
export const dynamic = 'force-dynamic'

export const metadata = { title: 'Help' }

export default async function FaqPage() {
  const body = await readFaqDoc()
  const entries = body ? parseFaq(body) : []

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader breadcrumb={<Link href="/" className="tt-nav-link text-sm">← Home</Link>} />

      <Page>
        <PageHeader title="Help" />

        <nav aria-label="Help topics" className="grid gap-2 sm:grid-cols-2">
          <Link href="/guide" className={`${cardLinkClass} px-4 py-3 flex items-center gap-3`}>
            <span className="flex-1 min-w-0">
              <span className="block text-base font-medium text-fg">Setting up a tracker</span>
              <span className="block text-sm text-muted">The setup guide, step by step</span>
            </span>
            <Chevron />
          </Link>
          <Link href="/guide/troubleshooting" className={`${cardLinkClass} px-4 py-3 flex items-center gap-3`}>
            <span className="flex-1 min-w-0">
              <span className="block text-base font-medium text-fg">Tracker troubleshooting</span>
              <span className="block text-sm text-muted">When it doesn&apos;t do what you expect</span>
            </span>
            <Chevron />
          </Link>
        </nav>

        <Section title="Questions about trials">
          {entries.length === 0 ? (
            <p className="text-base text-red">
              The questions aren&apos;t available right now. Please contact privacy@paddlesnitch.com.
            </p>
          ) : (
            <div className={`${cardClass} divide-y divide-border`}>
              {entries.map(entry => (
                <details key={entry.question} className="group">
                  <summary className="flex items-center gap-3 px-4 py-3 min-h-11 cursor-pointer list-none [&::-webkit-details-marker]:hidden hover:bg-surface-2">
                    <span className="flex-1 text-base font-medium text-fg">{entry.question}</span>
                    <Chevron className="transition-transform group-open:rotate-90" />
                  </summary>
                  <div className="px-4 pb-4 flex flex-col gap-3 max-w-[65ch]">
                    {faqParagraphs(entry.answer).map((para, i) => (
                      <p key={i} className="text-base text-muted leading-relaxed">
                        {para}
                      </p>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}
        </Section>

        <p className="text-base text-muted">
          Something else? <ReportIssueButton className="tt-link">Report an issue</ReportIssueButton> and tell us.
        </p>
      </Page>
    </main>
  )
}
