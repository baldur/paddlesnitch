import Link from 'next/link'
import { readTosDoc } from '@/lib/tos'
import { CURRENT_TOS_VERSION } from '@/lib/types'
import AppHeader from '@/components/AppHeader'
import { parseMarkdown, type Inline } from '@/lib/markdown-lite'

// Public read-only ToS page. Rendered server-side from legal/tos-{v}.md.
// We keep this Markdown rather than HTML so versioned diffs are easy to
// see in git; markdown-lite turns it into headings, paragraphs and lists.
export const dynamic = 'force-dynamic'

export const metadata = { title: 'Terms of Service' }

export default async function TosPage() {
  const body = await readTosDoc(CURRENT_TOS_VERSION)
  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={
          <>
            <Link href="/" className="tt-nav-link text-sm">← HOME</Link>
            <span className="text-muted">/</span>
            <span className="text-fg text-sm">TERMS OF SERVICE</span>
          </>
        }
      />

      <div className="flex-1 px-4 py-8 max-w-2xl mx-auto w-full">
        {body === null ? (
          <p className="text-sm text-red">
            Terms of Service document is missing. Please contact privacy@paddlesnitch.com.
          </p>
        ) : (
          <article className="text-sm text-fg leading-relaxed flex flex-col gap-4">
            {parseMarkdown(body).map((b, i) => {
              if (b.type === 'h1') return <h1 key={i} className="text-lg font-bold text-balance"><Text runs={b.content} /></h1>
              if (b.type === 'h2') return <h2 key={i} className="font-bold mt-4 text-balance"><Text runs={b.content} /></h2>
              if (b.type === 'hr') return <hr key={i} className="border-border my-2" />
              if (b.type === 'ul') return (
                <ul key={i} className="list-disc pl-6 flex flex-col gap-2">
                  {b.items.map((item, j) => <li key={j}><Text runs={item} /></li>)}
                </ul>
              )
              return <p key={i}><Text runs={b.content} /></p>
            })}
          </article>
        )}
      </div>
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
