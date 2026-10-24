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

// The /plan link's parameters (#508); kept in step with draftFromParams and
// the plan page's name lookup.
const PLAN_PARAMS: [string, string, string][] = [
  ['from', 'Where you start: latitude,longitude in decimal degrees, or a lock, wharf, slipway or town by name. Lowercase-and-hyphens works too.', 'from=52.0629,-1.3325 · from=cropredy-lock'],
  ['to', 'Where you finish, the same way.', 'to=Aldermaston Wharf'],
  ['waterway', 'Keeps both ends on this waterway, where two run close together or a town has two.', 'waterway=oxford-canal'],
  ['shape', 'one_way (the default) or return: there and back to the start.', 'shape=return'],
  ['at', 'When you set off, as an ISO 8601 time. Give a Z or an offset; without one it is read as UTC. Every stop then gets a clock time.', 'at=2026-10-25T09:30:00+01:00'],
  ['pace', 'Your moving pace in km/h, 1 to 30. Default 8.', 'pace=9.5'],
  ['portage', 'Minutes added at every portage, 0 to 120. Default 3.', 'portage=5'],
  ['view', 'Where the map opens, when the link has no ends: latitude,longitude,zoom.', 'view=52.06,-1.33,14'],
]

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
          <Link href="/api" className={`${cardLinkClass} px-4 py-3 flex items-center gap-3`}>
            <span className="flex-1 min-w-0">
              <span className="block text-base font-medium text-fg">The API</span>
              <span className="block text-sm text-muted">Plans and public trials as JSON, for your own tools</span>
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

        <Section title="Linking to a plan">
          <p className="text-base text-muted max-w-[65ch]">
            A plan lives in its link, so you can write one by hand. For example{' '}
            <Link className="tt-link break-all" href="/plan?from=guyers-lock&to=aldermaston-wharf&shape=return&pace=9">/plan?from=guyers-lock&amp;to=aldermaston-wharf&amp;shape=return&amp;pace=9</Link>.
            Names are looked up as if typed in the Start and Finish boxes; once found, the address changes to coordinates so the link stays the same.
          </p>
          <dl className="divide-y divide-border border-y border-border max-w-[65ch]" data-testid="plan-params">
            {PLAN_PARAMS.map(([name, what, example]) => (
              <div key={name} className="py-3 grid gap-1 sm:grid-cols-[6rem_1fr] sm:gap-4">
                <dt className="tabular text-base text-fg">{name}</dt>
                <dd className="text-sm text-muted">
                  {what}
                  <span className="block mt-1 tabular text-fg break-all">{example}</span>
                </dd>
              </div>
            ))}
          </dl>
        </Section>

        <p className="text-base text-muted">
          Something else? <ReportIssueButton className="tt-link">Report an issue</ReportIssueButton> and tell us.
        </p>
      </Page>
    </main>
  )
}
