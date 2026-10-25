// River courses: a smooth centreline through control points, densely sampled
// with the distance along it, so any position can be turned into "how far
// along" and "how far off the middle". Width varies along the way, and
// narrowboats moored against a bank take up some of it. Pure, no DOM.

import { waterMap, shoreOf } from './water.js';

const SPACING = 2; // metres between samples

const NARROWBOAT = 2.1; // beam of a moored narrowboat, metres

// points: [[x, z], ...] in paddling order. start/finish are distances along the river.
// width: metres from bank to bank, or a function of the distance along.
// moorings: [{ s, length, side, beam? }]: a boat moored against the left (-1) or
// right (1) bank, centred `s` metres along (a narrowboat unless `beam` says
// otherwise). bridges: distances along, or { s, style, ... } for a real one.
// warp: race distances and times are shown this many times longer than they
// really are, so a 6 km marathon fits in a few minutes of play (see README).
// speedup: boats move this many times their speed through the world, for a real
// river drawn at its true size (warp then shows its true distances).
// sides: instead of `width`, the open water left and right of the line at a
// distance along ({ left, right }), for a racing line that keeps to one side.
export function createCourse(points, { width = 20, sides = null, start = 60, finish = 1060, warp = 1, speedup = 1, moorings = [], bridges = [] } = {}) {
  const raw = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];
    const n = Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / (SPACING / 4));
    for (let k = 0; k < n; k++) raw.push(catmullRom(p0, p1, p2, p3, k / n));
  }
  raw.push(points.at(-1));

  // Resample to even spacing so distances and lookups are simple.
  const samples = [{ x: raw[0][0], z: raw[0][1], s: 0 }];
  let carried = 0;
  for (let i = 1; i < raw.length; i++) {
    const [ax, az] = raw[i - 1];
    const [bx, bz] = raw[i];
    const len = Math.hypot(bx - ax, bz - az);
    let t = SPACING - carried;
    while (t <= len) {
      const f = t / len;
      samples.push({ x: ax + (bx - ax) * f, z: az + (bz - az) * f, s: samples.length * SPACING });
      t += SPACING;
    }
    carried = len - (t - SPACING);
  }
  samples.forEach((p, i) => {
    const a = samples[Math.max(i - 1, 0)];
    const b = samples[Math.min(i + 1, samples.length - 1)];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    p.tx = (b.x - a.x) / len;
    p.tz = (b.z - a.z) / len;
    // half: centreline to bank. left/right: centreline to the open water's edge.
    if (sides) {
      Object.assign(p, sides(p.s));
      p.half = (p.left + p.right) / 2;
    } else {
      p.half = (typeof width === 'function' ? width(p.s) : width) / 2;
      p.left = p.half;
      p.right = p.half;
    }
    for (const m of moorings) {
      if (Math.abs(p.s - m.s) < m.length / 2 + 1) p[m.side < 0 ? 'left' : 'right'] = p.half - (m.beam ?? NARROWBOAT);
    }
  });
  withinReach(samples);

  return { samples, start, finish, warp, speedup, moorings, bridges, length: (samples.length - 1) * SPACING };
}

// On a bend tighter than the water is wide, a boat out on the inside is nearer
// another part of the line than its own, so where it is along the course would
// jump ahead (and the banks it's kept between with it). Brings the open water in
// on the inside of such bends until every point of it is nearest its own part of
// the line.
const MIN_REACH = 3; // metres of water kept each side of the line, however tight the bend

function withinReach(samples) {
  const course = { samples };
  const own = (i, lateral) => {
    const p = samples[i];
    return Math.abs(locate(course, p.x - p.tz * lateral, p.z + p.tx * lateral, i).i - i) <= 1;
  };
  const brought = { left: new Map(), right: new Map() }; // sample index -> the reach it was brought in to
  for (let i = 1; i < samples.length - 1; i++) {
    for (const [side, sign] of [['left', -1], ['right', 1]]) {
      const p = samples[i];
      if (own(i, sign * p[side])) continue;
      let [lo, hi] = [0, p[side]];
      while (hi - lo > 0.25) {
        const mid = (lo + hi) / 2;
        if (own(i, sign * mid)) lo = mid;
        else hi = mid;
      }
      p[side] = Math.max(MIN_REACH, lo);
      brought[side].set(i, p[side]);
    }
  }
  // Between samples the line turns on, so each limit holds for its neighbours too.
  for (const side of ['left', 'right']) {
    for (const [i, reach] of brought[side]) {
      for (let k = Math.max(0, i - NEIGHBOURS); k <= Math.min(samples.length - 1, i + NEIGHBOURS); k++) samples[k][side] = Math.min(samples[k][side], reach);
    }
  }
}
const NEIGHBOURS = 3;

// The open water at a distance along: { half, left, right } in metres from the centreline.
export function widthAt(course, s) {
  const { samples } = course;
  return samples[Math.max(0, Math.min(samples.length - 1, Math.round(s / SPACING)))];
}

