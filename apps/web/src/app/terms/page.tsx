import Link from 'next/link'
import { readTosDoc } from '@/lib/tos'
import { CURRENT_TOS_VERSION } from '@/lib/types'
import AppHeader from '@/components/AppHeader'
import { Page, PageHeader } from '@paddlesnitch/ui/Layout'
import { parseMarkdown, type Inline } from '@/lib/markdown-lite'

// Public read-only ToS page. Rendered server-side from legal/tos-{v}.md.
// We keep this Markdown rather than HTML so versioned diffs are easy to
// see in git; markdown-lite turns it into headings, paragraphs and lists.
export const dynamic = 'force-dynamic'

export const metadata = { title: 'Terms of Service' }

export default async function TosPage() {
  const body = await readTosDoc(CURRENT_TOS_VERSION)
  const blocks = body === null ? null : parseMarkdown(body)
  const first = blocks?.[0]
  const title = first?.type === 'h1' ? first.content : null
  const rest = (title ? blocks?.slice(1) : blocks) ?? []
  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={
          <>
            <Link href="/" className="tt-nav-link text-sm">← Home</Link>
          </>
        }
      />

      <Page>
        {blocks === null ? (
          <>
            <PageHeader title="Terms of Service" />
            <p className="text-base text-red">
              The Terms of Service are missing. Please contact privacy@paddlesnitch.com.
            </p>
          </>
        ) : (
          <>
            {/* The document's own first heading is the page title. */}
            <PageHeader title={title ? <Text runs={title} /> : 'Terms of Service'} />
            <article className="max-w-[65ch] text-base text-fg leading-relaxed flex flex-col gap-4">
              {rest.map((b, i) => {
                if (b.type === 'h1' || b.type === 'h2') return <h2 key={i} className="text-lg font-semibold mt-4 text-balance"><Text runs={b.content} /></h2>
                if (b.type === 'hr') return <hr key={i} className="border-border my-2" />
                if (b.type === 'ul') return (
                  <ul key={i} className="list-disc pl-6 flex flex-col gap-2">
                    {b.items.map((item, j) => <li key={j}><Text runs={item} /></li>)}
                  </ul>
                )
                return <p key={i}><Text runs={b.content} /></p>
              })}
            </article>
          </>
        )}
      </Page>
    </main>
  )
}

// Inline runs. A `/path` code span is one of our own pages, so it's a link.
function Text({ runs }: { runs: Inline[] }) {
  return runs.map((r, i) => {
    if (r.bold) return <strong key={i}>{r.text}</strong>
    if (r.code && r.text.startsWith('/')) return <a key={i} href={r.text} className="tt-link">{r.text}</a>
    if (r.code) return <code key={i} className="font-mono text-sm">{r.text}</code>
    return r.text
  })
}
