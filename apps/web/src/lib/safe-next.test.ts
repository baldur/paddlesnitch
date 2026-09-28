// Where to send someone after sign-in. `next` comes from the URL, so it must
// only ever be a path on this site: "//evil.com" and "/\evil.com" are
// protocol-relative URLs a browser treats as another site (security audit
// 2026-09: the Strava sign-in accepted anything starting with "/").
import { describe, it, expect } from 'vitest'
import { safeNext } from '@paddlesnitch/core/url'

describe('safeNext', () => {
  it('keeps a path on this site, query and fragment included', () => {
    expect(safeNext('/devices?code=K7P2QM#add')).toBe('/devices?code=K7P2QM#add')
    expect(safeNext('/')).toBe('/')
  })
  it('refuses anything that could leave the site', () => {
    for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'evil.com', '/%2F%2Fevil.com'.replace('%2F%2F', '//'), ' /x', '/\t/evil.com', 'javascript:alert(1)']) {
      expect(safeNext(bad), bad).toBe('/')
    }
  })
  it('falls back when there is nothing', () => {
    expect(safeNext(null)).toBe('/')
    expect(safeNext(undefined, '/paddles')).toBe('/paddles')
  })
})
