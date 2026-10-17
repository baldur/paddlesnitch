// The signed-out front door (design-system.md, decision 5): a real paddle
// first, then the sections as a short list.
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

describe('front door leads with a real paddle', () => {
  it('shows the sample paddle: route, numbers and the templated summary', () => {
    expect(html).toContain('aria-label="A sample paddle"')
    expect(html).toContain('aria-label="Route of the sample paddle"')
    expect(html).toContain('9.5 km')
    expect(html).toContain('1:08:23')
    expect(html).toContain('2:39')
    expect(html).toContain('22 spm')
    expect(html).toContain('A 1 hr 8 min paddle')
  })

  it('has one primary action, to add a first paddle, and a way to the trials', () => {
    expect(html).toContain('Add your first paddle')
    expect(html).toContain('href="/signin?next=/paddles/new"')
    expect(html).toContain('See time trials')
    expect(html.match(/bg-primary text-white/g)?.length).toBe(1)
  })

  it('lists the sections with their links, and the tracker guide', () => {
    for (const [name, href] of [['Paddles', '/paddles'], ['Trials', '/att'], ['Plan', '/plan']]) {
      expect(html).toContain(`>${name}<`)
      expect(html).toContain(`href="${href}"`)
    }
    // The tracker has a way in from the front door: the setup guide was
    // linked only from Devices, which a new tester can't find.
    expect(html).toContain('href="/guide"')
  })

  it('writes in sentence case', () => {
    expect(html).not.toMatch(/OPEN TRIALS|OPEN PADDLES|SET UP A TRACKER|tracking-widest/)
  })
})

describe('campaign landing variant', () => {
  it('shows no campaign marker on the default landing', () => {
    expect(html).not.toContain('data-campaign')
  })

  it('marks a campaign variant in the markup only, never in visible text', () => {
    const variantHtml = renderToStaticMarkup(<LandingContent variant="example1" />)
    expect(variantHtml).toContain('data-campaign="example1"')
    expect(variantHtml).not.toContain('campaign: example1')
    // Same product content as the default — it's the default landing + a marker.
    expect(variantHtml).toContain('See time trials')
    expect(variantHtml).toContain('Paddles')
  })

  it('has no marketing filler', () => {
    expect(html).not.toMatch(/growing suite|disappear into|no-bloat|actually happened/i)
  })
})
