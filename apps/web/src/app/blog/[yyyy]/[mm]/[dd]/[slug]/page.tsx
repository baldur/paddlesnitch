import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import AppHeader from '@/components/AppHeader'
import PostBody from '@/components/blog/PostBody'
import { getPost, listPosts, teaserOf } from '@/lib/blog'
import { fmtPostDate } from '@/components/blog/fmtDate'

type Params = { params: Promise<{ yyyy: string; mm: string; dd: string; slug: string }> }

// One static page per post, built at deploy time. Any other address 404s.
export const dynamicParams = false
export function generateStaticParams() {
  return listPosts().map(p => {
    const [yyyy, mm, dd] = p.date.split('-')
    return { yyyy, mm, dd, slug: p.slug }
  })
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { yyyy, mm, dd, slug } = await params
  const post = getPost(yyyy, mm, dd, slug)
  if (!post) return {}
  const description = teaserOf(post)
  return {
    title: post.title,
    description,
    openGraph: {
      type: 'article', title: post.title, description, publishedTime: post.date,
      ...(post.image ? { images: [post.image] } : {}),
    },
  }
}

export default async function BlogPost({ params }: Params) {
  const { yyyy, mm, dd, slug } = await params
  const post = getPost(yyyy, mm, dd, slug)
  if (!post) notFound()
  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={
          <>
            <Link href="/" className="tt-nav-link text-sm">← HOME</Link>
            <span className="text-muted">/</span>
            <Link href="/blog" className="tt-nav-link text-sm">BLOG</Link>
          </>
        }
      />
      <article className="flex-1 px-4 py-8 max-w-2xl mx-auto w-full flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <p className="text-xs text-muted tracking-widest uppercase">
            <time dateTime={post.date}>{fmtPostDate(post.date)}</time>
            {post.author && <> · {post.author}</>}
            {post.draft && <span className="text-split"> · draft</span>}
          </p>
          <h1 className="text-xl font-bold text-fg leading-snug">{post.title}</h1>
        </header>
        <PostBody markdown={post.body} />
        <nav className="border-t border-border pt-5 text-sm">
          <Link href="/blog" className="tt-link">← All posts</Link>
        </nav>
      </article>
    </main>
  )
}
