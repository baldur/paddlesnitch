// The live-race relay (docs/features/game-accounts-leaderboard-live.md): every
// phone in a race holds one WebSocket to API Gateway, and this passes each
// message on to the others in the race. No direct connections between phones,
// so it works on any network that can load a web page.
//
// State is in S3, one small object per fact (S3 has no append), under the
// games/live/ prefix the one-day expiry rule sweeps:
//
//   games/live/tickets/<ticket>.json       a one-use pass to connect, written by the site's API
//   games/live/<code>/conns/<conn>.json    an open connection in race <code>: { userId, name, at }
//   games/live/conns/<conn>.json           which race a connection is in (a disconnect names only the connection)
//
// Each warm Lambda keeps a race's connections in memory for a couple of
// seconds, so most messages never touch S3. A connection that has gone away
// answers "gone" when sent to, and is dropped then.
//
// Pure apart from what's passed in, so the same code runs in the Lambda
// (index.mjs), the local dev server (games/tests/site.mjs) and the tests.
//
//   store: { get(key) -> object|null, put(key, object), del(key), list(prefix) -> keys }
//   post(conn, text): throws an error with .gone = true when the connection has closed

export const MAX_CONNS = 12 // six players, each perhaps with a just-dropped connection not yet tidied away
export const MAX_BYTES = 2048 // a boat state is about 80 bytes; race events are smaller
export const MAX_PER_SECOND = 30 // a phone sends 10 a second; more than this is dropped
const FRESH_MS = 2000 // how long a race's connection list is trusted

const TICKET = /^[A-Za-z0-9_-]{20,64}$/
const ticketKey = (t) => `games/live/tickets/${t}.json`
const connKey = (code, conn) => `games/live/${code}/conns/${conn}.json`
const indexKey = (conn) => `games/live/conns/${conn}.json`
const connsPrefix = (code) => `games/live/${code}/conns/`

export function createRelay({ store, post, now = Date.now }) {
  const races = new Map() // code -> { at, members: Map(conn -> { userId, name, at }) }
  const raceOf = new Map() // conn -> code
  const rates = new Map() // conn -> { second, count }

  async function members(code, force = false) {
    const cached = races.get(code)
    if (cached && !force && now() - cached.at < FRESH_MS) return cached.members
    const keys = await store.list(connsPrefix(code))
    const found = await Promise.all(keys.map(async (k) => [k.slice(connsPrefix(code).length, -'.json'.length), await store.get(k)]))
    const fresh = { at: now(), members: new Map(found.filter(([, m]) => m)) }
    races.set(code, fresh)
    return fresh.members
  }

  async function codeOf(conn) {
    if (!raceOf.has(conn)) {
      const index = await store.get(indexKey(conn))
      if (!index) return null
      raceOf.set(conn, index.code)
    }
    return raceOf.get(conn)
  }

  async function forget(code, conn) {
    races.get(code)?.members.delete(conn)
    raceOf.delete(conn)
    rates.delete(conn)
    await Promise.all([store.del(connKey(code, conn)), store.del(indexKey(conn))])
  }

  // Sends to each connection; drops any that have gone.
  async function send(code, conns, text) {
    await Promise.all(conns.map(async (conn) => {
      try {
        await post(conn, text)
      } catch (err) {
        if (err?.gone) await forget(code, conn)
        else throw err
      }
    }))
  }

  // Who's connected: each player once, in the order they connected.
  async function announce(code) {
    const all = await members(code, true)
    const players = []
    for (const m of [...all.values()].sort((a, b) => a.at.localeCompare(b.at))) {
      if (!players.some((p) => p.id === m.userId)) players.push({ id: m.userId, name: m.name })
    }
    await send(code, [...all.keys()], JSON.stringify({ players }))
  }

  function tooFast(conn) {
    const second = Math.floor(now() / 1000)
    const r = rates.get(conn)
    if (!r || r.second !== second) {
      rates.set(conn, { second, count: 1 })
      return false
    }
    return ++r.count > MAX_PER_SECOND
  }

  async function connect(conn, query) {
    const ticket = query?.ticket
    if (!ticket || !TICKET.test(ticket)) return 401
    const pass = await store.get(ticketKey(ticket))
    if (!pass || pass.expires < now()) return 401
    await store.del(ticketKey(ticket))
    if (!(await store.get(`games/live/${pass.code}/meta.json`))) return 404
    if ((await members(pass.code, true)).size >= MAX_CONNS) return 429
    const me = { userId: pass.userId, name: pass.name, at: new Date(now()).toISOString() }
    await store.put(connKey(pass.code, conn), me)
    await store.put(indexKey(conn), { code: pass.code })
    raceOf.set(conn, pass.code)
    races.get(pass.code)?.members.set(conn, me)
    return 200
  }

  async function disconnect(conn) {
    const code = await codeOf(conn)
    if (!code) return 200
    await forget(code, conn)
    await announce(code)
    return 200
  }

  // { hello } once connected: tell everyone who's here (a new connection can't
  // be sent to while it's still being accepted). { ping } keeps an idle
  // connection open. { m, to? }: pass m on to the others, or just to player `to`.
  async function message(conn, body) {
    if (typeof body !== 'string' || body.length > MAX_BYTES || tooFast(conn)) return 200
    let msg
    try {
      msg = JSON.parse(body)
    } catch {
      return 200
    }
    const code = await codeOf(conn)
    if (!code || !msg || typeof msg !== 'object') return 200
    if (msg.hello) {
      await announce(code)
      return 200
    }
    if (!('m' in msg)) return 200
    let all = await members(code)
    if (!all.has(conn)) all = await members(code, true)
    const from = all.get(conn)
    if (!from) return 200
    const to = [...all].filter(([c, m]) => c !== conn && m.userId !== from.userId && (!msg.to || m.userId === msg.to)).map(([c]) => c)
    await send(code, to, JSON.stringify({ from: from.userId, m: msg.m }))
    return 200
  }

  // An API Gateway WebSocket event -> the status code to answer with.
  async function handle(event) {
    const { routeKey, connectionId } = event.requestContext
    if (routeKey === '$connect') return connect(connectionId, event.queryStringParameters)
    if (routeKey === '$disconnect') return disconnect(connectionId)
    return message(connectionId, event.body)
  }

  return { handle, connect, disconnect, message }
}
