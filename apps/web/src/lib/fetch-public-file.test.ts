// The trial upload can fetch a GPX from a link. The server must never be
// talked into fetching something internal (the Lambda runtime API listens on
// 127.0.0.1:9001, cloud metadata on 169.254.169.254), wait for ever, or read
// an unbounded body (security audit 2026-09).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { isPublicHttpsUrl, fetchPublicFile } from './fetch-public-file'

afterEach(() => vi.unstubAllGlobals())

describe('isPublicHttpsUrl', () => {
  it('allows ordinary https links', () => {
    expect(isPublicHttpsUrl('https://example.com/ride.gpx')).toBe(true)
    expect(isPublicHttpsUrl('https://www.strava.com/activities/1/export_gpx')).toBe(true)
  })
  it.each([
    'http://example.com/ride.gpx',
    'https://localhost/x.gpx',
    'https://foo.localhost/x.gpx',
    'https://127.0.0.1:9001/x.gpx',
    'https://10.0.0.5/x.gpx',
    'https://172.20.1.1/x.gpx',
    'https://192.168.1.1/x.gpx',
    'https://169.254.169.254/latest/x.gpx',
    'https://0.0.0.0/x.gpx',
    'https://[::1]/x.gpx',
    'https://[fd00::1]/x.gpx',
    'file:///etc/passwd',
    'not a url',
  ])('refuses %s', url => {
    expect(isPublicHttpsUrl(url)).toBe(false)
  })
})

describe('fetchPublicFile', () => {
  it('does not follow redirects (they could point anywhere)', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:9001/' } }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchPublicFile('https://example.com/x.gpx', 1000)).toEqual({ error: 'fetch_failed' })
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
  })
  it('stops reading past the size limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(5000))))
    expect(await fetchPublicFile('https://example.com/x.gpx', 1000)).toEqual({ error: 'too_large' })
  })
  it('returns the body of a small public file', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<gpx/>')))
    const r = await fetchPublicFile('https://example.com/x.gpx', 1000)
    expect('data' in r && new TextDecoder().decode(r.data)).toBe('<gpx/>')
  })
  it('never fetches an internal address', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchPublicFile('https://127.0.0.1:9001/x.gpx', 1000)).toEqual({ error: 'not_allowed' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
