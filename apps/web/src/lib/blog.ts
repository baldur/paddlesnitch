import { readdirSync, readFileSync } from 'fs'
import path from 'path'

// The blog: Markdown files in apps/web/content/blog/, one per post, named
// YYYY-MM-DD-readable-slug.md. The file name is the date and the permalink
// (/blog/yyyy/mm/dd/readable-slug); the front matter holds the rest:
//
//   ---
//   title: First paddle of autumn     (required)
//   summary: One or two sentences.    (optional; the teaser on /blog)
//   author: Baldur                    (optional)
//   image: /blog-media/autumn.jpg     (optional; the share image)
//   draft: true                       (optional; shown only in local dev)
//   ---
//
// A post dated in the future stays DORMANT until that date: the build leaves
// it out, so neither /blog nor its permalink shows it. The daily
// publish-scheduled-posts workflow redeploys on the morning a post falls due,
// which is what makes it appear. Local dev shows it early, marked scheduled.
//
// Images go in apps/web/public/blog-media/ and are referenced as
// /blog-media/<file>. They deploy to the S3 assets bucket with the site.
// Read at build time: every post page is static.

export const BLOG_DIR = path.join(process.cwd(), 'content/blog')

export type Post = {
  date: string          // YYYY-MM-DD
  slug: string
  title: string
  summary?: string
  author?: string
  image?: string
  draft: boolean
  scheduled: boolean    // dated after today (only ever listed when previewing)
  body: string          // Markdown, front matter removed
  permalink: string
}

const FILE = /^(\d{4})-(\d{2})-(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/

// A small front-matter reader: `key: value` lines between two `---` lines.
// Values may be quoted. Enough for the handful of fields above.
function frontMatter(src: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src)
  if (!m) return { meta: {}, body: src }
  const meta: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-zA-Z]+):\s*(.*)$/.exec(line.trim())
    if (kv) meta[kv[1]] = kv[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return { meta, body: src.slice(m[0].length) }
}

export function parsePost(filename: string, src: string): Post {
  const f = FILE.exec(filename)
  if (!f) throw new Error(`blog: bad file name "${filename}" (want YYYY-MM-DD-lowercase-slug.md)`)
  const [, y, mo, d, slug] = f
  const date = `${y}-${mo}-${d}`
  const dt = new Date(`${date}T00:00:00Z`)
  if (isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== date) throw new Error(`blog: bad date in "${filename}"`)
  const { meta, body } = frontMatter(src)
  if (!meta.title) throw new Error(`blog: "${filename}" has no title in its front matter`)
  return {
    date, slug, title: meta.title,
    summary: meta.summary || undefined,
    author: meta.author || undefined,
    image: meta.image || undefined,
    draft: meta.draft === 'true',
    scheduled: false,
    body: body.trim(),
    permalink: `/blog/${y}/${mo}/${d}/${slug}`,
  }
}

// The teaser on /blog: the summary if the post has one, otherwise its first
// paragraph as plain text (headings and images skipped, links and emphasis
// reduced to their words), cut at a word near 240 characters.
export function teaserOf(post: { summary?: string; body: string }, max = 240): string {
  if (post.summary) return post.summary
  const para = post.body.split(/\n\s*\n/).map(p => p.trim())
    .find(p => p && !p.startsWith('#') && !/^!\[[^\]]*\]\([^)]*\)$/.test(p)) ?? ''
  const text = para
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,.;:]$/, '') + '…'
}

// `today` is a UTC date (YYYY-MM-DD). `preview` also lists drafts and
// scheduled posts: on in local dev, off in every build that gets deployed.
type Opts = { dir?: string; preview?: boolean; today?: string }
const isPreview = () => process.env.NODE_ENV === 'development'
export const todayUtc = () => new Date().toISOString().slice(0, 10)

export function listPosts({ dir = BLOG_DIR, preview = isPreview(), today = todayUtc() }: Opts = {}): Post[] {
  let files: string[]
  try { files = readdirSync(dir) } catch { return [] }
  return files
    .filter(f => /^\d{4}-/.test(f) && f.endsWith('.md'))
    .map(f => parsePost(f, readFileSync(path.join(dir, f), 'utf8')))
    .map(p => ({ ...p, scheduled: p.date > today }))
    .filter(p => preview || (!p.draft && !p.scheduled))
    .sort((a, b) => (a.date === b.date ? a.slug.localeCompare(b.slug) : b.date.localeCompare(a.date)))
}

export function getPost(y: string, m: string, d: string, slug: string, opts: Opts = {}): Post | null {
  return listPosts(opts).find(p => p.permalink === `/blog/${y}/${m}/${d}/${slug}`) ?? null
}
