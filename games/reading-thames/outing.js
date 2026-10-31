// Outings from Caversham Pier (prototype, picked on the walk's bridge, club.js):
// a river cruise, standing at the bow of a trip boat as it goes up the Thames
// to Mapledurham (as Thames Rivercruise's boats do from the pier), and a hired
// electric launch you drive yourself anywhere on the water. The river is as in
// a race (race.js): swans, ducks and the other boats, places named as you pass.
// An outing is a race with no rivals whose one boat moves by these rules
// instead of paddling. Pure: no DOM.
import { pointAt, locate, widthAt } from './course.js';
import { createTraffic, moveTraffic, trafficHits, knockIn } from './traffic.js';
import { stepBirds } from './birds.js';
import { bounceOffShore, wrap } from './sim.js';
import { MeshBuilder } from './meshes.js';

// The boat under you and where you stand on it: eye height above the water,
// and how far forward of the boat's middle (the cruise's bow, the launch's helm).
export const OUTINGS = {
  cruise: { label: 'River cruise', line: 'Up the Thames to Mapledurham', eye: 2.9, forward: 4.6 },
  hire: { label: 'Hire a boat', line: 'An electric launch to drive yourself', eye: 1.35, forward: -1.4 },
};
// Speeds are real (m/s) and, like a race, go `speedup` times as fast through
// the true-size world: the Thames's 8 km/h limit is about 2.2 m/s.
export const CRUISE = { speed: 2.2, keepRight: 0.3, ahead: 30, look: 1.4, lookRate: 1.8 };
// Outings see more of the river's life than a race (owner, 2026-10-31): the
// cruise meets a boat every `gap` seconds on average along its way; the launch,
// which goes anywhere, has boats up and down the whole river, a new one about
// every `ambient` seconds (some 20 on the water at once).
export const BUSY = { gap: 35, ambient: 5, hours: 2 };
// The boats for hire at the pier (owner, 2026-10-31: a choice of three):
// a speedboat, very quick and nimble; the electric launch; a narrowboat, long
// and slow. Each: top speed and astern (m/s, real), how quickly it gets there
// and stops, how hard it turns, the bump off a bank, and where you stand
// (eye height, how far forward of the middle) and its size for knocks
// (`shape`: metres to the bow and the stern, half its width).
// knock: the speed (m/s) a sculler or kayaker rammed at least this hard goes in.
export const HIRE_BOATS = {
  speedboat: { label: 'Speedboat', line: 'Very quick and nimble', top: 50 / 3.6, astern: 2, accel: 3, brake: 4, turn: 0.95, bump: 0.5, knock: 0.5, eye: 1.55, forward: -0.9, shape: { bow: 2.8, stern: 2.6, half: 1.05 } },
  launch: { label: 'Electric launch', line: 'Steady, with cushions and a wheel', top: 20 / 3.6, astern: 1.2, accel: 0.8, brake: 1.2, turn: 0.42, bump: 0.3, knock: 0.5, eye: 1.35, forward: -1.4, shape: { bow: 3.25, stern: 3.1, half: 1.1 } },
  narrowboat: { label: 'Narrowboat', line: 'Long and slow: steer from the back', top: 7 / 3.6, astern: 0.8, accel: 0.25, brake: 0.4, turn: 0.17, bump: 0.15, knock: 0.5, eye: 2.25, forward: -8.2, shape: { bow: 9, stern: 9, half: 1.05 } },
};
export const HIRE = HIRE_BOATS.launch; // (what the tests and the HUD knew as the launch)
// Ram a pack of kayakers or an eight and the boat sinks under you: SINK seconds, then back to the pier.
export const SINK = 4;
// The hired-boat outing sees more rowers and kayakers (owner, 2026-10-31), kayakers often in packs.
export const HIRE_MIX = { sculler: 0.45, kayaker: 0.3, pack: 0.35, eight: 0.3, cruiser: 0.15, motorboat: 0.2 };

