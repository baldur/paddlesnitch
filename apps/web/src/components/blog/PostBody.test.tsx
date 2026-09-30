// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PostBody from './PostBody'

const html = (md: string) => renderToStaticMarkup(<PostBody markdown={md} />)

describe('blog post body', () => {
  it('renders Markdown: headings, emphasis, lists, tables', () => {
    const out = html('## Results\n\n**Fast** day.\n\n- one\n- two\n\n| Boat | Time |\n|---|---|\n| K1 | 4:12 |')
    expect(out).toContain('<h2')
    expect(out).toContain('<strong>Fast</strong>')
    expect(out).toContain('<li>one</li>')
    expect(out).toContain('<td class="border-b border-border px-3 py-1.5">4:12</td>')
  })

  it('does not pass raw HTML through', () => {
    const out = html('Hi <script>alert(1)</script> <img src=x onerror=alert(1)>')
    // Shown as text, never as tags.
    expect(out).not.toMatch(/<script|<img/)
    expect(out).toContain('&lt;script&gt;')
  })

  it('opens outside links in a new tab, keeps site links in place', () => {
    expect(html('[club](https://example.org)')).toMatch(/target="_blank" rel="noopener noreferrer"/)
    expect(html('[guide](/guide)')).not.toMatch(/target=/)
  })

  it('shows images from blog-media with their alt text', () => {
    expect(html('![start line](/blog-media/x.jpg)')).toMatch(/<img src="\/blog-media\/x.jpg" alt="start line"/)
  })
})
