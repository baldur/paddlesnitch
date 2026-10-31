// Other boats on the river: single scullers, eights, kayakers out paddling,
// pleasure cruisers and motorboats. Only kayaks race; these are out for their own reasons, keep to
// their right of the river's main channel (never a race route's side channel)
// and don't stop for anyone. Hit one, or its oars, and you're in; motorboats
// and eights leave a wash that rocks you.
//
// Scullers, cruisers and motorboats only ever come towards the race: a sculler
// paddling about, and boats held to the Thames's 8 km/h, would never catch a
// racing K1. An eight is quicker, so now and then one comes up from behind,
// with the cox's warning in time to move over.
//
// Each boat is timed to meet the pack once, at a random moment, and is only on
// the water for a while either side of it. Nothing reacts to the racers, so
// the traffic is the same in every copy of a live race. Its random numbers are
// its own, from the race's seed. Pure, no DOM.
import { locate, pointAt, widthAt } from './course.js';

// length (m), the hull's half width, oars (the part of the length they sweep,
// from the stern, and how far out they reach), speed (m/s, real), wash.
export const TRAFFIC = {
  sculler: { length: 8.2, hull: 0.3, oars: [0.35, 0.7, 2.9], speed: 3.5, wash: 0.1, weight: 0.3 },
  // A kayaker out for a paddle: a touring pace, the paddle sweeping a metre out each side.
  kayaker: { length: 5.2, hull: 0.3, oars: [0.4, 0.62, 1.15], speed: 2.3, wash: 0.05, weight: 0.3 },
  eight: { length: 17.5, hull: 0.32, oars: [0.12, 0.85, 3.2], speed: 5, wash: 0.55, weight: 0.22 },
  cruiser: { length: 11, hull: 1.75, speed: 1.8, wash: 0.3, weight: 0.2 },
  motorboat: { length: 6, hull: 1.2, speed: 2.2, wash: 0.8, weight: 0.28 },
};
const BEHIND = 0.35; // of the eights, the share that come up from behind
const MEAN_GAP = 120; // seconds of racing between boats, on average (gaps are random: some races are quiet; owner 2026-10-31: a little busier than the 150 it was)
const PACE = 3.6; // m/s, a racing K1's, for when the pack will be where
const FIRST = 60; // seconds into the race before the first meeting: the start has spread out by then
const BEFORE = 60; // seconds on the water before meeting the pack
const AFTER = 45; // and after
// An eight closes on a racing K1 at only a metre or two a second, so one from
// behind is timed later, and is on the water from the start, working up from
// the bottom of the river (it would appear among the pack otherwise).
const BEHIND_FIRST = 90;
// And only where there's room to get by a pack: no crew tries it on a narrow river.
const ROOM = 18; // metres between the banks, all along where it would overtake
const wide = (river, s, k) => {
  for (let x = s - 200 * k; x <= s + 200 * k; x += 10) if (x > 0 && x < river.length && widthAt(river, x).half * 2 < ROOM) return false;
  return true;
};
const WARN = 30; // metres, an eight behind's bow from your stern, when the cox shouts
const KAYAK = { bow: 3.3, stern: 1.9, half: 0.25 }; // as race.js

// The boats for a race on `course`: a timetable, nothing moving yet. Options,
// for the outings (outing.js): `gap`, the average seconds between meetings;
// `route`, { at(t) -> a point with its heading (x, z, tx, tz), seconds } for
// where you'll be when, in place of the pack's way round the course; or
// `ambient`, that many seconds of boats up and down the whole river, met or
// not (for a boat that goes anywhere), the river already busy at the start.
export function createTraffic(course, seed, { gap: mean = MEAN_GAP, route = null, ambient = 0 } = {}) {
  const rand = mulberry32((seed ^ 0x5eed7) >>> 0);
  const river = course.scenery?.river ?? course;
  const k = course.speedup ?? 1;
  const boats = [];
  const gap = () => -Math.log(1 - rand()) * mean;
  const boat = (kind, behind, dir, s, t) => ({
    kind, behind, dir, meet: s, at: t,
    x: 0, z: 0, heading: 0, s, lateral: 0, on: false, warned: false, phase: rand() * 10, // phase: the oars' stroke
    hit: [], // who it has tipped in: they're not hit again climbing back in
  });
  if (ambient) {
    for (let t = -AFTER; t < ambient; t += gap()) boats.push(boat(pick(rand), false, rand() < 0.5 ? 1 : -1, rand() * river.length, t));
    return { river, boats, k };
  }
  const racing = route ? route.seconds : (course.finish - course.start) / (PACE * k); // seconds, about
  const where = route ? route.at : (t) => pointAt(course, course.start + PACE * k * t);
  for (let t = (route ? 10 : FIRST) + gap(); t < racing - 10; t += (route ? 5 : 15) + gap()) {
    const kind = pick(rand);
    // Where the pack (or you) should be then, if in the main channel there.
    const p = where(t);
    const at = locate(river, p.x, p.z);
    if (Math.abs(at.lateral) > widthAt(river, at.s).half) continue;
    const along = Math.sign(p.tx * at.tx + p.tz * at.tz) || 1; // the race's way along the river there
    const behind = kind === 'eight' && rand() < BEHIND && t > BEHIND_FIRST && wide(river, at.s, k);
    boats.push(boat(kind, behind, behind ? along : -along, at.s, t));
  }
  return { river, boats, k };
}

