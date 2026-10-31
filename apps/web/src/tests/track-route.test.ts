// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

import { POST as track } from '@/app/att/api/track/route'
import { GAME_EVENT_PROPS } from '@paddlesnitch/ui/metrics-events'

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
        { event: 'pageview', path: '/att', props: { campaign: 'betatesters' } },
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
    expect(second.Event).toBe('pageview')
    expect(second.campaign).toBe('betatesters')           // an allowed prop
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

// Gameplay analytics (games/shared/analytics.js): what was played and chosen,
// never who. Only each event's own keys pass, with short plain values.
describe('game events', () => {
  const emitted = async (events: unknown[]) => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await track(req({ sid: 'tab1', events }))
    return spy.mock.calls.map(c => JSON.parse(c[0] as string))
  }

  it('records a play, a paddler and a session with every agreed prop', async () => {
    const PLAY = { mode: 'outing', course: 'loop', end: 'quit', secs: '312', place: '3', swims: '1', knocked: '2', bumps: '5', km: '3.5', from: 'walk' }
    const KIT = { body: 'slim', hair: 'bun', hat: 'none', beard: 'none', aid: 'true', glasses: 'wrap', sleeves: 'long', boat: 'nelo-vanquish-3', paddle: 'wing', shape: 'modern-round' }
    const SESSION = { secs: '61.5', plays: '2', from: 'menu', places: 'path,club,changing', input: 'keys,mouse', gpu: 'webgl2' }
    const [play, kit, session] = await emitted([
      { event: 'game_play', path: '/games/reading-thames/', props: PLAY },
      { event: 'game_kit', path: '/games/reading-thames/', props: KIT },
      { event: 'game_session', path: '/games/reading-thames/', props: SESSION },
    ])
    const props = (e: Record<string, unknown>) => {
      const { _aws: _a, Event: _e, Count: _c, sid: _s, path: _p, platform: _pl, ...rest } = e
      return rest
    }
    expect(props(play)).toEqual(PLAY)
    expect(props(kit)).toEqual(KIT)
    expect(props(session)).toEqual(SESSION)
    expect(play).toMatchObject({ Event: 'game_play', sid: 'tab1', path: '/games/reading-thames/' })
  })

  it('has no more keys an event than the route keeps (10)', () => {
    for (const rules of Object.values(GAME_EVENT_PROPS)) expect(Object.keys(rules).length).toBeLessThanOrEqual(10)
  })

  it('still sends a game event with no props, or props that are not an object', async () => {
    const [a, b] = await emitted([{ event: 'game_session', path: '/games/reading-thames/' }, { event: 'game_play', props: 'x' }])
    expect(a).toMatchObject({ Event: 'game_session', sid: 'tab1', path: '/games/reading-thames/' })
    expect(b).toMatchObject({ Event: 'game_play', sid: 'tab1' })
  })

  it('drops keys an event does not have (colours, names) and values that are not short plain words', async () => {
    const [kit] = await emitted([{ event: 'game_kit', props: {
      body: 'broad', top: '#2563eb', skin: '#c48a60', name: 'pat', hair: 'Pat Rowe', hat: 'x'.repeat(61), beard: 'pat@example.com',
    } }])
    expect(kit.body).toBe('broad')
    for (const k of ['top', 'skin', 'name', 'hair', 'hat', 'beard']) expect(kit).not.toHaveProperty(k)
  })

  it("takes a fixed choice only from the game's own set, and numbers only as numbers", async () => {
    const [kit, play, session] = await emitted([
      { event: 'game_kit', props: { body: 'slim', hair: 'patrowe', hat: 'pat.rowe', aid: 'yes', paddle: 'wing' } },
      { event: 'game_play', path: '/games/reading-thames/', props: { mode: 'outing', secs: 'patrowe', place: '1', end: 'whatever', km: '3.5km', swims: 2, sid: 'forged', platform: 'ios' } },
      { event: 'game_session', path: '/att/someone', props: { input: 'keys,patrowe', gpu: 'webgpu', secs: '12' } },
    ])
    expect(kit).toMatchObject({ body: 'slim', paddle: 'wing' })
    for (const k of ['hair', 'hat', 'aid']) expect(kit).not.toHaveProperty(k)
    expect(play).toMatchObject({ mode: 'outing', place: '1', path: '/games/reading-thames/' })
    for (const k of ['secs', 'end', 'km', 'swims']) expect(play).not.toHaveProperty(k) // swims sent as a number
    expect(play).toMatchObject({ sid: 'tab1', platform: 'web' })                        // never the client's
    expect(session).toMatchObject({ gpu: 'webgpu', secs: '12' })
    expect(session).not.toHaveProperty('input')
    expect(session).not.toHaveProperty('path') // only a page under /games
  })

  it("keeps only each event's own fields, and cleans every path (the archive keeps them for good)", async () => {
    const [pv, cta, open, up] = await emitted([
      { event: 'pageview', path: '/buddies/user-123?email=a@b.c', props: { campaign: 'betatesters', note: 'Anything Goes', email: 'a@b.c' } },
      { event: 'campaign_cta', path: '/plan/shared/Xy12abC_9', props: { campaign: 'Not A Campaign!' } },
      { event: 'app_open', path: 'app:paddles', props: { who: 'pat' } },
      { event: 'upload', path: 'https://evil.example/x', props: { boat: 'K1' } },
    ])
    expect(pv).toMatchObject({ Event: 'pageview', path: '/buddies/[id]', campaign: 'betatesters' })
    for (const k of ['note', 'email']) expect(pv).not.toHaveProperty(k)
    expect(cta.path).toBe('/plan/shared/[id]')
    expect(cta).not.toHaveProperty('campaign')
    expect(open.path).toBe('app:paddles')
    expect(open).not.toHaveProperty('who')
    expect(up).not.toHaveProperty('path')
    expect(up).not.toHaveProperty('boat')
    const bad = (await emitted([{ event: 'app_open', path: 'app:Paddles/123 x' }])).at(-1)
    expect(bad.Event).toBe('app_open')
    expect(bad).not.toHaveProperty('path')
  })

  it('takes a session id only as a random id, never free text', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await track(req({ sid: 'pat@example.com', events: [{ event: 'pageview', path: '/att' }] }))
    await track(req({ sid: '3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d', events: [{ event: 'pageview', path: '/att' }] }))
    const [a, b] = spy.mock.calls.map(c => JSON.parse(c[0] as string))
    expect(a).not.toHaveProperty('sid')
    expect(b.sid).toBe('3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d')
  })

  it("keeps a page error's type only if it looks like an error's name", async () => {
    const out = await emitted([
      { event: 'client_error', path: '/att', props: { type: 'TypeError', message: 'x is undefined' } },
      { event: 'client_error', path: '/att', props: { type: 'Pat Rowe <pat@example.com>', message: 'boom' } },
    ])
    const [ok, bad] = out.slice(-2)
    expect(ok.type).toBe('TypeError')
    expect(bad).not.toHaveProperty('type')
  })

  it("a prop can't pose as the event's time or name", async () => {
    const [pv] = await emitted([{ event: 'pageview', path: '/att', props: { ts: 'x', Event: 'login', _aws: {} } }])
    expect(pv.Event).toBe('pageview')
    expect(pv).not.toHaveProperty('ts')
  })
})