// Where the water's tree reflections are taken from: the river line at `s`,
// its direction and how wide the open water is, eased from the last frame's
// (`prev`, `dt` seconds ago), since at an island's end the width jumps by tens
// of metres in a few and the reflections all over the water jumped with it.
// Starts afresh on another course or a jump along it (a restart).
export function riverView(course, s, prev = null, dt = 0) {
  const p = pointAt(course, s);
  const { half } = widthAt(course, s);
  if (!prev || prev.course !== course || Math.abs(prev.s - s) > 20) return { course, s, x: p.x, z: p.z, tx: p.tx, tz: p.tz, half };
  const k = 1 - Math.exp(-dt / 0.8);
  const tx = prev.tx + (p.tx - prev.tx) * k;
  const tz = prev.tz + (p.tz - prev.tz) * k;
  const n = Math.hypot(tx, tz) || 1;
  return { course, s, x: p.x, z: p.z, tx: tx / n, tz: tz / n, half: prev.half + (half - prev.half) * k };
}

// The narrowest the open water gets on each side over the next `ahead` metres.
export function roomAhead(course, s, ahead) {
  let left = Infinity;
  let right = Infinity;
  for (let d = 0; d <= ahead; d += SPACING) {
    const w = widthAt(course, s + d);
    left = Math.min(left, w.left);
    right = Math.min(right, w.right);
  }
  return { left, right };
}

// Nearest point on the centreline. `hint` (a previous result's index) limits the
// search to nearby samples, which is all a moving boat needs.
export function locate(course, x, z, hint = -1) {
  const { samples } = course;
  hint = Math.min(hint, samples.length - 2);
  const from = hint < 0 ? 0 : Math.max(0, hint - 25);
  const to = hint < 0 ? samples.length - 1 : Math.min(samples.length - 1, hint + 25);
  let best = null;
  for (let i = from; i < to; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const f = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2));
    const cx = a.x + dx * f;
    const cz = a.z + dz * f;
    const d2 = (x - cx) ** 2 + (z - cz) ** 2;
    if (!best || d2 < best.d2) best = { i, f, cx, cz, d2 };
  }
  const a = samples[best.i];
  const tx = a.tx;
  const tz = a.tz;
  // Right of the direction of travel is (-tz, tx).
  const lateral = (x - best.cx) * -tz + (z - best.cz) * tx;
  return { i: best.i, s: a.s + best.f * SPACING, lateral, tx, tz, x: best.cx, z: best.cz };
}

// Position and direction at a distance along the course.
export function pointAt(course, s) {
  const { samples } = course;
  const i = Math.max(0, Math.min(samples.length - 2, Math.floor(s / SPACING)));
  const f = Math.max(0, Math.min(1, s / SPACING - i));
  const a = samples[i];
  const b = samples[i + 1];
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, tx: a.tx, tz: a.tz };
}

export function headingAt(course, s) {
  const p = pointAt(course, s);
  return Math.atan2(p.tx, -p.tz);
}

// The practice river: a 1 km time trial through gentle S-bends.
export function practiceRiver() {
  const points = [];
  for (let i = 0; i <= 14; i++) {
    points.push([Math.sin(i * 1.1) * 50 + Math.sin(i * 0.37) * 25, -i * 100]);
  }
  return createCourse(points, {
    width: 20, start: 60, finish: 1060,
    moorings: [{ s: 420, length: 18, side: 1 }, { s: 445, length: 16, side: 1 }],
    bridges: [700],
  });
}

// A division race on an English lowland river: `km` on the HUD. A wide reach
// for the start line, then 11-16 m between the banks, with boats moored along
// the way and a couple of old bridges.
export function raceRiver(km = 6, warp = 4) {
  const start = 80;
  const finish = start + (km * 1000) / warp;
  const points = [];
  for (let i = 0; i * 100 <= finish + 160; i++) {
    points.push([Math.sin(i * 0.7) * 60 + Math.sin(i * 0.29 + 1) * 40, -i * 100]);
  }
  const reach = (s) => 13.5 + 1.8 * Math.sin(s * 0.011) + 1 * Math.sin(s * 0.029 + 2);
  const width = (s) => {
    const k = Math.max(0, Math.min(1, (s - start - 50) / 120)); // the start reach narrows down
    return 25 + (reach(s) - 25) * k * k * (3 - 2 * k);
  };
  const moorings = [];
  for (const [at, side, count] of [[420, 1, 3], [700, -1, 2], [980, 1, 4], [1290, -1, 3]]) {
    for (let k = 0, s = at; k < count; k++) {
      const length = 15 + ((k * 7 + at) % 7);
      moorings.push({ s: s + length / 2, length, side });
      s += length + 1.5;
    }
  }
  return createCourse(points, { width, start, finish, warp, moorings, bridges: [600, 1150] });
}

