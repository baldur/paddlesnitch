// People fishing from the bank (a course file's `anglers`), each with a line
// from their rod out to a float. Paddle across a line and it snags you: the
// boat is pulled up short, once per line. The AI rivals steer round the lines
// like swans. Where the lines lie is fixed by the course (no randomness), so
// world.js draws them where the race has them and every player in a live race
// meets the same ones. Pure, tested (tests/kayak-anglers.test.js).
import { locate, pointAt, widthAt } from './course.js';

const BOW = 3.3; // hull ends, metres from a boat's origin (as race.js)
const STERN = 1.9;
export const SNAG = {
  hold: 0.25, // a snagged boat keeps this much of its speed
  touch: 0.35, // metres between hull and line that count as touching it
  tip: [2.4, 2.2], // the rod's tip: metres out over the water, and up
  float: 0.12, // the line's height where it meets the float
  head: 1.2, // the line catches you where it's lower than this; nearer the bank you pass under it
};

// Each angler: where they sit on the bank, their rod's tip out over the water,
// and the line from it down to the float (`low`: where it comes below head
// height), the float 7 to 11 m out (less than half way across a narrow river)
// and a couple of metres downstream (the river line runs upstream, so towards
// a smaller s).
export function createAnglers(course) {
  const river = course.scenery?.river ?? course;
  return (course.scenery?.anglers ?? []).map(({ s, side }) => {
    const c = pointAt(river, s);
    const w = widthAt(river, s);
    const edge = side < 0 ? w.left : w.right;
    const out = [-c.tz * side, c.tx * side]; // from the middle of the river towards this bank
    const reach = Math.min(7 + ((s * 7.31) % 4), 0.45 * (w.left + w.right)); // never most of the way across
    const at = (d, back = 0) => ({ x: c.x + out[0] * d - c.tx * back, z: c.z + out[1] * d - c.tz * back });
    const tip = at(edge - SNAG.tip[0]);
    const float = at(edge - reach, 2.5);
    const t = (SNAG.tip[1] - SNAG.head) / (SNAG.tip[1] - SNAG.float);
    const low = { x: tip.x + (float.x - tip.x) * t, z: tip.z + (float.z - tip.z) * t };
    return { s, side, seat: at(edge + 0.9), bank: at(edge), tip, low, float, out, snagged: new Set() };
  });
}

// The racers whose hull has just crossed a line (each line snags a boat once).
export function snagLines(anglers, racers) {
  const hits = [];
  for (const a of anglers) {
    for (const r of racers) {
      const b = r.boat;
      if (r.remote || b.swim > 0 || a.snagged.has(r)) continue;
      const f = [Math.sin(b.heading), -Math.cos(b.heading)];
      const bow = { x: b.x + f[0] * BOW, z: b.z + f[1] * BOW };
      const stern = { x: b.x - f[0] * STERN, z: b.z - f[1] * STERN };
      if (segmentGap(bow, stern, a.low, a.float) > SNAG.touch) continue;
      a.snagged.add(r);
      b.speed *= SNAG.hold;
      hits.push({ racer: r, angler: a });
    }
  }
  return hits;
}

// Lines near a racer's way ahead, as { s, lateral, half, pass } blocks (from
// the float to the bank) on the racer's own leg of the course, for the AI.
// `pass` is the side there's water to go round on (the float's: +1 to the
// right, -1 to the left), as race.js takes it for a boat.
export function linesAhead(anglers, r, course, reach) {
  const out = [];
  for (const a of anglers) {
    const d = Math.hypot(a.float.x - r.boat.x, a.float.z - r.boat.z);
    if (d > reach) continue;
    const hint = r.loc.i + Math.round(d / 2);
    const f = locate(course, a.float.x, a.float.z, hint);
    const b = locate(course, a.bank.x, a.bank.z, hint);
    if (f.s < r.loc.s - 2 || f.s - r.loc.s > reach) continue;
    const [lo, hi] = [Math.min(f.lateral, b.lateral) - 1.5, Math.max(f.lateral, b.lateral) + 1.5];
    out.push({ s: f.s, lateral: (lo + hi) / 2, half: (hi - lo) / 2, pass: f.lateral > b.lateral ? 1 : -1 });
  }
  return out;
}

// The shortest distance between two segments (they cross: 0).
export function segmentGap(p1, p2, q1, q2) {
  const cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const d1 = cross(q1, q2, p1);
  const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1);
  const d4 = cross(p1, p2, q2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(toSegment(p1, q1, q2), toSegment(p2, q1, q2), toSegment(q1, p1, p2), toSegment(q2, p1, p2));
}

function toSegment(p, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}
