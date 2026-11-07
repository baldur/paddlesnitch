// @vitest-environment node
// Where visitors come from (#906): CloudFront's location headers, read on the
// server, trimmed and checked, and nothing finer than a city.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'
import { visitorLocation } from './visitor-location'

const h = (o: Record<string, string>) => new Headers(o)

describe('visitorLocation', () => {
  it('reads the country, region and city CloudFront adds', () => {
    expect(visitorLocation(h({
      'CloudFront-Viewer-Country': 'GB', 'CloudFront-Viewer-Country-Region': 'WBK', 'CloudFront-Viewer-City': 'Reading',
    }))).toEqual({ country: 'GB', region: 'WBK', city: 'Reading' })
  })

  it('trims each value and upper-cases the codes', () => {
    expect(visitorLocation(h({
      'cloudfront-viewer-country': ' gb ', 'cloudfront-viewer-country-region': ' wbk', 'cloudfront-viewer-city': '  Henley-on-Thames  ',
    }))).toEqual({ country: 'GB', region: 'WBK', city: 'Henley-on-Thames' })
  })

  it('reads a city CloudFront percent-encoded (non-ASCII letters)', () => {
    expect(visitorLocation(h({ 'cloudfront-viewer-country': 'DE', 'cloudfront-viewer-city': 'G%C3%B6ttingen' })).city).toBe('Göttingen')
    expect(visitorLocation(h({ 'cloudfront-viewer-country': 'BR', 'cloudfront-viewer-city': 'S%C3%A3o Paulo' })).city).toBe('São Paulo')
  })

  it('caps a city at 60 characters', () => {
    const city = visitorLocation(h({ 'cloudfront-viewer-country': 'GB', 'cloudfront-viewer-city': 'Llan' + 'a'.repeat(100) })).city
    expect(city).toHaveLength(60)
  })

  it('leaves out anything that does not look like a country code, region code or place name', () => {
    expect(visitorLocation(h({ 'cloudfront-viewer-country': 'GBR', 'cloudfront-viewer-city': 'Reading' }))).toEqual({})
    expect(visitorLocation(h({ 'cloudfront-viewer-country': 'GB', 'cloudfront-viewer-country-region': 'ENGLAND' }))).toEqual({ country: 'GB' })
    for (const city of ['51.4545', 'RG1 8AA', 'pat@example.com', 'Reading, 51.45 -0.97', '%E0%A4%A', '<script>']) {
      expect(visitorLocation(h({ 'cloudfront-viewer-country': 'GB', 'cloudfront-viewer-city': city })), city).toEqual({ country: 'GB' })
    }
  })

  it('records no region or city without a country', () => {
    expect(visitorLocation(h({ 'cloudfront-viewer-country-region': 'WBK', 'cloudfront-viewer-city': 'Reading' }))).toEqual({})
  })

  it('never reads the postcode, latitude, longitude, metro code, time zone or address', () => {
    expect(visitorLocation(h({
      'cloudfront-viewer-country': 'GB', 'cloudfront-viewer-postal-code': 'RG1 8AA', 'cloudfront-viewer-latitude': '51.45',
      'cloudfront-viewer-longitude': '-0.97', 'cloudfront-viewer-metro-code': '1', 'cloudfront-viewer-time-zone': 'Europe/London',
      'cloudfront-viewer-address': '203.0.113.5:443',
    }))).toEqual({ country: 'GB' })
  })
})

// The managed origin request policy sends every CloudFront location header to
// the server (a custom policy can't drop Host and add them; see infra/CLAUDE.md).
// So the guarantee lives here: no code but visitor-location.ts reads any of
// them, and it reads only the three.
describe('nothing finer than a city is read anywhere', () => {
  const repo = path.resolve(__dirname, '../../../..')
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    if (n === 'node_modules' || n.startsWith('.')) return []
    const full = path.join(dir, n)
    return statSync(full).isDirectory() ? files(full) : /\.(ts|tsx|js|mjs)$/.test(n) && !/\.test\./.test(n) ? [full] : []
  })
  const sources = [...files(path.join(repo, 'apps/web/src')), ...files(path.join(repo, 'packages')), ...files(path.join(repo, 'infra/lambdas'))]

  it('only visitor-location.ts names a CloudFront viewer header, and only country, region and city', () => {
    const hits = sources.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/cloudfront-viewer-[a-z0-9-]+/gi)].map((m) => [path.relative(repo, f), m[0].toLowerCase()]))
    expect(new Set(hits.map(([f]) => f))).toEqual(new Set(['apps/web/src/lib/visitor-location.ts']))
    expect(new Set(hits.map(([, n]) => n))).toEqual(new Set(['cloudfront-viewer-country', 'cloudfront-viewer-country-region', 'cloudfront-viewer-city']))
  })
})
