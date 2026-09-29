// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { parsePost, listPosts, getPost, teaserOf, BLOG_DIR } from './blog'

describe('parsePost', () => {
  it('takes the date and slug from the file name and the title from the front matter', () => {
    const p = parsePost('2026-09-29-first-paddle-of-autumn.md', '---\ntitle: First paddle of autumn\n---\n\nIt was cold.\n')
    expect(p).toMatchObject({
      date: '2026-09-29', slug: 'first-paddle-of-autumn', title: 'First paddle of autumn',
      permalink: '/blog/2026/09/29/first-paddle-of-autumn', body: 'It was cold.',
    })
  })

  it('reads optional summary, author, image and draft', () => {
    const p = parsePost('2026-10-01-x.md', '---\ntitle: "X: a post"\nsummary: Short.\nauthor: Baldur\nimage: /blog-media/x.jpg\ndraft: true\n---\nBody')
    expect(p).toMatchObject({ title: 'X: a post', summary: 'Short.', author: 'Baldur', image: '/blog-media/x.jpg', draft: true })
  })

  it.each([
    ['2026-9-1-x.md', 'name'],
    ['2026-02-30-x.md', 'date'],
    ['2026-09-29-Bad_Slug.md', 'name'],
    ['notes.md', 'name'],
  ])('refuses the file name %s', (name, why) => {
    expect(() => parsePost(name, '---\ntitle: T\n---\nx')).toThrow(new RegExp(why))
  })

  it('refuses a post without a title', () => {
    expect(() => parsePost('2026-09-29-x.md', 'no front matter')).toThrow(/title/)
  })
})

describe('teaserOf', () => {
  it('uses the summary when there is one', () => {
    expect(teaserOf({ summary: 'Hand-written.', body: 'First para.' })).toBe('Hand-written.')
  })
  it('otherwise the first paragraph, as plain text, skipping headings and images', () => {
    const body = '# Heading\n\n![boat](/blog-media/b.jpg)\n\nWe went out on **the Thames** with [the club](https://x.org).\nSecond line.\n\nNext paragraph.'
    expect(teaserOf({ body })).toBe('We went out on the Thames with the club. Second line.')
  })
  it('skips a paragraph that is all italic (a series note), so each part gets its own teaser', () => {
    const body = '*Part 2 of 5 in a series. [Part 1](/blog/x) was the start.*\n\nA tracking device is always going to cost something.'
    expect(teaserOf({ body })).toBe('A tracking device is always going to cost something.')
  })
  it('cuts a long paragraph at a word, with an ellipsis', () => {
    const t = teaserOf({ body: 'word '.repeat(100) })
    expect(t.length).toBeLessThanOrEqual(241)
    expect(t.endsWith('…')).toBe(true)
    expect(t).not.toMatch(/ …$/)
  })
})

describe('listPosts / getPost', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'blog-'))
    writeFileSync(path.join(dir, '2026-09-01-older.md'), '---\ntitle: Older\n---\nA.')
    writeFileSync(path.join(dir, '2026-09-29-newer.md'), '---\ntitle: Newer\n---\nB.')
    writeFileSync(path.join(dir, '2026-09-30-unfinished.md'), '---\ntitle: Unfinished\ndraft: true\n---\nC.')
    writeFileSync(path.join(dir, 'README.md'), 'How to write a post.')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const today = '2026-09-29'

  it('lists newest first, without drafts unless previewing', () => {
    expect(listPosts({ dir, today }).map(p => p.slug)).toEqual(['newer', 'older'])
    expect(listPosts({ dir, today, preview: true }).map(p => p.slug)).toEqual(['unfinished', 'newer', 'older'])
  })

  it('keeps a post dormant until its date, then publishes it', () => {
    writeFileSync(path.join(dir, '2026-10-06-part-two.md'), '---\ntitle: Part two\n---\nD.')
    expect(listPosts({ dir, today }).map(p => p.slug)).not.toContain('part-two')
    expect(getPost('2026', '10', '06', 'part-two', { dir, today })).toBeNull()
    expect(listPosts({ dir, today: '2026-10-06' }).map(p => p.slug)[0]).toBe('part-two')
    // Previewing (local dev) shows it early, flagged as scheduled.
    const early = listPosts({ dir, today, preview: true }).find(p => p.slug === 'part-two')!
    expect(early.scheduled).toBe(true)
  })

  it('finds a post by its permalink parts, and nothing else', () => {
    expect(getPost('2026', '09', '29', 'newer', { dir, today })?.title).toBe('Newer')
    expect(getPost('2026', '09', '28', 'newer', { dir, today })).toBeNull()
    expect(getPost('2026', '09', '30', 'unfinished', { dir, today })).toBeNull()
  })
})

// The real posts must all load: a bad file name or a missing title should
// fail here, not at build time on the deploy.
describe('the posts in the repo', () => {
  it('all parse, with unique permalinks', () => {
    const posts = listPosts({ preview: true })
    expect(posts.length).toBe(readdirSync(BLOG_DIR).filter(f => /^\d{4}-/.test(f)).length)
    expect(new Set(posts.map(p => p.permalink)).size).toBe(posts.length)
  })
})