// Puts the race's one boat at the pier (`s` along the river line, upstream of
// Caversham Bridge) on the right of the river going up, and starts the outing,
// with its own, busier river traffic from `seed`.
export function startOuting(race, kind, s, seed = 1, { boat = 'launch' } = {}) {
  const river = race.course.scenery?.river ?? race.course;
  const k = race.course.speedup ?? 1;
  race.traffic = kind === 'cruise'
    ? createTraffic(race.course, seed, { gap: BUSY.gap, route: { at: (t) => pointAt(river, Math.min(river.length, s + CRUISE.speed * k * t)), seconds: (river.length - s) / (CRUISE.speed * k) } })
    : createTraffic(race.course, seed, { gap: BUSY.ambient * 0.8, ambient: BUSY.hours * 3600, mix: HIRE_MIX });
  const o = { kind, river, s, look: 0, done: false, lat: rightOf(river, s, race.course.shore), boat: HIRE_BOATS[boat] ? boat : 'launch', sinking: null };
  race.outing = o;
  const b = race.player.boat;
  const at = keepRight(river, s, race.course.shore);
  const ahead = keepRight(river, s + CRUISE.ahead, race.course.shore);
  Object.assign(b, { x: at[0], z: at[1], heading: Math.atan2(ahead[0] - at[0], -(ahead[1] - at[1])), speed: kind === 'cruise' ? CRUISE.speed : 0, roll: 0, rollRate: 0, yawRate: 0, swim: 0 });
  if (kind === 'hire') b.shape = HIRE_BOATS[o.boat].shape;
  race.player.loc = locate(race.course, b.x, b.z);
  return o;
}

// A point on the right of the river going upstream (lateral is positive to the
// right), only as far right as the mapped water goes (round islands and bends
// the river line's width can take in land, and an islet near 2.7 km sits on the line).
function rightOf(river, s, shore) {
  const half = widthAt(river, s).half;
  // Right of the line if there's water there; else nearer it, or past an islet on the line, left of it.
  for (const k of [1, 0.75, 0.5, 0.25, 0, -0.5, -1, -1.5, -2]) {
    const d = half * CRUISE.keepRight * k;
    const [x, z] = across(river, s, d);
    if (!shore?.dry(x, z)) return d;
  }
  return 0;
}
// The point `d` metres right of the river line, `s` along it.
function across(river, s, d) {
  const c = pointAt(river, Math.min(s, river.length));
  return [c.x - c.tz * d, c.z + c.tx * d];
}
function keepRight(river, s, shore) {
  return across(river, s, rightOf(river, s, shore));
}

