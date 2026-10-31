// Live races, the network part: one WebSocket to the relay (infra/lambdas/game-relay),
// which passes each message on to the others in the race
// (docs/features/game-accounts-leaderboard-live.md). No phone connects to
// another, so it works on any network that loads web pages.
//
// The connection needs a one-use ticket from our API (games.live.create, .join
// or .ticket). If it drops (a phone's screen locking, a tunnel) we fetch a new
// ticket and reconnect; race events sent meanwhile wait and go when it's back.
import { call } from './account.js';

const PING = 4 * 60_000; // ms; the relay closes a connection silent for 10 minutes
const ECHO = 2000; // ms between round-trip measurements in the lobby
const RETRY = [1000, 2000, 4000, 8000]; // ms to wait before each reconnect

// info: { room, players, you, relay: { url, ticket } } from games.live.create or .join.
// on: { players(list), message(id, msg) }.
export function joinLive({ room, players, you, relay }, on) {
  const code = room.code;
  const url = relay.url ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/live`;
  let list = players; // everyone in the race
  let here = new Set([you]); // who is connected to the relay now
  const seen = new Set(); // who has been connected at some point
  const rtts = new Map(); // id -> ms there and back through the relay
  const waiting = []; // race events to send once reconnected
  let ws = null;
  let closed = false;
  let tries = 0;

  const status = (id) => (id === you ? 'open' : ws?.readyState !== WebSocket.OPEN ? 'connecting'
    : here.has(id) ? 'open' : seen.has(id) ? 'gone' : 'waiting');

  const raw = (msg) => {
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  };

  // The relay's list of who's connected: new players join the list, and anyone
  // who drops out is told to the game as having left.
  const onPlayers = (now) => {
    const ids = new Set(now.map((p) => p.id));
    for (const p of now) {
      if (!list.some((q) => q.id === p.id)) list = [...list, p];
    }
    for (const id of here) {
      if (!ids.has(id) && id !== you) on.message?.(id, { type: 'bye' });
    }
    here = new Set([...ids, you]);
    for (const id of ids) seen.add(id);
    on.players?.(list);
  };

  const connect = (ticket) => {
    ws = new WebSocket(`${url}?ticket=${encodeURIComponent(ticket)}`);
    ws.onopen = () => {
      tries = 0;
      raw({ hello: true });
      while (waiting.length && raw(waiting[0])) waiting.shift();
      on.players?.(list);
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.players) return onPlayers(msg.players);
      const m = msg.m;
      if (m?.type === 'echo') return void raw({ m: { type: 'echoed', t: m.t }, to: msg.from });
      if (m?.type === 'echoed') return void rtts.set(msg.from, Math.round(performance.now() - m.t));
      on.message?.(msg.from, m);
    };
    ws.onclose = () => {
      if (closed) return;
      on.players?.(list);
      setTimeout(reconnect, RETRY[Math.min(tries++, RETRY.length - 1)]);
    };
  };

  const reconnect = async () => {
    if (closed) return;
    try {
      connect((await call('games.live.ticket', { code }, { mutation: true })).ticket);
    } catch (err) {
      if (err.status === 404 || err.status === 403) return; // the race is over
      setTimeout(reconnect, RETRY.at(-1));
    }
  };

  connect(relay.ticket);
  const pinger = setInterval(() => raw({ ping: true }), PING);
  let echoer = setInterval(() => raw({ m: { type: 'echo', t: performance.now() } }), ECHO);

  return {
    code,
    you,
    get players() { return list; },
    get host() { return room.host; },
    status,
    // Round trip to a player and back through the relay, in ms (null until measured).
    rtt: (id) => rtts.get(id) ?? null,
    // Boat states: dropped while disconnected (the next one will do). Race events: kept until sent.
    fast: (msg) => raw({ m: msg }),
    sure: (msg, only) => {
      const out = only ? { m: msg, to: only } : { m: msg };
      if (!raw(out)) waiting.push(out);
    },
    // Once racing, measure round trips less often (each costs relay messages).
    racing() {
      clearInterval(echoer);
      echoer = setInterval(() => raw({ m: { type: 'echo', t: performance.now() } }), ECHO * 5);
    },
    close() {
      closed = true;
      clearInterval(pinger);
      clearInterval(echoer);
      raw({ m: { type: 'bye' } });
      ws?.close();
    },
  };
}
