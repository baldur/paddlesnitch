import Link from 'next/link'
import { readFaqDoc, parseFaq, faqParagraphs } from '@/lib/faq'
import AppHeader from '@/components/AppHeader'

// Public read-only help page, rendered server-side from legal/faq.md.
// Kept as Markdown so editors can add questions without touching code —
// see #78.
export const dynamic = 'force-dynamic'

export const metadata = { title: 'Help' }

export default async function FaqPage() {
  const body = await readFaqDoc()
  const entries = body ? parseFaq(body) : []

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={
          <>
            <Link href="/" className="tt-nav-link text-sm">← HOME</Link>
            <span className="text-muted">/</span>
            <span className="text-fg text-sm">HELP</span>
          </>
        }
      />

      <div className="flex-1 px-4 py-8 max-w-2xl mx-auto w-full">
        <h1 className="text-lg font-bold text-fg tracking-widest mb-4">HELP</h1>
        <ul className="text-sm flex flex-col gap-1 mb-8" aria-label="Help topics">
          <li>Setting up a tracker? <Link href="/guide" className="text-primary">The setup guide</Link>, step by step.</li>
          <li>Tracker not doing what you expect? <Link href="/guide/troubleshooting" className="text-primary">Troubleshooting</Link>.</li>
          <li>Something else? Tell us with <strong className="text-fg">Report an issue</strong>.</li>
        </ul>
        <h2 className="text-xs text-muted tracking-widest mb-4">QUESTIONS ABOUT TRIALS</h2>
        {entries.length === 0 ? (
          <p className="text-sm text-red">
            The FAQ is unavailable right now. Please contact privacy@paddlesnitch.com.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {entries.map(entry => (
              <section key={entry.question} className="py-5 first:pt-0">
                <h2 className="text-sm font-bold text-fg mb-2">{entry.question}</h2>
                <div className="flex flex-col gap-3">
                  {faqParagraphs(entry.answer).map((para, i) => (
                    <p key={i} className="text-sm text-muted leading-relaxed">
                      {para}
                    </p>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