// One step of an outing. `input`: `turn` -1 (left) to 1 (right) and `throttle`
// -1 (astern) to 1 (ahead). On the cruise, turn looks about. Returns events:
// 'end' (the cruise reached Mapledurham), 'bump' (the launch hit a boat or the
// bank), 'tipped-sculler' or 'tipped-kayaker' (and knocked them in),
// 'sinking-pack' or 'sinking-eight' (rammed one: the boat's going down), 'sunk'
// (SINK seconds later), 'swan' (a swan wouldn't move).
export function stepOuting(race, dt, input = {}) {
  const o = race.outing;
  const me = race.player;
  const b = me.boat;
  const k = race.course.speedup ?? 1;
  const events = [];
  race.time += dt;
  b.time += dt;
  if (race.traffic) moveTraffic(race.traffic, race.time);
  const turn = Math.max(-1, Math.min(1, input.turn ?? 0));
  if (o.kind === 'cruise') {
    // Along the right of the river, the bow eased towards a point ahead.
    const end = o.river.length - 40;
    if (!o.done) o.s = Math.min(end, o.s + CRUISE.speed * k * dt);
    if (o.s >= end && !o.done) {
      o.done = true;
      events.push('end');
    }
    b.speed = o.done ? 0 : CRUISE.speed;
    // Eased across, so the boat doesn't hop where the water narrows (3 m a second through the world).
    // Moving over in good time: the narrowest of the next 30 m.
    const lat = Math.min(...[0, 10, 20, 30].map((d) => rightOf(o.river, o.s + d, race.course.shore)));
    o.lat += Math.max(-3 * dt, Math.min(3 * dt, lat - o.lat));
    const [x, z] = across(o.river, o.s, o.lat);
    const ahead = keepRight(o.river, o.s + CRUISE.ahead, race.course.shore);
    b.x = x;
    b.z = z;
    const want = Math.atan2(ahead[0] - x, -(ahead[1] - z));
    b.heading += wrap(want - b.heading) * Math.min(1, dt * 2);
    // Looking about: the arrows turn your head, and it comes back when let go.
    const target = turn * CRUISE.look;
    o.look += Math.max(-CRUISE.lookRate * dt, Math.min(CRUISE.lookRate * dt, target - o.look));
    stepBirds(race.birds, [me], race.course, dt);
  } else if (o.sinking !== null) {
    // Going down: the boat slows to a stop as it settles; then it's gone.
    b.speed *= Math.exp(-2 * dt);
    b.x += Math.sin(b.heading) * b.speed * k * dt;
    b.z -= Math.cos(b.heading) * b.speed * k * dt;
    if (!o.done && race.time - o.sinking >= SINK) {
      o.done = true;
      events.push('sunk');
    }
  } else {
    // The hired boat: throttle ahead or astern, steer by the arrows (only while moving).
    const H = HIRE_BOATS[o.boat];
    const throttle = Math.max(-1, Math.min(1, input.throttle ?? 0));
    const want = throttle >= 0 ? throttle * H.top : throttle * H.astern;
    const rate = Math.sign(want - b.speed) !== Math.sign(b.speed) && b.speed ? H.brake : H.accel;
    b.speed += Math.max(-rate * dt, Math.min(rate * dt, want - b.speed));
    b.heading += turn * H.turn * Math.min(1, Math.abs(b.speed) / 0.8) * Math.sign(b.speed || 1) * dt;
    b.x += Math.sin(b.heading) * b.speed * k * dt;
    b.z -= Math.cos(b.heading) * b.speed * k * dt;
    if (race.course.shore && bounceOffShore(b, race.course.shore, dt)) events.push('bump');
    if (race.traffic) {
      for (const hit of trafficHits(race.traffic, [me])) {
        // A pack of kayakers or an eight: they hold, and your boat is holed and sinks.
        if (hit.boat.pack || hit.boat.kind === 'eight') {
          o.sinking = race.time;
          b.speed *= 0.3;
          events.push('bump', hit.boat.pack ? 'sinking-pack' : 'sinking-eight');
          break;
        }
        // A sculler or a kayaker on their own goes in; anything bigger, you bounce off.
        if (Math.abs(b.speed) > H.knock && knockIn(hit.boat, race.time)) events.push(`tipped-${hit.boat.kind}`);
        b.speed = -H.bump;
        events.push('bump');
      }
      // Clear of a boat you bumped, it's solid again (a race's boats tip you in once only).
      for (const t of race.traffic.boats) if (t.hit.length && Math.hypot(t.x - b.x, t.z - b.z) > 10) t.hit.length = 0;
    }
    // Swans won't get out of your way: you stop.
    for (const _ of stepBirds(race.birds, [me], race.course, dt)) {
      b.speed = 0;
      events.push('swan');
    }
  }
  b.swim = 0;
  me.loc = locate(race.course, b.x, b.z, me.loc?.i);
  return events;
}

// --- the boats ------------------------------------------------------------------
// In boat space like the kayak (x right, y up from the water, -z forward), the
// middle of the boat at the origin.

// A hull from a deck outline (points going round, [x, z]): sides from the deck
// down to the waterline, drawn in, with a coloured band along them.
function hull(m, outline, deck, band, colors) {
  const n = outline.length;
  const at = (i, y, k) => [outline[i % n][0] * k, y, outline[i % n][1] * (k < 1 ? 0.97 : 1)];
  for (let i = 0; i < n; i++) {
    const [x0, z0] = outline[i];
    const [x1, z1] = outline[(i + 1) % n];
    const out = [(z1 - z0), 0, -(x1 - x0)];
    // Waterline to band, the band, band to deck: each strip [bottom, top, colour, how far in at the bottom].
    const strips = [[-0.3, band[0], colors.hull, 0.88], [band[0], band[1], colors.band, 1], [band[1], deck, colors.hull, 1]];
    for (const [y0, y1, c, k] of strips) {
      const a = at(i, y0, k), b = at(i + 1, y0, k), cc = at(i + 1, y1, 1), d = at(i, y1, 1);
      m.triFacing(a, b, cc, c, out);
      m.triFacing(a, cc, d, c, out);
    }
  }
  // A whole deck (a fan from the middle), or for an open boat just a rim round the edge.
  const mid = [0, deck, outline.reduce((a, p) => a + p[1], 0) / n];
  for (let i = 0; i < n; i++) {
    const [p, q] = [outline[i], outline[(i + 1) % n]];
    if (!colors.rim) m.tri(mid, [p[0], deck, p[1]], [q[0], deck, q[1]], colors.deck);
    else {
      const inner = (pt) => [mid[0] + (pt[0] - mid[0]) * 0.88, deck, mid[2] + (pt[1] - mid[2]) * 0.96];
      m.quad([p[0], deck, p[1]], [q[0], deck, q[1]], inner(q), inner(p), colors.rim);
    }
  }
}

