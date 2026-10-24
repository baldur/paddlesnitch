// Live races, the network part: players find each other through the race's
// mailbox on our API (games.live.*), then talk browser to browser over WebRTC
// (docs/features/game-accounts-leaderboard-live.md). Everyone connects to
// everyone (up to six). The later of each pair to join makes the offer; offers
// and answers carry all their connection candidates, so a pair needs just the
// two messages. Each connection has two channels: 'fast' (unordered, never
// resent) for boat states, and 'sure' (reliable) for race events.
import { call } from './account.js';

// Google's free STUN server finds each player's public address. There's no
// TURN relay, so some strict networks (several mobile carriers) can't connect.
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
const POLL = 1000; // ms between mailbox checks while in the lobby
const GATHER = 3000; // ms to wait for connection candidates before sending what we have

// room: { room, players, you } from games.live.create or .join.
// on: { players(list), peer(id, status), message(id, msg) }.
export function joinLive({ room, players, you }, on) {
  const code = room.code;
  const peers = new Map(); // id -> { pc, fast, sure, status }
  let list = players;
  let timer = null;
  let closed = false;
  const me = () => list.find((p) => p.id === you);

  const status = (id, s) => {
    const p = peers.get(id);
    if (p && p.status !== s) {
      p.status = s;
      on.peer?.(id, s);
    }
  };

  const connection = (id) => {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const peer = { pc, fast: null, sure: null, status: 'connecting' };
    peers.set(id, peer);
    const wire = (channel) => {
      peer[channel.label] = channel;
      channel.onopen = () => {
        if (peer.fast?.readyState === 'open' && peer.sure?.readyState === 'open') status(id, 'open');
      };
      channel.onmessage = (e) => {
        try {
          on.message?.(id, JSON.parse(e.data), channel.label);
        } catch {}
      };
      channel.onclose = () => status(id, 'gone');
    };
    pc.ondatachannel = (e) => wire(e.channel);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') status(id, 'failed');
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') status(id, 'gone');
    };
    peer.wire = wire;
    return peer;
  };

  // All the candidates in the description, or what we have after GATHER.
  const gathered = (pc) => new Promise((done) => {
    if (pc.iceGatheringState === 'complete') return done();
    const t = setTimeout(done, GATHER);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(t);
        done();
      }
    });
  });

  const offer = async (id) => {
    const peer = connection(id);
    peer.wire(peer.pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 }));
    peer.wire(peer.pc.createDataChannel('sure'));
    await peer.pc.setLocalDescription(await peer.pc.createOffer());
    await gathered(peer.pc);
    await call('games.live.send', { code, to: id, kind: 'offer', sdp: peer.pc.localDescription.sdp }, { mutation: true });
  };

  const answer = async (from, sdp) => {
    peers.get(from)?.pc.close();
    const peer = connection(from);
    await peer.pc.setRemoteDescription({ type: 'offer', sdp });
    await peer.pc.setLocalDescription(await peer.pc.createAnswer());
    await gathered(peer.pc);
    await call('games.live.send', { code, to: from, kind: 'answer', sdp: peer.pc.localDescription.sdp }, { mutation: true });
  };

  // Offer to everyone who joined before us that we haven't yet.
  const meet = () => {
    const mine = me()?.joinedAt ?? '';
    for (const p of list) {
      if (p.id !== you && p.joinedAt < mine && !peers.has(p.id)) offer(p.id).catch(() => status(p.id, 'failed'));
    }
  };

  const poll = async () => {
    if (closed) return;
    try {
      for (const m of await call('games.live.inbox', { code }, { mutation: true })) {
        if (m.kind === 'offer') await answer(m.from, m.sdp);
        else await peers.get(m.from)?.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
      }
      const fresh = await call('games.live.room', { code });
      if (fresh.players.length !== list.length) {
        list = fresh.players;
        on.players?.(list);
      }
      meet();
    } catch {}
    if (!closed && timer !== 'stopped') timer = setTimeout(poll, POLL);
  };

  on.players?.(list);
  meet();
  timer = setTimeout(poll, 0);

  const send = (msg, channel, only) => {
    const data = JSON.stringify(msg);
    for (const [id, p] of peers) {
      const ch = p[channel];
      if ((!only || only === id) && ch?.readyState === 'open') {
        try {
          ch.send(data);
        } catch {}
      }
    }
  };

  return {
    code,
    you,
    get players() { return list; },
    get host() { return room.host; },
    status: (id) => peers.get(id)?.status ?? (id === you ? 'open' : 'waiting'),
    // Boat states: unreliable. Race events: reliable.
    fast: (msg) => send(msg, 'fast'),
    sure: (msg, only) => send(msg, 'sure', only),
    // Once racing, nobody new can join: stop checking the mailbox.
    stopPolling() {
      clearTimeout(timer);
      timer = 'stopped';
    },
    close() {
      closed = true;
      clearTimeout(timer);
      send({ type: 'bye' }, 'sure');
      for (const p of peers.values()) p.pc.close();
      peers.clear();
    },
  };
}
