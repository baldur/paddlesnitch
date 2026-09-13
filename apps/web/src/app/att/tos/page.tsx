import Link from 'next/link'
import { readTosDoc } from '@/lib/tos'
import { CURRENT_TOS_VERSION } from '@/lib/types'
import AppHeader from '@/components/AppHeader'

// Public read-only ToS page. Rendered server-side from legal/tos-{v}.md.
// We keep this Markdown rather than HTML so versioned diffs are easy to
// see in git.
export const dynamic = 'force-dynamic'

export default async function TosPage() {
  const body = await readTosDoc(CURRENT_TOS_VERSION)
  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={
          <>
            <Link href="/att" className="tt-nav-link text-sm">← HOME</Link>
            <span className="text-muted">/</span>
            <span className="text-fg text-sm">TERMS OF SERVICE</span>
          </>
        }
      />

      <div className="flex-1 px-4 py-8 max-w-2xl mx-auto w-full">
        <p className="text-xs text-muted tracking-widest mb-2">
          VERSION {CURRENT_TOS_VERSION}
        </p>
        {body === null ? (
          <p className="text-sm text-red">
            Terms of Service document is missing. Please contact privacy@paddlesnitch.com.
          </p>
        ) : (
          // Render markdown as preformatted text for now — keeps the page
          // dependency-light. A future PR can swap in a markdown renderer
          // when we add styling beyond the source format.
          <pre className="whitespace-pre-wrap font-sans text-sm text-fg leading-relaxed">
            {body}
          </pre>
        )}
      </div>
    </main>
  )
}
