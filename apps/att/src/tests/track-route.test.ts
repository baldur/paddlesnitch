// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

import { POST as track } from '@/app/att/api/track/route'

afterEach(() => vi.restoreAllMocks())

function req(body: unknown, origin: string | null = 'https://paddlesnitch.com') {
  return new NextRequest('http://x/att/api/track', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(origin ? { origin } : {}) },
  })
}

describe('POST /att/api/track', () => {
  it('emits an EMF line for an allowed event and returns 204', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const res = await track(req({ event: 'pageview', path: '/att', sid: 'abc' }))
    expect(res.status).toBe(204)
    expect(spy).toHaveBeenCalledTimes(1)
    const emf = JSON.parse(spy.mock.calls[0][0] as string)
    expect(emf.Event).toBe('pageview')
    expect(emf.path).toBe('/att')
  })

  it('drops an unknown event without emitting (no arbitrary metrics) but still 204s', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const res = await track(req({ event: 'definitely-not-allowed' }))
    expect(res.status).toBe(204)
    expect(spy).not.toHaveBeenCalled()
  })

  it('handles a malformed body gracefully', async () => {
    const bad = new NextRequest('http://x/att/api/track', {
      method: 'POST', body: 'not json', headers: { origin: 'https://paddlesnitch.com' },
    })
    const res = await track(bad)
    expect(res.status).toBe(204)
  })

  it('drops a ping from a foreign origin without emitting (204, no signal)', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const res = await track(req({ event: 'pageview' }, 'https://evil.example.com'))
    expect(res.status).toBe(204)
    expect(spy).not.toHaveBeenCalled()
  })

  it('drops a ping with no Origin/Referer (a bare script) without emitting', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const res = await track(req({ event: 'pageview' }, null))
    expect(res.status).toBe(204)
    expect(spy).not.toHaveBeenCalled()
  })

  it('emits one EMF line per allowed event in a batch and drops unknown ones', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const captureTs = Date.now() - 5_000 // recent (within CloudWatch's accepted window)
    const res = await track(req({
      sid: 'sess1',
      events: [
        { event: 'pageview', path: '/att', t: captureTs },
        { event: 'nope' },                       // dropped
        { event: 'upload', props: { boat: 'K1' } },
      ],
    }))
    expect(res.status).toBe(204)
    expect(spy).toHaveBeenCalledTimes(2)
    const first = JSON.parse(spy.mock.calls[0][0] as string)
    expect(first.Event).toBe('pageview')
    expect(first.path).toBe('/att')
    expect(first.sid).toBe('sess1')
    expect(first._aws.Timestamp).toBe(captureTs) // event's own capture time
    const second = JSON.parse(spy.mock.calls[1][0] as string)
    expect(second.Event).toBe('upload')
    expect(second.boat).toBe('K1')                        // custom prop attached
    spy.mockRestore()
  })

  it('caps a batch at MAX_EVENTS so a flood can not emit unbounded metrics', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const events = Array.from({ length: 250 }, () => ({ event: 'pageview' }))
    await track(req({ sid: 's', events }))
    expect(spy.mock.calls.length).toBeLessThanOrEqual(100)
    spy.mockRestore()
  })

  it('rejects an out-of-range timestamp back to server time', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await track(req({ sid: 's', events: [{ event: 'pageview', t: 5 }] })) // ancient → dropped
    const emf = JSON.parse(spy.mock.calls[0][0] as string)
    expect(emf._aws.Timestamp).toBeGreaterThan(1_700_000_000_000)
    spy.mockRestore()
  })
})
