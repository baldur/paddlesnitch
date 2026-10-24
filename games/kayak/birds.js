// Swans and ducks on the river. Swans are stubborn: they drift about and only
// shuffle out of the way when a boat is nearly on them, so you have to steer
// round them, and paddling into one capsizes you (then it swims off in a huff,
// so you can't hit it again climbing back in). Ducks paddle off as a boat
// comes, then take off. Pure, no DOM.
import { locate, pointAt, widthAt } from './course.js';

export const BIRDS = {
  swan: { r: 0.45, drift: 0.12, shuffle: 0.3, wary: 4 },
  duck: { r: 0.2, drift: 0.15, shuffle: 1, wary: 14, flee: 8 },
};
const BOW = 3.3; // hull ends, metres from a boat's origin (as race.js)
const STERN = 1.9;
const HULL = 0.25; // half a hull's width at the waterline

// A few birds anywhere on the course, and crowds where it says (`hotspots`:
// [{ s, count, spread }], from a course file's `birds`). `rand` is the race's.
export function createBirds(course, rand, hotspots = []) {
  const birds = [];
  const add = (kind, s, lateral) => {
    const c = pointAt(course, s);
    const loc = locate(course, c.x - c.tz * lateral, c.z + c.tx * lateral);
    birds.push({
      kind, x: c.x - c.tz * lateral, z: c.z + c.tx * lateral,
      heading: rand() * Math.PI * 2, speed: 0, phase: rand() * 10,
      loc, fly: 0, gone: false, huff: 0,
    });
  };
  const spot = (s) => (rand() - 0.5) * 2 * Math.max(0, widthAt(course, s).half - 2.5);
  for (let s = course.start + 150 + rand() * 300; s < course.finish - 60; s += 500 + rand() * 700) {
    if (rand() < 0.5) {
      const lateral = spot(s);
      for (let k = rand() < 0.6 ? 2 : 1; k > 0; k--) add('swan', s + (rand() - 0.5) * 8, lateral + (rand() - 0.5) * 3);
    } else {
      const lateral = spot(s);
      for (let k = 2 + Math.floor(rand() * 4); k > 0; k--) add('duck', s + (rand() - 0.5) * 10, lateral + (rand() - 0.5) * 4);
    }
  }
  for (const h of hotspots) {
    for (let k = 0; k < h.count; k++) {
      const s = Math.max(course.start + 30, Math.min(course.finish - 30, h.s + (rand() - 0.5) * 2 * h.spread));
      add(rand() < 0.75 ? 'swan' : 'duck', s, spot(s));
    }
  }
  return birds;
}

// Moves the birds on, away from the boats. Returns the racers that paddled
// into a swan this step.
export function stepBirds(birds, racers, course, dt) {
  const k = course.speedup ?? 1;
  const hits = [];
  for (const b of birds) {
    if (b.gone) continue;
    const B = BIRDS[b.kind];
    b.phase += dt;
    if (b.fly > 0) {
      // In the air: up and away, then out of the race.
      b.fly += dt;
      b.speed = Math.min(B.flee * k, b.speed + 6 * k * dt);
      move(b, dt);
      if (b.fly > 4) b.gone = true;
      continue;
    }
    // The nearest boat that's coming this way.
    let threat = null;
    for (const r of racers) {
      if (r.boat.swim > 0) continue;
      const dx = b.x - r.boat.x;
      const dz = b.z - r.boat.z;
      const d = Math.hypot(dx, dz);
      const f = [Math.sin(r.boat.heading), -Math.cos(r.boat.heading)];
      const ahead = dx * f[0] + dz * f[1];
      if (d < B.wary * (b.kind === 'duck' ? k : 1) && ahead > -STERN && (!threat || d < threat.d)) threat = { r, d, f, dx, dz };
    }
    let want = b.heading + Math.sin(b.phase * 0.3) * 0.4 * dt;
    let speed = B.drift;
    b.huff = Math.max(0, (b.huff ?? 0) - dt);
    if (b.huff > 0) speed = 0.8;
    else if (threat) {
      // Away to the side of the boat's path it's already on.
      const across = threat.dx * -threat.f[1] + threat.dz * threat.f[0];
      const side = across >= 0 ? 1 : -1;
      want = heading(-threat.f[1] * side + threat.f[0] * 0.3, threat.f[0] * side + threat.f[1] * 0.3);
      speed = B.shuffle * (b.kind === 'duck' ? k : 1);
      if (b.kind === 'duck' && threat.d < (B.wary / 2) * k) b.fly = dt;
    }
    // Stay on the water: turn back towards the middle near a bank.
    b.loc = locate(course, b.x, b.z, b.loc.i);
    const w = widthAt(course, b.loc.s);
    const side = Math.sign(b.loc.lateral);
    if (Math.abs(b.loc.lateral) > w.half - 1.5) want = heading(b.loc.tz * side, -b.loc.tx * side);
    b.heading += wrap(want - b.heading) * Math.min(1, 3 * dt);
    b.speed += (speed - b.speed) * Math.min(1, 2 * dt);
    move(b, dt);

    if (b.kind !== 'swan' || b.huff > 0) continue;
    for (const r of racers) {
      if (r.boat.swim > 0 || r.boat.speed < 1 || (b.x - r.boat.x) ** 2 + (b.z - r.boat.z) ** 2 > 36) continue;
      if (distanceToHull(r.boat, b) < BIRDS.swan.r + HULL) {
        hits.push(r);
        b.huff = 4;
        b.heading = heading(b.x - r.boat.x, b.z - r.boat.z);
        break;
      }
    }
  }
  return hits;
}

// Swans near a racer's line ahead, as { s, lateral } on the racer's own leg of
// the course, for the AI to steer round.
export function swansAhead(birds, r, course, reach) {
  const out = [];
  for (const b of birds) {
    const d = Math.hypot(b.x - r.boat.x, b.z - r.boat.z);
    if (b.gone || b.kind !== 'swan' || d > reach) continue;
    // Located on the racer's own leg, about as far along as the bird is away.
    const at = locate(course, b.x, b.z, r.loc.i + Math.round(d / 2));
    if (at.s > r.loc.s - 2 && at.s - r.loc.s < reach) out.push({ s: at.s, lateral: at.lateral });
  }
  return out;
}

function move(b, dt) {
  b.x += Math.sin(b.heading) * b.speed * dt;
  b.z -= Math.cos(b.heading) * b.speed * dt;
}

function distanceToHull(boat, p) {
  const f = [Math.sin(boat.heading), -Math.cos(boat.heading)];
  const a = [boat.x - f[0] * STERN, boat.z - f[1] * STERN];
  const len = BOW + STERN;
  const t = Math.max(0, Math.min(len, (p.x - a[0]) * f[0] + (p.z - a[1]) * f[1]));
  return Math.hypot(p.x - (a[0] + f[0] * t), p.z - (a[1] + f[1] * t));
}

// The heading (0 up -z, clockwise) of a direction x, z.
function heading(x, z) {
  return Math.atan2(x, -z);
}

function wrap(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