// A rail along a run of outline points, `h` above the deck: posts and a top rail.
function rail(m, points, deck, h, color) {
  for (let i = 0; i < points.length; i++) {
    const [x, z] = points[i];
    m.box([x - 0.03, deck, z - 0.03], [x + 0.03, deck + h, z + 0.03], color);
    if (i) {
      const [px, pz] = points[i - 1];
      m.quad([px, deck + h, pz], [x, deck + h, z], [x, deck + h + 0.05, z], [px, deck + h + 0.05, pz], color);
      m.quad([px, deck + h * 0.5, pz], [x, deck + h * 0.5, z], [x, deck + h * 0.5 + 0.03, z], [px, deck + h * 0.5 + 0.03, pz], color);
    }
  }
}

const WHITE = [0.94, 0.94, 0.92];
// The trip boat: about 21 m by 4.6 m, a white hull with a blue band, a long
// glazed saloon, and the open foredeck with its rail where you stand.
export function tripBoatMesh() {
  const m = new MeshBuilder();
  const deck = 1.15;
  const outline = [[-2.3, 10.5], [2.3, 10.5], [2.3, -5], [1.9, -8], [1.1, -9.8], [0, -10.6], [-1.1, -9.8], [-1.9, -8], [-2.3, -5]];
  hull(m, outline, deck, [0.55, 0.85], { hull: WHITE, band: [0.1, 0.22, 0.5], deck: [0.55, 0.42, 0.3] });
  rail(m, [[2.2, -4.2], [2.2, -5], [1.85, -7.8], [1.05, -9.6], [0, -10.4], [-1.05, -9.6], [-1.85, -7.8], [-2.2, -5], [-2.2, -4.2]], deck, 1.0, WHITE);
  // The saloon: walls, a band of windows, a roof with a rail round it.
  m.box([-2.1, deck, -4], [2.1, deck + 0.8, 9.8], WHITE);
  m.box([-2.12, deck + 0.8, -4], [2.12, deck + 1.9, 9.8], [0.2, 0.28, 0.34]);
  for (let z = -3.6; z < 9.8; z += 1.6) m.box([-2.14, deck + 0.8, z], [2.14, deck + 1.9, z + 0.12], WHITE);
  m.box([-2.25, deck + 1.9, -4.2], [2.25, deck + 2.1, 10], WHITE);
  // A wheelhouse on the roof, a lifebuoy on the bow rail and the club pennant.
  m.box([-1, deck + 2.1, -3.8], [1, deck + 3.1, -1.8], WHITE);
  m.box([-1.02, deck + 2.5, -3.82], [1.02, deck + 2.95, -1.78], [0.2, 0.28, 0.34]);
  m.box([2.17, deck + 0.45, -4.6], [2.22, deck + 0.85, -4.25], [0.95, 0.4, 0.1]);
  m.cylinder([0, deck, -10.2], 0.025, 1.6, 4, WHITE);
  m.box([0, deck + 1.3, -10.2], [0.02, deck + 1.6, -9.75], [0.85, 0.12, 0.12]);
  return m.build();
}

