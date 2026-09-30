import Link from 'next/link'
import type { Metadata } from 'next'
import AppHeader from '@/components/AppHeader'
import { listPosts, teaserOf } from '@/lib/blog'
import { fmtPostDate } from '@/components/blog/fmtDate'

export const metadata: Metadata = {
  title: 'Blog',
  description: 'News and stories from paddlesnitch: trackers, time trials and paddling.',
}

// Every post, newest first, with its teaser. Built at deploy time.
export default function BlogIndex() {
  const posts = listPosts()
  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={
          <>
            <Link href="/" className="tt-nav-link text-sm">← HOME</Link>
            <span className="text-muted">/</span>
            <span className="text-fg text-sm">BLOG</span>
          </>
        }
      />
      <div className="flex-1 px-4 py-8 max-w-2xl mx-auto w-full flex flex-col gap-6">
        <h1 className="text-lg font-bold text-fg tracking-widest">BLOG</h1>
        {posts.length === 0 ? (
          <p className="text-sm text-muted">No posts yet.</p>
        ) : (
          <ol className="flex flex-col divide-y divide-border">
            {posts.map(p => (
              <li key={p.permalink} className="py-5 first:pt-0">
                <article className="flex flex-col gap-2">
                  <p className="text-xs text-muted tracking-widest uppercase">
                    <time dateTime={p.date}>{fmtPostDate(p.date)}</time>
                    {p.draft && <span className="text-split"> · draft</span>}
                    {p.scheduled && <span className="text-split"> · scheduled</span>}
                  </p>
                  <h2 className="text-base font-bold text-fg">
                    <Link href={p.permalink} className="hover:text-primary transition-colors">{p.title}</Link>
                  </h2>
                  <p className="text-sm text-muted leading-relaxed">{teaserOf(p)}</p>
                  <Link href={p.permalink} className="text-xs text-primary tracking-widest self-start">READ MORE →</Link>
                </article>
              </li>
            ))}
          </ol>
        )}
      </div>
    </main>
  )
}
