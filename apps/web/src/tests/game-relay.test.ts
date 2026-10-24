// @vitest-environment node
// The live-race relay (infra/lambdas/game-relay/relay.mjs): who may connect,
// passing messages on, and tidying up after connections that have gone.
import { describe, it, expect, beforeEach } from 'vitest'
import { createRelay, MAX_PER_SECOND } from '../../../../infra/lambdas/game-relay/relay.mjs'

type Relay = ReturnType<typeof createRelay>

let objects: Map<string, unknown>
let sent: [string, unknown][]
let gone: Set<string>
let clock: number
let relay: Relay

const store = {
  get: async (k: string) => objects.get(k) ?? null,
  put: async (k: string, v: unknown) => { objects.set(k, v) },
  del: async (k: string) => { objects.delete(k) },
  list: async (prefix: string) => [...objects.keys()].filter((k) => k.startsWith(prefix)),
}
const post = async (conn: string, text: string) => {
  if (gone.has(conn)) throw Object.assign(new Error('gone'), { gone: true })
  sent.push([conn, JSON.parse(text)])
}
const ev = (routeKey: string, connectionId: string, extra: object = {}) => ({ requestContext: { routeKey, connectionId }, ...extra })
const ticket = (userId: string, name: string, code = 'ABCD', expires = clock + 60_000) => {
  const t = `ticket-for-${userId}-${Math.random().toString(36).slice(2, 10)}`
  objects.set(`games/live/tickets/${t}.json`, { code, userId, name, expires })
  return t
}
const connect = (conn: string, t: string) => relay.handle(ev('$connect', conn, { queryStringParameters: { ticket: t } }))
const say = (conn: string, msg: unknown) => relay.handle(ev('$default', conn, { body: JSON.stringify(msg) }))
const to = (conn: string) => sent.filter(([c]) => c === conn).map(([, m]) => m)

beforeEach(() => {
  objects = new Map([['games/live/ABCD/meta.json', { code: 'ABCD' }]])
  sent = []
  gone = new Set()
  clock = 1_000_000
  relay = createRelay({ store, post, now: () => clock })
})

describe('connecting', () => {
  it('needs a ticket, which works once and only before it expires', async () => {
    expect(await relay.handle(ev('$connect', 'c1'))).toBe(401)
    expect(await connect('c1', 'not a ticket!')).toBe(401)
    const t = ticket('ann', 'Ann H.')
    expect(await connect('c1', t)).toBe(200)
    expect(await connect('c2', t)).toBe(401)
    expect(await connect('c3', ticket('bob', 'Bob G.', 'ABCD', clock - 1))).toBe(401)
  })

  it('refuses a race that has gone', async () => {
    expect(await connect('c1', ticket('ann', 'Ann H.', 'ZZZZ'))).toBe(404)
  })

  it('tells everyone who is here when a newcomer says hello, each player once', async () => {
    await connect('c1', ticket('ann', 'Ann H.'))
    clock += 10
    await connect('c2', ticket('bob', 'Bob G.'))
    await say('c2', { hello: true })
    const players = [{ id: 'ann', name: 'Ann H.' }, { id: 'bob', name: 'Bob G.' }]
    expect(to('c1')).toEqual([{ players }])
    expect(to('c2')).toEqual([{ players }])
  })
})

describe('passing messages on', () => {
  beforeEach(async () => {
    await connect('c1', ticket('ann', 'Ann H.'))
    await connect('c2', ticket('bob', 'Bob G.'))
    await connect('c3', ticket('cat', 'Cat D.'))
    sent = []
  })

  it('sends a message to everyone else in the race, saying who it is from', async () => {
    await say('c1', { m: ['s', 1.5, 2, 3] })
    expect(sent).toEqual([['c2', { from: 'ann', m: ['s', 1.5, 2, 3] }], ['c3', { from: 'ann', m: ['s', 1.5, 2, 3] }]])
  })

  it('or to one player', async () => {
    await say('c2', { m: { type: 'finish', time: 300 }, to: 'cat' })
    expect(sent).toEqual([['c3', { from: 'bob', m: { type: 'finish', time: 300 } }]])
  })

  it('keeps races apart', async () => {
    objects.set('games/live/WXYZ/meta.json', { code: 'WXYZ' })
    await connect('c9', ticket('dan', 'Dan E.', 'WXYZ'))
    await say('c9', { m: 'hi' })
    expect(sent).toEqual([])
  })

  it('ignores what is too big, too fast, not JSON, or from a connection it does not know', async () => {
    await relay.handle(ev('$default', 'c1', { body: 'x'.repeat(5000) }))
    await relay.handle(ev('$default', 'c1', { body: '{nope' }))
    await say('stranger', { m: 'hi' })
    expect(sent).toEqual([])
    clock += 1000 // a new second: those count towards the limit too
    for (let i = 0; i < MAX_PER_SECOND + 5; i++) await say('c1', { m: i })
    expect(to('c2')).toHaveLength(MAX_PER_SECOND)
  })

  it('drops a connection that has gone, and tells the others', async () => {
    gone.add('c3')
    await say('c1', { m: 'hi' })
    expect([...objects.keys()].some((k) => k.includes('c3'))).toBe(false)
    sent = []
    await relay.handle(ev('$disconnect', 'c2'))
    expect(to('c1')).toEqual([{ players: [{ id: 'ann', name: 'Ann H.' }] }])
    expect([...objects.keys()].filter((k) => k.includes('/conns/'))).toEqual(['games/live/ABCD/conns/c1.json', 'games/live/conns/c1.json'])
  })

  it('a second Lambda, knowing nothing yet, finds the race from S3', async () => {
    const other = createRelay({ store, post, now: () => clock })
    await other.handle(ev('$default', 'c2', { body: JSON.stringify({ m: 'from elsewhere' }) }))
    expect(sent.map(([c]) => c)).toEqual(['c1', 'c3'])
  })
})