// The hired launch: an electric day boat about 6.4 m long, cream with a
// varnished gunwale, blue cushions round the sides, a canopy over the back and
// the wheel at the helm (where you sit).
export function launchMesh() {
  const m = new MeshBuilder();
  const deck = 0.55;
  const outline = [[-1.05, 3.1], [1.05, 3.1], [1.1, 1], [1, -1], [0.7, -2.4], [0, -3.25], [-0.7, -2.4], [-1, -1], [-1.1, 1]];
  hull(m, outline, deck, [0.38, 0.5], { hull: [0.93, 0.89, 0.78], band: [0.45, 0.28, 0.14], rim: [0.55, 0.34, 0.17] });
  // The well you sit in: a floor below the gunwale, cushions round it.
  m.box([-0.9, 0.2, -1.6], [0.9, 0.25, 2.9], [0.7, 0.56, 0.38]);
  m.box([-0.95, 0.25, -1.4], [-0.6, 0.5, 2.8], [0.16, 0.3, 0.6]);
  m.box([0.6, 0.25, -1.4], [0.95, 0.5, 2.8], [0.16, 0.3, 0.6]);
  m.box([-0.9, 0.25, 2.5], [0.9, 0.5, 2.9], [0.16, 0.3, 0.6]);
  // The foredeck, and the gunwale's varnished top.
  m.prism([[-0.95, deck, -1.6], [0.95, deck, -1.6], [0.5, deck, -2.7], [-0.5, deck, -2.7]], [[-0.93, deck + 0.05, -1.6], [0.93, deck + 0.05, -1.6], [0, deck + 0.08, -3.2], [0, deck + 0.08, -3.2]], [0.6, 0.38, 0.2]);
  // Open to the sky: no canopy (seen from the helm on a phone its cover was a
  // dark slab across the top of the screen; owner 2026-10-31).
  // The wheel, on its console in front of the helm on the right: rim, spokes and hub.
  m.box([0.25, 0.25, 0.75], [0.75, 0.8, 1.05], [0.4, 0.28, 0.18]);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const b = ((i + 1) / 8) * Math.PI * 2;
    const p = (t) => [0.5 + Math.cos(t) * 0.16, 0.95 + Math.sin(t) * 0.16, 0.9 - Math.sin(t) * 0.05];
    m.quad(p(a), p(b), p(b).map((v, k) => (k === 2 ? v + 0.03 : v)), p(a).map((v, k) => (k === 2 ? v + 0.03 : v)), [0.1, 0.1, 0.1]);
  }
  for (let i = 0; i < 3; i++) {
    const t = (i / 3) * Math.PI * 2 + 0.5;
    const [cx, cy] = [0.5 + Math.cos(t) * 0.15, 0.95 + Math.sin(t) * 0.15];
    m.box([Math.min(0.5, cx) - 0.008, Math.min(0.95, cy) - 0.008, 0.9], [Math.max(0.5, cx) + 0.008, Math.max(0.95, cy) + 0.008, 0.915], [0.15, 0.15, 0.16]);
  }
  m.box([0.47, 0.92, 0.88], [0.53, 0.98, 0.93], [0.7, 0.7, 0.72]); // the hub
  return m.build();
}

// A speedboat: short, sharp at the bow, a white hull with a red band, a raked
// windscreen, the driver's seat and a wheel on the dash.
export function speedboatMesh() {
  const m = new MeshBuilder();
  const deck = 0.6;
  const outline = [[-1, 2.6], [1, 2.6], [1.05, 0.8], [0.85, -1.2], [0.4, -2.4], [0, -2.85], [-0.4, -2.4], [-0.85, -1.2], [-1.05, 0.8]];
  hull(m, outline, deck, [0.32, 0.45], { hull: [0.96, 0.96, 0.94], band: [0.8, 0.12, 0.1], rim: [0.25, 0.25, 0.28] });
  m.box([-0.95, 0.25, -1.1], [0.95, 0.3, 2.5], [0.85, 0.82, 0.76]); // the floor
  // The foredeck, white, rising a little to the bow.
  m.prism([[-0.85, deck, -1.2], [0.85, deck, -1.2], [0.4, deck, -2.4], [-0.4, deck, -2.4]], [[-0.84, deck + 0.06, -1.2], [0.84, deck + 0.06, -1.2], [0, deck + 0.12, -2.8], [0, deck + 0.12, -2.8]], [0.97, 0.97, 0.95]);
  // The windscreen: a raked pane across the boat, tinted.
  m.prism([[-0.85, deck, -1.15], [0.85, deck, -1.15], [0.85, deck, -1.05], [-0.85, deck, -1.05]], [[-0.8, deck + 0.38, -0.9], [0.8, deck + 0.38, -0.9], [0.8, deck + 0.38, -0.82], [-0.8, deck + 0.38, -0.82]], [0.45, 0.6, 0.68]);
  // Seats: the driver's on the right, a bench behind.
  m.box([0.15, 0.3, -0.2], [0.85, 0.65, 0.4], [0.9, 0.9, 0.88]);
  m.box([-0.9, 0.3, 1.6], [0.9, 0.62, 2.4], [0.9, 0.9, 0.88]);
  // The dash and the wheel in front of the driver.
  m.box([0.1, 0.3, -1.0], [0.9, 0.62, -0.8], [0.2, 0.2, 0.22]);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const b = ((i + 1) / 10) * Math.PI * 2;
    const p = (t) => [0.5 + Math.cos(t) * 0.13, 0.76 + Math.sin(t) * 0.13, -0.72 - Math.sin(t) * 0.05];
    m.quad(p(a), p(b), p(b).map((v, k) => (k === 2 ? v + 0.03 : v)), p(a).map((v, k) => (k === 2 ? v + 0.03 : v)), [0.08, 0.08, 0.08]);
  }
  m.box([0.47, 0.73, -0.74], [0.53, 0.79, -0.69], [0.7, 0.7, 0.72]); // the hub
  return m.build();
}

