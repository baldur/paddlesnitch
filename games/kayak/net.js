// Live races, the pure part: what a boat sends about itself, and how the
// others' boats are played back smoothly. No DOM, no network (live.js is the
// network); tested in tests/kayak-net.test.js.
//
// Each browser sends its own boat's state ~15 times a second on an unreliable
// channel, so some arrive late, out of order or not at all. The other boats are
// drawn DELAY behind, between the two states either side of that moment, which
// hides the gaps; if nothing newer has come, they coast on along their heading.

export const SEND_HZ = 15;
export const DELAY = 0.1; // seconds behind the sender that the others' boats are shown
const KEEP = 1; // seconds of states kept per boat

// A boat's state as one short array (sent as JSON): sender time, position,
// heading, speed, roll, the last stroke's side and age, and whether it's in the water.
export function encodeState(t, boat) {
  const r = (v, k = 100) => Math.round(v * k) / k;
  return ['s', r(t, 1000), r(boat.x), r(boat.z), r(boat.heading, 1000), r(boat.speed), r(boat.roll, 1000),
    boat.paddle.side === 'left' ? 1 : boat.paddle.side === 'right' ? -1 : 0, r(boat.time - boat.paddle.at), boat.swim > 0 ? 1 : 0];
}

export function decodeState(msg) {
  if (!Array.isArray(msg) || msg[0] !== 's' || msg.length !== 10 || !msg.slice(1).every(Number.isFinite)) return null;
  const [, t, x, z, heading, speed, roll, side, since, swim] = msg;
  return { t, x, z, heading, speed, roll, side: side > 0 ? 'left' : side < 0 ? 'right' : null, since, swim: !!swim };
}

// The states received from one boat, and the clock offset to its sender
// (estimated as the smallest seen local-minus-sender difference, the least
// delayed message).
export function createTrack() {
  return { states: [], offset: null };
}

export function receive(track, state, now) {
  const offset = now - state.t;
  track.offset = track.offset === null ? offset : Math.min(track.offset, offset);
  if (track.states.length && state.t <= track.states.at(-1).t) {
    // Late: slot it in where it belongs (or drop it if it's a repeat).
    if (track.states.some((s) => s.t === state.t)) return;
    track.states.push(state);
    track.states.sort((a, b) => a.t - b.t);
  } else {
    track.states.push(state);
  }
  while (track.states.length > 2 && track.states[0].t < state.t - KEEP) track.states.shift();
}

// Where the boat was DELAY ago, in the sender's time: between the states either
// side of then, or coasting on from the last one (for up to half a second).
// k: the course's speedup (the boat covers speed × k a second).
export function sample(track, now, k = 1) {
  const { states } = track;
  if (!states.length) return null;
  const t = now - track.offset - DELAY;
  let i = states.length - 1;
  while (i > 0 && states[i - 1].t > t) i--;
  const b = states[i];
  const a = states[i - 1];
  if (a && a.t <= t && b.t >= t) {
    const f = (t - a.t) / (b.t - a.t || 1);
    return { ...b, x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, heading: a.heading + wrap(b.heading - a.heading) * f, roll: a.roll + (b.roll - a.roll) * f, speed: a.speed + (b.speed - a.speed) * f };
  }
  const last = states.at(-1);
  if (t <= last.t) return { ...states[0] };
  const ahead = Math.min(t - last.t, 0.5);
  return { ...last, x: last.x + Math.sin(last.heading) * last.speed * ahead * k, z: last.z - Math.cos(last.heading) * last.speed * ahead * k };
}

// Puts a sampled state onto a racer's boat (in race.js), for drawing, washes and collisions.
export function applyState(boat, s) {
  Object.assign(boat, { x: s.x, z: s.z, heading: s.heading, speed: s.speed, roll: s.roll, swim: s.swim ? 1 : 0 });
  if (s.side) boat.paddle = { side: s.side, at: boat.time - s.since };
}

function wrap(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