function pick(rand) {
  let r = rand() * Object.values(TRAFFIC).reduce((a, t) => a + t.weight, 0);
  for (const [kind, t] of Object.entries(TRAFFIC)) {
    r -= t.weight;
    if (r < 0) return kind;
  }
  return 'sculler';
}

// Knocked in (the hired launch rams a sculler or a kayaker: outing.js): the
// boat goes over and stops where it is, its rower or paddler swims beside it,
// then rights it, climbs back in and carries on, SWIM seconds later. Only the
// small boats: an eight's crew of nine stays upright.
export const SWIM = 10;
export const TIPPY = ['sculler', 'kayaker'];
export function knockIn(b, time) {
  if (!TIPPY.includes(b.kind) || b.swim !== undefined) return false;
  b.swim = time;
  return true;
}
// How far over a knocked-in boat is (0 upright, 1 upside down) and whether
// its crew is in the water.
export function overturned(b, time) {
  if (b.swim === undefined) return { over: 0, swimming: false };
  const t = time - b.swim;
  const over = Math.min(1, t / 0.6) * Math.min(1, (SWIM - t) / 1.2);
  return { over: Math.max(0, over), swimming: t > 0.3 && t < SWIM - 1.2 };
}

// Where everything is at race time `time`.
export function moveTraffic(traffic, time) {
  const { river, k } = traffic;
  for (const b of traffic.boats) {
    const T = TRAFFIC[b.kind];
    if (b.swim !== undefined) {
      if (time < b.swim + SWIM) continue; // still in, the boat where it went over
      // Back in: on from where it stopped, so its timetable is SWIM seconds later.
      b.at += SWIM;
      delete b.swim;
    }
    b.s = b.meet + b.dir * T.speed * k * (time - b.at);
    b.on = (b.behind || time > b.at - BEFORE) && time < b.at + AFTER && b.s > T.length && b.s < river.length - T.length;
    if (!b.on) continue;
    b.lateral = b.dir * lane(river, b.s, b.dir, T);
    const c = pointAt(river, b.s);
    b.x = c.x - c.tz * b.lateral;
    b.z = c.z + c.tx * b.lateral;
    b.heading = Math.atan2(c.tx * b.dir, -c.tz * b.dir);
  }
}

// How far from the middle a boat keeps, on its right: well over in its half
// of the open water, its oars or sides clear of the middle line; but on narrow
// water, clear of the bank (and anything moored) first.
export function lane(river, s, dir, T) {
  const w = widthAt(river, s);
  const open = dir > 0 ? w.right : w.left;
  const reach = Math.max(T.hull, T.oars?.[2] ?? 0);
  return Math.max(0, Math.min(Math.max(open * 0.6, reach + 0.5), open - reach - 0.5));
}

// The parts of a boat a kayak can hit, as stretches of its length (from the
// stern) and how far out from the middle they go.
function parts(T) {
  const hull = { from: 0, to: T.length, out: T.hull };
  return T.oars ? [hull, { from: T.oars[0] * T.length, to: T.oars[1] * T.length, out: T.oars[2] }] : [hull];
}

// A point (x, z) in a boat's frame: how far along from its stern, and across.
function frame(b, x, z) {
  const f = [Math.sin(b.heading), -Math.cos(b.heading)];
  const dx = x - b.x;
  const dz = z - b.z;
  return { along: dx * f[0] + dz * f[1] + TRAFFIC[b.kind].length / 2, across: dx * -f[1] + dz * f[0] };
}