// A narrowboat for hire: 18 m, a long cabin with windows, the roof at chest
// height for you on the stern deck, steering with the tiller (and the bow far
// ahead over the roof).
export function narrowboatMesh() {
  const m = new MeshBuilder();
  const deck = 0.55;
  const half = 1.05;
  const outline = [[-half, 9], [half, 9], [half, -6.5], [0.7, -8.2], [0, -9], [-0.7, -8.2], [-half, -6.5]];
  hull(m, outline, deck, [0.25, 0.4], { hull: [0.08, 0.08, 0.09], band: [0.75, 0.6, 0.15], deck: [0.35, 0.18, 0.15] });
  // The cabin: green sides, a red roof, windows along each side, from behind the bow to the stern deck.
  const green = [0.1, 0.32, 0.2];
  m.box([-0.95, deck, -6.2], [0.95, 1.75, 7.3], green);
  // The roof as you see it from the tiller: grey, its wooden slide hatch by
  // you, the vents and the stove's chimney, a pot plant, a pole along it.
  m.box([-1, 1.75, -6.3], [1, 1.82, 7.4], [0.36, 0.37, 0.38]);
  m.box([-0.45, 1.82, 5.6], [0.45, 1.95, 7.3], [0.55, 0.36, 0.2]);
  for (const z of [-3.5, 0.5, 3.5]) m.cylinder([0, 1.82, z], 0.12, 0.1, 6, [0.75, 0.62, 0.25]);
  m.cylinder([0.55, 1.82, -1.6], 0.07, 0.55, 6, [0.12, 0.12, 0.12]);
  m.box([-0.7, 1.82, 2], [-0.4, 2.02, 2.3], [0.6, 0.3, 0.2]);
  m.sphere([-0.55, 2.12, 2.15], 0.18, [0.25, 0.5, 0.22], 3, 6);
  m.box([0.75, 1.84, -5.8], [0.8, 1.88, 6.8], [0.6, 0.5, 0.35]);
  for (let z = -5.5; z < 7; z += 1.6) for (const x of [-0.955, 0.955]) m.box([x - 0.01, 1.05, z], [x + 0.01, 1.45, z + 0.8], [0.6, 0.72, 0.78]);
  // The stern deck where you stand, its rail, and the tiller.
  m.box([-0.9, 0.5, 7.3], [0.9, 0.55, 8.9], [0.3, 0.2, 0.12]);
  m.box([-0.04, 1.0, 8.5], [0.04, 1.06, 9.6], [0.75, 0.6, 0.2]); // the tiller arm
  m.box([-0.06, 0.55, 8.85], [0.06, 1.05, 8.95], [0.2, 0.2, 0.2]);
  // Fenders at the bow.
  m.box([-0.15, 0.2, -9.05], [0.15, 0.45, -8.85], [0.25, 0.2, 0.15]);
  return m.build();
}
