import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'

import LoadingState from './LoadingState'

describe('LoadingState', () => {
  it('renders the default "Loading…" label', () => {
    const html = renderToStaticMarkup(<LoadingState />)
    expect(html).toContain('Loading…')
  })

  it('renders a custom label when given one', () => {
    const html = renderToStaticMarkup(<LoadingState label="Checking…" />)
    expect(html).toContain('Checking…')
    expect(html).not.toContain('Loading…')
  })

  it('exposes a polite status role for assistive tech', () => {
    const html = renderToStaticMarkup(<LoadingState />)
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
  })

  it('renders three animated blocks as the indicator', () => {
    const html = renderToStaticMarkup(<LoadingState />)
    expect(html.match(/animate-pulse/g)).toHaveLength(3)
  })

  it('fills its flex parent by default, but accepts a className override', () => {
    expect(renderToStaticMarkup(<LoadingState />)).toContain('flex-1')
    const custom = renderToStaticMarkup(<LoadingState className="py-16" />)
    expect(custom).toContain('py-16')
    expect(custom).not.toContain('flex-1')
  })
})