// The racers who ran into a boat or its oars just now (those already in the
// water, or tipped in by that boat already, don't count again).
export function trafficHits(traffic, racers) {
  const hits = [];
  for (const r of racers) {
    if (r.remote || r.boat.swim > 0) continue;
    const f = [Math.sin(r.boat.heading), -Math.cos(r.boat.heading)];
    for (const b of traffic.boats) {
      if (!b.on || b.hit.includes(r) || (b.x - r.boat.x) ** 2 + (b.z - r.boat.z) ** 2 > 400) continue;
      const T = TRAFFIC[b.kind];
      const hit = [-KAYAK.stern, -0.9, 0.5, 1.9, KAYAK.bow].some((d) => {
        const p = frame(b, r.boat.x + f[0] * d, r.boat.z + f[1] * d);
        return parts(T).some((q) => p.along > q.from && p.along < q.to && Math.abs(p.across) < q.out + KAYAK.half);
      });
      if (hit) {
        b.hit.push(r);
        hits.push({ racer: r, boat: b });
        break;
      }
    }
  }
  return hits;
}

// How much the boats' wash rocks a boat at (x, z): on the two arms of the V of
// waves spreading back from a moving boat at about 20 degrees, fading behind
// it (as a kayak's own, race.js wash()).
export function trafficWash(traffic, boat) {
  let rock = 0;
  for (const b of traffic.boats) {
    if (!b.on) continue;
    const T = TRAFFIC[b.kind];
    const p = frame(b, boat.x, boat.z);
    const back = T.length - p.along; // metres back from its bow
    if (back < 0 || back > T.length + 45) continue;
    const arm = Math.exp(-((Math.abs(p.across) - T.hull - back * 0.36) ** 2) / 2);
    rock += T.wash * arm * (1 - back / (T.length + 45));
  }
  return Math.min(1, rock);
}

// An eight coming up behind `racer`, once, when its bow is WARN metres off:
// { boat, side } with the side ('left' | 'right') it's coming up on.
export function trafficWarnings(traffic, racer) {
  const out = [];
  const f = [Math.sin(racer.boat.heading), -Math.cos(racer.boat.heading)];
  for (const b of traffic.boats) {
    if (!b.on || !b.behind || b.warned || !sameWay(b, racer.boat)) continue;
    const dx = b.x - racer.boat.x;
    const dz = b.z - racer.boat.z;
    const ahead = dx * f[0] + dz * f[1];
    const bow = ahead + TRAFFIC[b.kind].length / 2; // its bow, ahead of our middle
    if (bow > -KAYAK.stern || bow < -KAYAK.stern - WARN * traffic.k) continue;
    const across = dx * -f[1] + dz * f[0];
    b.warned = true;
    out.push({ boat: b, side: across >= 0 ? 'right' : 'left' });
  }
  return out;
}

const sameWay = (b, boat) => Math.cos(b.heading - boat.heading) > 0.5;

// Boats a racer should keep clear of, as { s, lateral, out, pass } on the
// racer's own leg: those coming towards it up to LOOK seconds off, and an eight
// close behind. pass is the side to be on (1 right, -1 left), by the rule of
// the river: keep right, so an oncoming boat goes by on your left, and an
// eight from behind (keeping right too) on your right. (On an out-and-back
// course an eight from behind for one racer comes towards another.)
const LOOK = 12;
export function trafficNear(traffic, r, course) {
  const out = [];
  for (const b of traffic.boats) {
    if (!b.on) continue;
    const T = TRAFFIC[b.kind];
    const overtaking = sameWay(b, r.boat);
    const ahead = overtaking ? T.length : (PACE + T.speed) * LOOK * traffic.k;
    const d = Math.hypot(b.x - r.boat.x, b.z - r.boat.z);
    if (d > ahead + T.length) continue;
    // Found on the racer's own leg, as far ahead (or behind) as it is.
    const f = [Math.sin(r.boat.heading), -Math.cos(r.boat.heading)];
    const at = locate(course, b.x, b.z, r.loc.i + Math.round(((b.x - r.boat.x) * f[0] + (b.z - r.boat.z) * f[1]) / 2));
    const gap = at.s - r.loc.s;
    if (gap > -T.length / 2 - (overtaking ? 50 * traffic.k : 4) && gap < ahead) {
      out.push({ s: at.s, lateral: at.lateral, out: Math.max(T.hull, T.oars?.[2] ?? 0), pass: overtaking ? -1 : 1 });
    }
  }
  return out;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
