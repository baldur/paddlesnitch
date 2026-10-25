import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { capture, flush, startAnalytics, reportClientError, isOwnScript, _config, _resetForTest } from './analytics'

// jsdom is the default vitest env here, so window/document/sessionStorage exist.
function lastFetchBody(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls.at(-1)
  return JSON.parse(call![1].body as string)
}

describe('client analytics buffer', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let beacon: ReturnType<typeof vi.fn>

  beforeEach(() => {
    _resetForTest()
    _config.enabled = true
    _config.flushIntervalMs = 15_000
    _config.maxBatch = 20
    _config.maxQueue = 100
    fetchMock = vi.fn(() => Promise.resolve({ ok: true } as Response))
    vi.stubGlobal('fetch', fetchMock)
    beacon = vi.fn(() => true)
    // jsdom's navigator has no sendBeacon — install one.
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    _resetForTest()
  })

  it('buffers events and does not send until a flush trigger', () => {
    capture('pageview', { path: '/att' })
    capture('upload')
    expect(fetchMock).not.toHaveBeenCalled()

    flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = lastFetchBody(fetchMock)
    expect(body.events.map((e: { event: string }) => e.event)).toEqual(['pageview', 'upload'])
    expect(body.events[0].props).toEqual({ path: '/att' })
    expect(typeof body.sid).toBe('string')
    expect(typeof body.events[0].t).toBe('number') // capture time recorded
  })

  it('drops non-allowlisted events at the door (never queued)', () => {
    // capture() takes any string; the allowlist is enforced at run time.
    capture('totally_made_up')
    flush()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('auto-flushes once the queue reaches maxBatch', () => {
    _config.maxBatch = 3
    capture('pageview')
    capture('pageview')
    expect(fetchMock).not.toHaveBeenCalled()
    capture('pageview') // hits the cap → flush
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(lastFetchBody(fetchMock).events).toHaveLength(3)
  })

  it('flushes on the interval timer', () => {
    startAnalytics()
    capture('pageview')
    expect(fetchMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(15_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('flushes via sendBeacon when the tab is hidden', () => {
    startAnalytics()
    capture('pageview')
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(beacon).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is a no-op when disabled', () => {
    _config.enabled = false
    capture('pageview')
    flush()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('re-queues events if the transport fails, so the next flush retries', () => {
    fetchMock.mockImplementationOnce(() => { throw new Error('network down') })
    capture('pageview')
    flush()               // throws internally → events put back
    expect(fetchMock).toHaveBeenCalledTimes(1)
    flush()               // retry succeeds
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(lastFetchBody(fetchMock).events).toHaveLength(1)
  })
})

describe('browser errors (observability)', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    _resetForTest()
    _config.enabled = true
    _config.maxBatch = 100
    fetchMock = vi.fn(() => Promise.resolve({ ok: true } as Response))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => { vi.unstubAllGlobals(); _resetForTest() })
  const sent = () => { flush(); return fetchMock.mock.calls.length ? lastFetchBody(fetchMock).events : [] }

  it('reports the first line of the message, each message once, at most 5 per page', () => {
    reportClientError('TypeError', 'x is undefined\n  at f (https://paddlesnitch.com/_next/a.js:1:1)')
    reportClientError('TypeError', 'x is undefined')
    for (let i = 0; i < 10; i++) reportClientError('Error', `boom ${i}`)
    const events = sent()
    expect(events).toHaveLength(5)
    expect(events[0]).toMatchObject({ event: 'client_error', props: { type: 'TypeError', message: 'x is undefined', path: '/' } })
  })

  it('"Script error." (another origin hidden from us) is never reported', () => {
    reportClientError('Error', 'Script error.')
    expect(sent()).toEqual([])
  })

  it('only errors from our own scripts reach us', () => {
    startAnalytics()
    const origin = window.location.origin
    window.dispatchEvent(new ErrorEvent('error', { message: 'from an extension', filename: 'chrome-extension://abc/content.js' }))
    window.dispatchEvent(new ErrorEvent('error', { message: 'no source' }))
    window.dispatchEvent(new ErrorEvent('error', { message: 'ours', filename: `${origin}/_next/static/chunks/app.js`, error: new TypeError('ours') }))
    expect(sent().map((e: { props: { message: string } }) => e.props.message)).toEqual(['ours'])
  })

  it('knows our own scripts by origin', () => {
    expect(isOwnScript('https://paddlesnitch.com/_next/a.js', 'https://paddlesnitch.com')).toBe(true)
    expect(isOwnScript('https://paddlesnitch.com.evil.example/a.js', 'https://paddlesnitch.com')).toBe(false)
    expect(isOwnScript(undefined, 'https://paddlesnitch.com')).toBe(false)
  })
})
