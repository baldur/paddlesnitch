// @vitest-environment node
// The one-off Strava shutdown (scripts/strava-shutdown.ts), against a fake store
// and a fake Strava: what it lists, what it calls, what it deletes, and that it
// never touches paddles or prints a token or an id.
import { describe, it, expect, vi } from 'vitest'
import { plan, run, accessTokenFor, type Store } from '../../scripts/strava-shutdown'

const NOW = 1_800_000_000
const creds = { clientId: 'CID', clientSecret: 'CSECRET' }

function fakeStore(files: Record<string, unknown>) {
  const data = new Map(Object.entries(files))
  const deleted: string[] = []
  const store: Store = {
    listKeys: async prefix => [...data.keys()].filter(k => k.startsWith(prefix)),
    getJson: async <T,>(key: string) => (data.has(key) ? (data.get(key) as T) : null),
    deleteObject: async key => { deleted.push(key); data.delete(key) },
  }
  return { store, data, deleted }
}

// Strava, as a fetch: records every call; `answers` picks a status by URL.
function fakeStrava(answers: (url: string, init?: RequestInit) => Response | undefined = () => undefined) {
  const calls: { url: string; method: string; auth?: string; body?: string }[] = []
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', auth: (init?.headers as Record<string, string> | undefined)?.Authorization, body: init?.body?.toString() })
    const custom = answers(url, init)
    if (custom) return custom
    if (url.includes('/push_subscriptions') && (init?.method ?? 'GET') === 'GET') return Response.json([{ id: 4242 }])
    if (url.includes('/push_subscriptions/')) return new Response(null, { status: 204 })
    if (url.endsWith('/oauth/token')) return Response.json({ access_token: 'FRESH-ACCESS', refresh_token: 'FRESH-REFRESH', expires_at: NOW + 21600 })
    if (url.endsWith('/oauth/deauthorize')) return Response.json({ access_token: 'x' })
    return new Response('?', { status: 500 })
  })
  return { f: f as unknown as typeof fetch, calls }
}

const FILES = {
  'users/u1/strava.json': { athleteId: 111, accessToken: 'LIVE-1', refreshToken: 'R-1', expiresAt: NOW + 3600 },
  'users/u2/strava.json': { athleteId: 222, accessToken: 'OLD-2', refreshToken: 'R-2', expiresAt: NOW - 10 },
  'users/u1/strava-prefs.json': { autoImport: true },
  'users/u3/strava-prefs.json': { autoImport: false },
  'strava-athletes/111.json': { userId: 'u1' },
  'strava-athletes/222.json': { userId: 'u2' },
  // Never touched:
  'users/u1/profile.json': { public: true },
  'users/u1/contact.json': { email: 'real@example.com' },
  'analysis/u1/p1.json': { source: { type: 'strava', stravaActivityId: 9 } },
  'users/u1/strava.json.bak': {},
}

describe('plan', () => {
  it('lists only the three Strava key shapes, never paddles or other account files', async () => {
    const { store } = fakeStore(FILES)
    expect(await plan(store)).toEqual({
      tokens: ['users/u1/strava.json', 'users/u2/strava.json'],
      prefs: ['users/u1/strava-prefs.json', 'users/u3/strava-prefs.json'],
      athletes: ['strava-athletes/111.json', 'strava-athletes/222.json'],
    })
  })
})

describe('accessTokenFor', () => {
  it('uses a live token as it is, and refreshes an expired one with the client id and secret', async () => {
    const { f, calls } = fakeStrava()
    expect(await accessTokenFor({ accessToken: 'LIVE', expiresAt: NOW + 3600 }, creds, f, NOW)).toBe('LIVE')
    expect(calls).toEqual([])
    expect(await accessTokenFor({ accessToken: 'OLD', refreshToken: 'R', expiresAt: NOW - 1 }, creds, f, NOW)).toBe('FRESH-ACCESS')
    expect(calls[0].body).toContain('client_id=CID')
    expect(calls[0].body).toContain('grant_type=refresh_token')
  })

  it('a refresh Strava refuses means the access has already ended', async () => {
    const { f } = fakeStrava(url => (url.endsWith('/oauth/token') ? new Response('{}', { status: 400 }) : undefined))
    expect(await accessTokenFor({ refreshToken: 'R', expiresAt: 0 }, creds, f, NOW)).toBe('refused')
  })
})

