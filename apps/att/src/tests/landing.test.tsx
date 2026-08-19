// Regression tests for #210 — the landing page was too verbose on
// mobile, so both products didn't fit above the fold on a phone. The
// fix keeps the full marketing copy from `sm:` up but hides it on
// mobile, leaving a compact name + one-line summary + CTA per product.
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// next/link needs the app-router context to render; a plain anchor is
// enough for asserting on the static markup here.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const { LandingContent } = await import('@/app/page')

const html = renderToStaticMarkup(<LandingContent />)

describe('#210 — landing page is compact on mobile', () => {
  it('lists both products with their CTAs and links', () => {
    expect(html).toContain('Automated Time Trials')
    expect(html).toContain('OPEN ATT')
    expect(html).toContain('href="/att"')

    expect(html).toContain('Paddle Analysis')
    expect(html).toContain('TRY ANALYSIS')
    expect(html).toContain('href="/analyse"')
  })

  it('hides the long marketing paragraphs on mobile (details only from sm: up)', () => {
    // The two product `details` paragraphs and the hero subtitle carry
    // `hidden sm:block` so a phone sees the compact cards; three in all.
    const hidden = html.match(/hidden sm:block/g) ?? []
    expect(hidden.length).toBe(3)
  })

  it('drops the oversized hero padding that pushed Analyse below the fold', () => {
    // The old hero was `py-16` with no responsive step-down; the tightened
    // hero starts at py-8 on mobile.
    expect(html).not.toContain('py-16')
    expect(html).toContain('py-8')
  })
})
