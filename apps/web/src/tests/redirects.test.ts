// Old URLs keep working after pages move, and every redirect lands on a real
// page in ONE hop (a redirect whose target is itself redirected is a chain:
// slower, and a bug waiting for the middle rule to change).
import { describe, it, expect } from 'vitest'
import nextConfig from '../../next.config'

type Rule = { source: string; destination: string; permanent?: boolean }

// Minimal matcher for the patterns we use: literal segments, `:name` and
// `:name*` (rest of the path, possibly empty).
function apply(rules: Rule[], path: string): string | null {
  for (const r of rules) {
    const src = r.source.split('/'), parts = path.split('/')
    const params: Record<string, string> = {}
    let ok = true
    for (let i = 0; i < src.length; i++) {
      const s = src[i]
      if (s.endsWith('*')) { params[s.slice(1, -1)] = parts.slice(i).join('/'); break }
      if (s.startsWith(':')) { if (parts[i] == null) { ok = false; break } params[s.slice(1)] = parts[i]; continue }
      if (s !== parts[i]) { ok = false; break }
      if (i === src.length - 1 && parts.length !== src.length) ok = false
    }
    if (!ok) continue
    return r.destination.replace(/:(\w+)\*?/g, (_, k) => params[k] ?? '').replace(/\/$/, '') || '/'
  }
  return null
}

describe('redirects', async () => {
  const rules = (await nextConfig.redirects!()) as Rule[]

  it.each([
    ['/profile/me/settings', '/account'],
    ['/att/account', '/account'],
    ['/att/u/abc', '/profile/abc'],
    ['/analyse/library', '/paddles/library'],
    ['/profile/me/devices', '/devices'],
    ['/profile/me/devices/d/AABBCCDD', '/devices/AABBCCDD'],
  ])('%s → %s', (from, to) => {
    expect(apply(rules, from)).toBe(to)
  })

  it('no redirect lands on another redirect', () => {
    for (const r of rules) {
      const probe = r.destination.replace(/:(\w+)\*?/g, 'x')
      expect(apply(rules, probe), `${r.source} → ${r.destination} is chained`).toBeNull()
    }
  })
})
