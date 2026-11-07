// Where a visit came from (#906), on the browser side: the tab's first page
// view sends the referring site's host name (never the URL, never our own
// site) and the landing page's utm tags; later page views send neither.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fromOwnSite, refFrom, utmFrom } from '@paddlesnitch/ui/metrics-events'
import { _config, _resetForTest, flush } from '@paddlesnitch/ui/analytics'

let pathname = '/'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))
import Analytics from '@paddlesnitch/ui/Analytics'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('refFrom (the referring site, as a host name only)', () => {
  it('keeps only the host name, without www.', () => {
    expect(refFrom('https://www.google.com/search?q=pat+rowe', 'paddlesnitch.com')).toBe('google.com')
    expect(refFrom('https://forum.example.org/t/kayak-timing/123#post-4', 'paddlesnitch.com')).toBe('forum.example.org')
  })
  it('drops our own site, and an empty or broken referrer', () => {
    expect(refFrom('https://paddlesnitch.com/att', 'paddlesnitch.com')).toBeUndefined()
    expect(refFrom('https://www.paddlesnitch.com/paddles', 'paddlesnitch.com')).toBeUndefined()
    expect(refFrom('http://localhost:3000/x', 'localhost')).toBeUndefined()
    expect(refFrom('', 'paddlesnitch.com')).toBeUndefined()
    expect(refFrom('not a url', 'paddlesnitch.com')).toBeUndefined()
  })
})

describe('fromOwnSite (a tab opened from one of our pages)', () => {
  it('is true for our own site, with or without www., and false otherwise', () => {
    expect(fromOwnSite('https://paddlesnitch.com/att', 'paddlesnitch.com')).toBe(true)
    expect(fromOwnSite('https://www.paddlesnitch.com/paddles', 'paddlesnitch.com')).toBe(true)
    expect(fromOwnSite('http://localhost:3000/x', 'localhost')).toBe(true)
    expect(fromOwnSite('https://www.google.com/', 'paddlesnitch.com')).toBe(false)
    expect(fromOwnSite('', 'paddlesnitch.com')).toBe(false)
    expect(fromOwnSite('not a url', 'paddlesnitch.com')).toBe(false)
  })
})

describe('utmFrom (the landing page campaign tags)', () => {
  it('keeps the three utm tags, trimmed and lower-cased, spaces as hyphens', () => {
    expect(utmFrom('?utm_source=Newsletter&utm_medium=%20email%20&utm_campaign=Spring+Sale&utm_term=pat&email=a@b.c'))
      .toEqual({ utm_source: 'newsletter', utm_medium: 'email', utm_campaign: 'spring-sale' })
  })
  it('caps each at 40 characters and drops anything that is not plain words', () => {
    expect(utmFrom('?utm_source=' + 'a'.repeat(60)).utm_source).toHaveLength(40)
    expect(utmFrom('?utm_source=pat@example.com&utm_medium=<b>')).toEqual({})
    expect(utmFrom('')).toEqual({})
  })
})

describe('the Analytics component', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let root: Root
  let host: HTMLDivElement
  const sent = () => fetchMock.mock.calls.flatMap(c => JSON.parse(c[1].body as string).events)
  const show = async (path: string) => {
    pathname = path
    window.history.replaceState({}, '', path)
    await act(async () => { root.render(<Analytics />) })
  }

  beforeEach(() => {
    _resetForTest()
    _config.enabled = true
    sessionStorage.clear()
    fetchMock = vi.fn(() => Promise.resolve({ ok: true } as Response))
    vi.stubGlobal('fetch', fetchMock)
    Object.defineProperty(document, 'referrer', { value: 'https://www.google.com/search?q=pat+rowe', configurable: true })
    host = document.createElement('div')
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    vi.unstubAllGlobals()
    _resetForTest()
    _config.enabled = false
  })

  it("sends the source on the tab's first page view only: host name and utm tags, never the URL or query", async () => {
    await show('/?utm_source=newsletter&utm_campaign=spring&email=pat@example.com')
    await show('/att')
    flush()
    const [first, second] = sent()
    expect(first.props).toEqual({ path: '/', visit: '1', ref: 'google.com', utm_source: 'newsletter', utm_campaign: 'spring' })
    expect(second.props).toEqual({ path: '/att' })
    for (const s of ['rowe', 'example', 'search', 'email']) expect(JSON.stringify(sent())).not.toContain(s)
  })

  it('does not count a new tab opened from one of our own pages as a visit', async () => {
    Object.defineProperty(document, 'referrer', { value: 'https://paddlesnitch.com/att', configurable: true })
    await show('/paddles?utm_source=newsletter')
    await show('/att')
    flush()
    expect(sent().map((e: { props: Record<string, string> }) => e.props)).toEqual([{ path: '/paddles' }, { path: '/att' }])
  })

  it('sends a visit with no referrer when there is none (typed address, bookmark)', async () => {
    Object.defineProperty(document, 'referrer', { value: '', configurable: true })
    await show('/paddles')
    flush()
    expect(sent()[0].props).toEqual({ path: '/paddles', visit: '1' })
  })

  it('sends no visit on any page view when sessionStorage is blocked', async () => {
    const blocked = () => { throw new Error('SecurityError') }
    vi.stubGlobal('sessionStorage', { getItem: blocked, setItem: blocked, removeItem: blocked, clear: blocked })
    await show('/')
    await show('/att')
    flush()
    expect(sent()).toHaveLength(2)
    for (const e of sent()) expect(e.props).not.toHaveProperty('visit')
  })

  it('counts a tab as one visit: a remount in the same tab is not a first page view', async () => {
    await show('/att')
    act(() => root.unmount())
    root = createRoot(host)
    await show('/paddles')
    flush()
    expect(sent().map((e: { props: Record<string, string> }) => e.props.visit)).toEqual(['1', undefined])
  })
})