describe('run', () => {
  it('a dry run calls nobody and deletes nothing', async () => {
    const { store, deleted } = fakeStore(FILES)
    const { f, calls } = fakeStrava()
    const lines: string[] = []
    const r = await run({ apply: false, store, fetch: f, nowS: NOW, log: l => lines.push(l) })
    expect(calls).toEqual([])
    expect(deleted).toEqual([])
    expect(r.tokens).toBe(2)
    expect(lines.join('\n')).toMatch(/2 Strava connection\(s\).*2 preference.*2 athlete index/)
  })

  it('--apply deletes the webhook, ends each connection (refreshing an old token), and deletes only the Strava files', async () => {
    const { store, data, deleted } = fakeStore(FILES)
    const { f, calls } = fakeStrava()
    const lines: string[] = []
    const r = await run({ apply: true, store, creds, fetch: f, nowS: NOW, log: l => lines.push(l) })

    // The webhook goes first, before any access is ended.
    expect(calls[0]).toMatchObject({ method: 'GET' })
    expect(calls[0].url).toContain('/api/v3/push_subscriptions?client_id=CID&client_secret=CSECRET')
    expect(calls[1]).toMatchObject({ method: 'DELETE' })
    expect(calls[1].url).toContain('/api/v3/push_subscriptions/4242?')
    // u1 live: deauthorized with its own token. u2 expired: refreshed, then deauthorized.
    const deauths = calls.filter(c => c.url.endsWith('/oauth/deauthorize')).map(c => c.auth)
    expect(deauths).toEqual(['Bearer LIVE-1', 'Bearer FRESH-ACCESS'])

    expect(deleted.sort()).toEqual([
      'strava-athletes/111.json', 'strava-athletes/222.json',
      'users/u1/strava-prefs.json', 'users/u1/strava.json', 'users/u2/strava.json', 'users/u3/strava-prefs.json',
    ])
    for (const kept of ['users/u1/profile.json', 'users/u1/contact.json', 'analysis/u1/p1.json', 'users/u1/strava.json.bak']) expect(data.has(kept), kept).toBe(true)
    expect(r).toMatchObject({ subscriptions: 1, subscriptionsDeleted: 1, tokens: 2, ended: 2, failed: 0, prefsDeleted: 2, athletesDeleted: 2 })
  })

  it('prints counts only: no tokens, secrets, athlete ids or account ids', async () => {
    const { store } = fakeStore(FILES)
    const { f } = fakeStrava()
    const lines: string[] = []
    await run({ apply: true, store, creds, fetch: f, nowS: NOW, log: l => lines.push(l) })
    const out = lines.join('\n')
    for (const secret of ['LIVE-1', 'OLD-2', 'R-1', 'R-2', 'FRESH', 'CSECRET', 'CID', '111', '222', 'u1', 'u2', 'u3', '4242']) expect(out, secret).not.toContain(secret)
  })

  it('a connection Strava already refuses counts as ended; one that fails otherwise is kept for a second run', async () => {
    const { store, data } = fakeStore(FILES)
    const { f } = fakeStrava((url, init) => {
      if (!url.endsWith('/oauth/deauthorize')) return undefined
      const auth = (init?.headers as Record<string, string>).Authorization
      return auth === 'Bearer LIVE-1' ? new Response('{}', { status: 401 }) : new Response('down', { status: 503 })
    })
    const r = await run({ apply: true, store, creds, fetch: f, nowS: NOW, log: () => {} })
    expect(r).toMatchObject({ ended: 1, failed: 1 })
    expect(data.has('users/u1/strava.json')).toBe(false)
    expect(data.has('users/u2/strava.json')).toBe(true)
  })

  it('refuses to act without the client id and secret', async () => {
    const { store, deleted } = fakeStore(FILES)
    await expect(run({ apply: true, store, fetch: fakeStrava().f, log: () => {} })).rejects.toThrow(/SSM/)
    expect(deleted).toEqual([])
  })
})