// Beam of each kind of moored boat, metres.
export const POST = 0.7; // a post standing in the water, metres square (world.js draws it)
const BEAM = { narrowboat: NARROWBOAT, cruiser: 3.4, 'trip-boat': 4.6, tatty: 3.4 };

// A real river from a course file (made by apps/web/scripts/courses, see
// docs/features/game-courses-from-video.md): its line and widths in true metres,
// and the scenery along it in `scenery`, for world.js. `scenery.river` is the
// river line itself, which everything in the file is placed along. With a
// `route` (a loop, round islands) the race follows that instead: moored boats
// narrow it wherever they lie, and `shared` marks water it uses both ways.
// Where the file maps the water (`water`), `shore` (water.js) keeps boats off
// the real banks, islands and moored boats.
export function courseFromFile(data) {
  const along = (line, values) => {
    const cum = [0];
    for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
    return (s) => {
      let i = 0;
      while (i < cum.length - 2 && cum[i + 1] < s) i++;
      const f = Math.max(0, Math.min(1, (s - cum[i]) / (cum[i + 1] - cum[i] || 1)));
      return values[i] + (values[i + 1] - values[i]) * f;
    };
  };
  const moorings = data.moorings.map((m) => ({ ...m, beam: BEAM[m.kind] ?? NARROWBOAT }));
  const river = createCourse(data.line, {
    width: along(data.line, data.width), start: data.start, finish: data.finish, warp: data.warp, speedup: data.speedup,
    moorings, bridges: data.bridges,
  });
  // Moored boats and posts in the water are solid.
  const posts = (data.posts ?? []).map(([x, z]) => ({ x, z, ux: 1, uz: 0, half: POST / 2, beam: POST }));
  const shore = data.water?.length ? shoreOf(waterMap(data.water), [...mooringBoxes(river, moorings), ...posts]) : null;
  if (!data.route) return { ...river, shore, scenery: { ...data, river } };
  const { line, left, right, start, finish } = data.route;
  const [l, r] = [along(line, left), along(line, right)];
  const course = createCourse(line, { sides: (s) => ({ left: l(s), right: r(s) }), start, finish, warp: data.warp, speedup: data.speedup });
  for (const m of moorings) moored(course, river, m);
  twoWay(course);
  return { ...course, shore, scenery: { ...data, river } };
}

// The boats moored on a river (placed against their bank, as moored() has
// them), as boxes for water.js's shoreOf: solid.
function mooringBoxes(river, moorings) {
  return moorings.map((m) => {
    const c = pointAt(river, m.s);
    const w = widthAt(river, m.s).half - m.beam / 2;
    return { x: c.x - c.tz * m.side * w, z: c.z + c.tx * m.side * w, ux: c.tx, uz: c.tz, half: m.length / 2, beam: m.beam };
  });
}

// Narrows a route where a boat moored on the river (`m`, placed along `river`) lies.
function moored(course, river, m) {
  const c = pointAt(river, m.s);
  const w = widthAt(river, m.s).half - m.beam / 2;
  const bx = c.x - c.tz * m.side * w;
  const bz = c.z + c.tx * m.side * w;
  for (const p of course.samples) {
    const along = (bx - p.x) * p.tx + (bz - p.z) * p.tz;
    const lateral = (bx - p.x) * -p.tz + (bz - p.z) * p.tx;
    if (Math.abs(along) > m.length / 2 + 1 || Math.abs(lateral) > Math.max(p.left, p.right) + m.beam) continue;
    const edge = Math.max(2, Math.abs(lateral) - m.beam / 2);
    if (lateral > 0) p.right = Math.min(p.right, edge);
    else p.left = Math.min(p.left, edge);
  }
}

// Marks the samples of a route that share water with another part of it (boats
// come the other way there): another sample far along the route but close by.
function twoWay(course) {
  const cell = (x, z) => `${Math.floor(x / 20)},${Math.floor(z / 20)}`;
  const grid = new Map();
  for (const p of course.samples) grid.set(cell(p.x, p.z), [...(grid.get(cell(p.x, p.z)) ?? []), p]);
  for (const p of course.samples) {
    const reach = Math.max(p.left, p.right);
    p.shared = false;
    for (let dx = -1; dx <= 1 && !p.shared; dx++) {
      for (let dz = -1; dz <= 1 && !p.shared; dz++) {
        for (const q of grid.get(cell(p.x + dx * 20, p.z + dz * 20)) ?? []) {
          if (Math.abs(q.s - p.s) > 200 && Math.hypot(q.x - p.x, q.z - p.z) < reach) {
            p.shared = true;
            break;
          }
        }
      }
    }
  }
}

export async function loadCourse(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load the course (${res.status}).`);
  return courseFromFile(await res.json());
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return [0, 1].map((k) => 0.5 * (
    2 * p1[k]
    + (-p0[k] + p2[k]) * t
    + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2
    + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3
  ));
}
