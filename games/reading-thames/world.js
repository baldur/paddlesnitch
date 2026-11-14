// Builds the static scenery for a course into one mesh: river banks with a
// towpath, trees, moored narrowboats, brick bridges, distant hills, start and
// finish gantries and distance markers. A real river (course.scenery, from a
// course file) gets its own buildings, bridges, boats, woods, railway and lock
// instead of the made-up ones. Pure, no GPU.
import { waterMap, SHORE_SEARCH } from './water.js';
import { MeshBuilder } from './meshes.js';
import { locate, pointAt, widthAt, POST } from './course.js';
import { createAnglers, SNAG } from './anglers.js';

const COLORS = {
  mud: [0.42, 0.36, 0.27],
  grass: [0.36, 0.52, 0.25],
  meadow: [0.45, 0.58, 0.3],
  trunk: [0.35, 0.25, 0.17],
  pine: [0.17, 0.36, 0.22],
  leaf: [0.3, 0.47, 0.2],
  hill: [0.38, 0.47, 0.42],
  post: [0.92, 0.92, 0.88],
  buoy: [0.98, 0.72, 0.1],
  start: [0.2, 0.7, 0.35],
  finishA: [0.95, 0.95, 0.95],
  finishB: [0.1, 0.1, 0.1],
  marker: [0.95, 0.35, 0.2],
  towpath: [0.6, 0.55, 0.45],
  brick: [0.6, 0.33, 0.24],
  coping: [0.72, 0.68, 0.6],
  boatHull: [0.08, 0.08, 0.09],
  mown: [0.42, 0.6, 0.27],
  willow: [0.5, 0.62, 0.25],
  timber: [0.45, 0.33, 0.22],
  white: [0.93, 0.93, 0.9],
  stone: [0.78, 0.75, 0.68],
  concrete: [0.72, 0.71, 0.68],
  steel: [0.88, 0.89, 0.9],
  ballast: [0.45, 0.42, 0.38],
  mast: [0.35, 0.37, 0.4],
  foam: [0.92, 0.95, 0.96],
  navy: [0.12, 0.2, 0.42],
  glass: [0.2, 0.28, 0.35],
  roof: [0.78, 0.74, 0.62],
  window: [0.15, 0.17, 0.2],
  quay: [0.66, 0.63, 0.56],
  cream: [0.9, 0.88, 0.81],
  pontoon: [0.78, 0.78, 0.75],
};

// Narrowboat paintwork: cabin sides, and the trim along the top.
const PAINT = [
  [[0.12, 0.32, 0.2], [0.75, 0.15, 0.12]],
  [[0.45, 0.08, 0.1], [0.9, 0.75, 0.2]],
  [[0.1, 0.18, 0.4], [0.85, 0.85, 0.8]],
  [[0.2, 0.2, 0.22], [0.8, 0.3, 0.1]],
  [[0.6, 0.12, 0.08], [0.1, 0.3, 0.15]],
];

// The hills round a real river: wooded green-grey, not slate.
const HILLS = [0.3, 0.4, 0.3];

// Paintwork seen on particular boats (a course file's `paint`).
const NAMED_PAINT = { maroon: [[0.4, 0.13, 0.15], [0.92, 0.91, 0.86]], navy: PAINT[2] };

// The bank rises from just under the water at the edge to rolling fields. A real
// river's banks reach further, to carry the buildings and woods beside it.
const PROFILE = [[0, -0.4], [2.5, 0.35], [7, 1.1], [30, 2.2], [160, 4]];
const REAL_PROFILE = [...PROFILE, [320, 5]];

// Real houses and flats: walls, and roofs for the pitched ones.
// Riverside greens, from the frames: dark alders and oaks, brighter ash and
// sycamore, and the odd yellow-green poplar.
const LEAVES = [[0.2, 0.33, 0.13], [0.25, 0.4, 0.16], [0.3, 0.47, 0.2], [0.38, 0.52, 0.2], [0.17, 0.27, 0.12]];
// The ground under riverside trees: rough grass in their shade.
const SHADED = [0.25, 0.36, 0.17];

// Reading's red brick, buff brick and white render.
const WALLS = [[0.62, 0.32, 0.24], [0.7, 0.42, 0.3], [0.86, 0.8, 0.68], [0.92, 0.9, 0.85], [0.55, 0.3, 0.25], [0.8, 0.68, 0.47]];
const ROOFS = [[0.32, 0.2, 0.17], [0.28, 0.28, 0.3], [0.45, 0.25, 0.18]];

// `parts`: 'river' is the river and its scenery alone, 'course' what this
// course adds to it (turning buoys, start and finish gantries, distance
// boards), 'all' both. The Reading courses share one river: main.js builds it
// once and each course's own parts on their own.
export function buildWorld(course, seed = 1, parts = 'all') {
  const rand = mulberry32(seed);
  const m = new MeshBuilder();
  if (parts === 'course') {
    courseParts(m, course);
    return m.build();
  }
  const real = course.scenery;
  // A real river's scenery is placed along the river line, which a race on a
  // route (a loop, round islands) doesn't follow.
  const river = real?.river ?? course;
  const { samples } = river;
  const stride = 3; // bank quads every 6 m

  if (real) {
    river.land = waterMap(real.water ?? []);
    river.pads = null;
    carPark(course);
    realLand(m, river, real, rand);
  } else {
    // The towpath runs along the left bank.
    for (const side of [-1, 1]) {
      for (let i = 0; i + stride < samples.length; i += stride) {
        const a = samples[i];
        const b = samples[i + stride];
        for (let k = 0; k < PROFILE.length - 1; k++) {
          const [d0, h0] = PROFILE[k];
          const [d1, h1] = PROFILE[k + 1];
          const p = (s, d, h) => [s.x + -s.tz * side * (s.half + d), h + bump(s.x, s.z, d), s.z + s.tx * side * (s.half + d)];
          const green = k === 1 ? (side < 0 ? COLORS.towpath : COLORS.grass) : COLORS.meadow;
          const color = k === 0 ? COLORS.mud : shade(green, rand, 0.08);
          m.quad(p(a, d0, h0), p(b, d0, h0), p(b, d1, h1), p(a, d1, h1), color);
        }
      }
    }
  }
  const half = Math.max(...samples.map((p) => p.half));

  // Close the river off just before the start and after the end. A real river's
  // banks reach much further, so its ends are closed further back too (at the
  // far end of the Reading Thames, just behind a lock's gates).
  for (const s of [0, river.length]) {
    const c = pointAt(river, s);
    const dir = s === 0 ? -1 : 1;
    const depth = real ? 320 : 6;
    const back = [c.x + c.tx * dir * depth, c.z + c.tz * dir * depth];
    const r = [-c.tz, c.tx];
    const w = half + (real ? 330 : 10);
    m.quad(
      [c.x - r[0] * w, 1, c.z - r[1] * w], [c.x + r[0] * w, 1, c.z + r[1] * w],
      [back[0] + r[0] * w, real ? 5 : 1.4, back[1] + r[1] * w], [back[0] - r[0] * w, real ? 5 : 1.4, back[1] - r[1] * w],
      COLORS.grass,
    );
  }

  if (real) realScenery(m, river, real, rand);

  // Trees along both banks, kept out of the water on the inside of bends, and
  // off the towpath.
  for (let s = 0; s < (real ? 0 : course.length); s += 5) {
    const c = pointAt(course, s);
    const w = widthAt(course, s).half;
    for (const side of [-1, 1]) {
      const count = rand() < 0.75 ? 2 : 1;
      for (let n = 0; n < count; n++) {
        const d = w + (side < 0 ? 9 : 4) + rand() ** 1.6 * 90;
        const x = c.x - c.tz * side * d + (rand() - 0.5) * 6;
        const z = c.z + c.tx * side * d + (rand() - 0.5) * 6;
        const at = locate(course, x, z);
        if (Math.abs(at.lateral) < widthAt(course, at.s).half + 3.5) continue;
        tree(m, x, groundHeight(d - w) + bump(x, z, d), z, rand);
      }
    }
  }

  const tatty = mulberry32(seed + 101); // its own draws, so the rest of the world stays as it was
  river.moorings.forEach((boat, k) => {
    if (boat.kind === 'tatty') tattyCruiser(m, river, boat, tatty);
    else if (boat.kind === 'houseboat') houseboat(m, river, boat);
    else if (boat.kind === 'cruiser' || boat.kind === 'trip-boat') cruiser(m, river, boat, rand);
    else narrowboat(m, river, boat, NAMED_PAINT[boat.paint] ?? PAINT[k % PAINT.length]);
  });
  for (const b of river.bridges) {
    if (typeof b === 'number') bridge(m, river, b);
    else if (b.style === 'cable-stayed') cableStayedBridge(m, river, b);
    else if (b.style === 'concrete-arch') concreteBridge(m, river, b);
    else bridge(m, river, b.s);
  }

  // Hills on the horizon, kept well clear of every part of the river.
  const xs = samples.map((p) => p.x);
  const zs = samples.map((p) => p.z);
  const box = [Math.min(...xs) - 900, Math.min(...zs) - 900, Math.max(...xs) + 900, Math.max(...zs) + 900];
  for (let placed = 0, tries = 0; placed < 60 && tries < 2000; tries++) {
    const x = box[0] + rand() * (box[2] - box[0]);
    const z = box[1] + rand() * (box[3] - box[1]);
    const radius = 120 + rand() * 160;
    if (Math.abs(locate(river, x, z).lateral) < radius + 450) continue;
    // Low wooded downs on the horizon, not peaks: Reading's hills are gentle.
    m.cone([x, 0, z], radius, (50 + rand() * 90) * (real ? 0.4 : 1), real ? 10 : 7, shade(real ? HILLS : COLORS.hill, rand, 0.1));
    placed++;
  }

  if (parts !== 'river') courseParts(m, course);
  return m.build();
}

function courseParts(m, course) {
  for (const b of course.scenery?.marks ?? []) buoy(m, b);
  // (A loop that finishes where it starts gets the finish banner only.)
  const [a, b] = [pointAt(course, course.start), pointAt(course, course.finish)];
  if (Math.hypot(a.x - b.x, a.z - b.z) > 20) gantry(m, course, course.start, COLORS.start, COLORS.post);
  gantry(m, course, course.finish, COLORS.finishA, COLORS.finishB);

  // Buoys either end of the start and finish lines, a marker post every 250 m.
  for (const s of [course.start, course.finish]) {
    const c = pointAt(course, s);
    for (const side of [-1, 1]) {
      const d = widthAt(course, s).half - 1.5;
      m.sphere([c.x - c.tz * side * d, 0.05, c.z + c.tx * side * d], 0.35, COLORS.buoy);
    }
  }
  // (A real river at speedup 4 gets a board every true kilometre.)
  const every = 250 * (course.speedup ?? 1);
  for (let s = course.start + every; s < course.finish; s += every) {
    const c = pointAt(course, s);
    {
      const d = widthAt(course, s).half + 3;
      const x = c.x - c.tz * d;
      const z = c.z + c.tx * d;
      m.cylinder([x, 0.3, z], 0.08, 2.6, 6, COLORS.post);
      m.box([x - 0.6, 2.4, z - 0.6], [x + 0.6, 3.4, z + 0.6], COLORS.marker);
    }
  }
}

// Two posts on the banks and a banner across the river, chequered or striped.
function gantry(m, course, s, colorA, colorB) {
  const c = pointAt(course, s);
  const half = widthAt(course, s).half + 1.5;
  const r = [-c.tz, c.tx];
  const left = [c.x - r[0] * half, c.z - r[1] * half];
  const right = [c.x + r[0] * half, c.z + r[1] * half];
  for (const [x, z] of [left, right]) m.cylinder([x, 0, z], 0.25, 6.5, 8, [0.85, 0.85, 0.82]);
  const cells = 24;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < 2; j++) {
      const f0 = i / cells;
      const f1 = (i + 1) / cells;
      const x0 = left[0] + (right[0] - left[0]) * f0;
      const z0 = left[1] + (right[1] - left[1]) * f0;
      const x1 = left[0] + (right[0] - left[0]) * f1;
      const z1 = left[1] + (right[1] - left[1]) * f1;
      const y0 = 5 + j * 0.6;
      const y1 = y0 + 0.6;
      m.quad([x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0], (i + j) % 2 ? colorA : colorB);
    }
  }
}

// A box in a local frame: `right` across, `fwd` along (both unit vectors in
// the ground plane), around `origin`. Ranges are [from, to] along each axis.
const mix = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t);

function orientedBox(m, origin, right, fwd, [x0, x1], [y0, y1], [z0, z1], color) {
  const at = (x, y, z) => [origin[0] + right[0] * x + fwd[0] * z, origin[1] + y, origin[2] + right[1] * x + fwd[1] * z];
  const c = [at(x0, y0, z0), at(x1, y0, z0), at(x1, y1, z0), at(x0, y1, z0), at(x0, y0, z1), at(x1, y0, z1), at(x1, y1, z1), at(x0, y1, z1)];
  const centre = at((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const faces = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]];
  for (const [a, b, d, e] of faces) {
    const mid = [0, 1, 2].map((i) => (c[a][i] + c[b][i] + c[d][i] + c[e][i]) / 4 - centre[i]);
    m.triFacing(c[a], c[b], c[d], color, mid);
    m.triFacing(c[a], c[d], c[e], color, mid);
  }
}

// Where a moored boat lies: against its bank at `s`, `inset` metres in from
// the water's edge (its half-beam), or at a point of its own along `dir` (in a
// side channel the river line doesn't follow). origin, right (across), fwd (along).
function berth(course, { s, side, at, dir }, inset) {
  if (at) return { origin: [at[0], 0, at[1]], right: [-dir[1], dir[0]], fwd: dir };
  const c = pointAt(course, s);
  const w = widthAt(course, s).half;
  const right = [-c.tz, c.tx];
  return { origin: [c.x + right[0] * side * (w - inset), 0, c.z + right[1] * side * (w - inset)], right, fwd: [c.tx, c.tz] };
}

// A narrowboat moored against the bank: black hull, painted cabin, a roof
// and a chimney, with a pointed bow upstream.
function narrowboat(m, course, boat, [paint, trim]) {
  const { length, paint: named, crew } = boat;
  const { origin, right, fwd } = berth(course, boat, 1.05);
  const half = length / 2;
  orientedBox(m, origin, right, fwd, [-1.05, 1.05], [-0.4, 0.55], [-half, half - 2.2], COLORS.boatHull);
  // The bow: two sloping sides meeting at the stem.
  const at = (x, y, z) => [origin[0] + right[0] * x + fwd[0] * z, y, origin[2] + right[1] * x + fwd[1] * z];
  for (const e of [-1, 1]) {
    m.triFacing(at(e * 1.05, -0.4, half - 2.2), at(e * 1.05, 0.55, half - 2.2), at(0, 0.75, half), COLORS.boatHull, [right[0] * e, 0, right[1] * e]);
    m.triFacing(at(e * 1.05, -0.4, half - 2.2), at(0, -0.4, half), at(0, 0.75, half), COLORS.boatHull, [right[0] * e, 0, right[1] * e]);
  }
  m.triFacing(at(-1.05, 0.55, half - 2.2), at(1.05, 0.55, half - 2.2), at(0, 0.75, half), trim, [0, 1, 0]);
  orientedBox(m, origin, right, fwd, [-0.95, 0.95], [0.55, 1.7], [-half + 1.2, half - 3], paint);
  orientedBox(m, origin, right, fwd, [-1.0, 1.0], [1.7, 1.78], [-half + 1.1, half - 2.9], COLORS.roof);
  orientedBox(m, origin, right, fwd, [-0.97, 0.97], [1.55, 1.7], [-half + 1.15, half - 2.95], trim);
  for (let z = -half + 2.5; z < half - 4; z += 1.6) {
    // (The maroon boat's windows have white frames.)
    if (named === 'maroon') orientedBox(m, origin, right, fwd, [-0.99, 0.99], [0.86, 1.39], [z - 0.09, z + 0.69], COLORS.white);
    orientedBox(m, origin, right, fwd, [-1.02, 1.02], [0.95, 1.3], [z, z + 0.6], COLORS.window);
  }
  const chimney = at(0.3, 1.78, half - 4.5);
  m.cylinder(chimney, 0.08, 0.6, 6, COLORS.boatHull);
  if (crew === 'statues') statues(m, (x, y, z) => at(x, y, z), right, fwd, half - 3.7);
}

// Figures standing on a narrowboat's roof, in front of the chimney: Lara Croft
// (green vest, blue cargo trousers, holsters on her thighs, a long brown plait)
// beside a woman in black. At `z` along the boat, a little larger than life
// (`STATUE`) so they show from the water (owner, 2026-10-31).
const FIGURE = { skin: [0.86, 0.68, 0.55], hair: [0.3, 0.18, 0.1], vest: [0.3, 0.5, 0.33], cargo: [0.2, 0.3, 0.48], holster: [0.15, 0.12, 0.1], boot: [0.12, 0.1, 0.09], black: [0.1, 0.1, 0.11] };
const STATUE = 1.25;
function statues(m, at, right, fwd, z) {
  const deck = 1.78; // the cabin roof
  const k = STATUE;
  const figure = (x, top, legs, hair, plait) => {
    const box = (xr, yr, zr, color) => orientedBox(m, at(0, 0, 0), right, fwd, xr.map((v) => v * k + x), yr.map((v) => v * k + deck), zr.map((v) => v * k + z), color);
    for (const e of [-1, 1]) {
      box([e * 0.12 - 0.07, e * 0.12 + 0.07], [0, 0.12], [-0.08, 0.12], FIGURE.boot);
      box([e * 0.12 - 0.07, e * 0.12 + 0.07], [0.12, 0.85], [-0.07, 0.07], legs);
      box([e * 0.24 - 0.04, e * 0.24 + 0.04], [0.95, 1.4], [-0.04, 0.04], FIGURE.skin); // arms
    }
    box([-0.19, 0.19], [0.85, 1.42], [-0.1, 0.1], top);
    m.sphere(at(x, deck + 1.58 * k, z), 0.12 * k, FIGURE.skin, 3, 6);
    m.sphere(at(x, deck + 1.62 * k, z - 0.03 * k), 0.125 * k, hair, 3, 6);
    if (plait) box([-0.03, 0.03], [1.05, 1.55], [-0.16, -0.1], hair);
    return box;
  };
  const lara = figure(-0.42, FIGURE.vest, FIGURE.cargo, FIGURE.hair, true);
  for (const e of [-1, 1]) lara([e * 0.2 - 0.04, e * 0.2 + 0.04], [0.5, 0.72], [-0.06, 0.06], FIGURE.holster);
  figure(0.42, FIGURE.black, FIGURE.black, [0.2, 0.14, 0.1], false);
}

// An old brick road bridge: one arch over the whole river, the deck and
// parapets on top, and abutments into the banks.
function bridge(m, course, s) {
  const c = pointAt(course, s);
  const right = [-c.tz, c.tx];
  const fwd = [c.tx, c.tz];
  const origin = [c.x, 0, c.z];
  const span = widthAt(course, s).half + 1;
  const deck = 4.4;
  const under = (x) => 1.6 + 2.2 * Math.sqrt(Math.max(0, 1 - (x / span) ** 2));
  const n = 14;
  for (let k = 0; k < n; k++) {
    const x0 = -span + (2 * span * k) / n;
    const x1 = -span + (2 * span * (k + 1)) / n;
    orientedBox(m, origin, right, fwd, [x0, x1], [under((x0 + x1) / 2), deck], [-2, 2], COLORS.brick);
  }
  for (const e of [-1, 1]) {
    orientedBox(m, origin, right, fwd, e < 0 ? [-span - 8, -span] : [span, span + 8], [-0.5, deck], [-2.4, 2.4], COLORS.brick);
    orientedBox(m, origin, right, fwd, [-span - 8, span + 8], [deck, deck + 0.9], e < 0 ? [-2, -1.6] : [1.6, 2], COLORS.brick);
    orientedBox(m, origin, right, fwd, [-span - 8, span + 8], [deck + 0.9, deck + 1.05], e < 0 ? [-2.05, -1.55] : [1.55, 2.05], COLORS.coping);
  }
}

// real: a real lowland river, where the riverside trees are all broadleaf, and
// full-grown (the frames show 10-20 m walls of them).
// far: well back from the water, where a second ball of crown can't be told apart.
function tree(m, x, y, z, rand, real = false, far = false) {
  const pine = !real && rand() < 0.2; // mostly broadleaf: oaks, willows, alders
  const h = pine ? 7 + rand() * 9 : real ? 9 + rand() * 9 : 5 + rand() * 6;
  m.cylinder([x, y - 0.3, z], 0.2 + h * 0.015, h * 0.35, far ? 3 : 4, COLORS.trunk); // a trunk shows a few pixels wide: four sides, three far off
  if (pine) {
    for (let k = 0; k < 3; k++) {
      m.cone([x, y + h * (0.25 + k * 0.22), z], h * (0.32 - k * 0.07), h * 0.42, 7, shade(COLORS.pine, rand, 0.1));
    }
  } else if (real) {
    // A big riverside crown, its lower branches reaching down to the water.
    const leaf = LEAVES[Math.floor(rand() * LEAVES.length)];
    const r = h * 0.34;
    m.sphere([x, y + h * 0.64, z], far ? r * 1.15 : r, shade(leaf, rand, 0.1), 3, 6);
    const a = rand() * Math.PI * 2;
    const second = shade(leaf, rand, 0.15); // drawn either way, so the trees after it stay as they were
    if (!far) m.sphere([x + Math.cos(a) * r * 0.7, y + h * 0.36, z + Math.sin(a) * r * 0.7], r * 0.85, second, 3, 6);
  } else {
    // A rounded crown out of a couple of lumpy balls.
    const r = h * 0.3;
    m.sphere([x, y + h * 0.62, z], r, shade(COLORS.leaf, rand, 0.12), 3, 6);
    const a = rand() * Math.PI * 2;
    m.sphere([x + Math.cos(a) * r * 0.6, y + h * 0.5, z + Math.sin(a) * r * 0.6], r * 0.75, shade(COLORS.leaf, rand, 0.15), 3, 6);
  }
}

function groundHeight(d, profile = PROFILE) {
  for (let k = 0; k < profile.length - 1; k++) {
    const [d0, h0] = profile[k];
    const [d1, h1] = profile[k + 1];
    if (d <= d1) return h0 + ((h1 - h0) * (d - d0)) / (d1 - d0);
  }
  return profile.at(-1)[1];
}

// Gentle unevenness away from the water's edge, so fields aren't flat.
function bump(x, z, d) {
  const away = Math.min(1, Math.max(0, (d - 5) / 25));
  return away * (Math.sin(x * 0.05) * Math.cos(z * 0.04) * 1.2 + Math.sin(x * 0.013 + z * 0.017) * 2);
}

function shade(color, rand, amount) {
  const k = 1 + (rand() - 0.5) * 2 * amount;
  return color.map((c) => Math.min(1, c * k));
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

// --- a real river ------------------------------------------------------------

// What's on a bank at a distance along: park, trees, gardens or wild.
function coverAt(real, side, s) {
  return real.banks.find((b) => b.side === side && s >= b.from && s <= b.to)?.cover ?? 'trees';
}

// The ground under any point beside a real river, and how far it is from the
// water: from the mapped water's outlines where there are some (islands, side
// channels), else from the river line.
function ground(course, x, z, lineD = null) {
  let d = lineD;
  if (d === null) {
    const at = locate(course, x, z);
    d = Math.abs(at.lateral) - widthAt(course, at.s).half;
  }
  if (course.land?.rings) {
    if (course.land.inside(x, z)) return { d: -1, y: -0.6 };
    // The nearest mapped shore, wherever it is: land beside a side channel far
    // off the river line (Fry's back channel, 90 m out) slopes down to that
    // water, not up as if it were 90 m from any.
    d = d < SHORE_SEARCH ? course.land.shore(x, z) : Math.min(d, course.land.shore(x, z));
  }
  if (d < 0) return { d, y: -0.4 };
  return { d, y: level(course.pads, x, z, groundHeight(d, REAL_PROFILE) + bump(x, z, d)) };
}

// Flat ground where the real ground is flat (a car park): each pad is a
// rectangle in a frame, at a height, eased into the land round it over `margin`.
function level(pads, x, z, y) {
  for (const p of pads ?? []) {
    const [dx, dz] = [x - p.origin[0], z - p.origin[1]];
    const u = dx * p.right[0] + dz * p.right[1];
    const v = dx * p.fwd[0] + dz * p.fwd[1];
    const out = Math.max(p.x[0] - u, u - p.x[1], p.z[0] - v, v - p.z[1], 0);
    if (out >= p.margin) continue;
    const t = 1 - out / p.margin;
    y += (p.y - y) * t * t * (3 - 2 * t);
  }
  return y;
}

// Reading Rowing Club's car park, at its downstream end (where the walk
// starts): flat, though the bank rises behind the club. Set on the river once.
function carPark(course) {
  const river = course.scenery?.river ?? course;
  if (river.pads) return;
  river.pads = [];
  const f = course.scenery && landmarkFrame(course, 'rowing-club');
  if (!f) return;
  const p = rowingPlan(river, f);
  river.pads = [{ origin: xz(f.origin), right: f.right, fwd: f.fwd, x: [p.x0 - 2, p.east + PARK.long + 6], z: [p.zb - 8, p.wall], y: f.origin[1] + p.floor, margin: 6 }];
}

// A gravel path along the bank, 2 m wide, following the ground.
function footpath(m, course, line) {
  const gravel = [0.62, 0.58, 0.5];
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const r = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len]; // across the path
    const n = Math.ceil(len / 2);
    const at = (k, side) => {
      const x = a[0] + ((b[0] - a[0]) * k) / n + r[0] * side;
      const z = a[1] + ((b[1] - a[1]) * k) / n + r[1] * side;
      return [x, Math.max(0, ground(course, x, z).y) + 0.06, z];
    };
    for (let k = 0; k < n; k++) m.quad(at(k, -1), at(k, 1), at(k + 1, 1), at(k + 1, -1), gravel);
  }
}

// The distance from a point to a segment.
function toSegment(x, z, a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
}

// How far a point is from the river itself (not from a lake or pond beside
// it): what the triangle budget goes by.
function fromRiver(course, x, z) {
  const at = locate(course, x, z);
  const d = Math.abs(at.lateral) - widthAt(course, at.s).half;
  return d < SHORE_SEARCH && course.land?.rings ? course.land.shore(x, z) : d;
}

// The height of the ground at a point beside a real river (for a paddler
// running along the bank on a portage); 0 on a made-up river.
// How wooded each bank of a real river is beside (x, z), [left, right] as you
// face along (tx, tz) (left = negative lateral, as the water shader's `across`), 0 to 1: 1 with no
// buildings within 45 m of the water's edge 60 m either way, falling to 0 with
// three or more. The water mirrors trees in proportion (main.js packs it into
// the frame), so a town reach mirrors its sky, not a wall of leaves under its
// houses. Worked out once per course, every 10 m.
export function bankWoods(course, x, z, tx, tz) {
  const river = course.scenery?.river ?? course;
  if (!course.scenery?.buildings) return [1, 1];
  if (!river.woodsAlong) {
    const step = 10;
    const n = Math.ceil(river.length / step) + 1;
    const near = [new Float32Array(n), new Float32Array(n)];
    for (const b of course.scenery.buildings) {
      const cx = b.shape.reduce((a, q) => a + q[0], 0) / b.shape.length;
      const cz = b.shape.reduce((a, q) => a + q[1], 0) / b.shape.length;
      const at = locate(river, cx, cz);
      if (Math.abs(at.lateral) - widthAt(river, at.s).half > 45) continue;
      const side = at.lateral < 0 ? 0 : 1;
      for (let i = Math.max(0, Math.floor((at.s - 60) / step)); i <= Math.min(n - 1, Math.ceil((at.s + 60) / step)); i++) near[side][i]++;
    }
    river.woodsAlong = near.map((row) => Array.from(row, (c) => Math.max(0, 1 - c / 3)));
  }
  const at = locate(river, x, z);
  const i = Math.max(0, Math.min(river.woodsAlong[0].length - 1, Math.round(at.s / 10)));
  const pair = [river.woodsAlong[0][i], river.woodsAlong[1][i]];
  // Facing down the river line (a route's leg going the other way), its left is your right.
  return at.tx * tx + at.tz * tz < 0 ? pair.reverse() : pair;
}

export function groundAt(course, x, z) {
  if (!course.scenery) return 0;
  const river = course.scenery.river;
  river.land ??= waterMap(course.scenery.water ?? []);
  carPark(course);
  return Math.max(0, ground(river, x, z).y);
}

// A turning buoy off an island's end (a course file's `marks`): a big yellow
// inflatable, a red band and a flag on top, to be seen from well back.
function buoy(m, { x, z }) {
  const yellow = [1, 0.82, 0.12];
  m.cylinder([x, -0.2, z], 1, 1.3, 14, yellow);
  m.cone([x, 1.1, z], 1, 0.9, 14, yellow);
  m.cylinder([x, 0.6, z], 1.02, 0.25, 14, [0.85, 0.15, 0.12]);
  m.cylinder([x, 1.9, z], 0.04, 1.8, 4, [0.2, 0.2, 0.22]);
  m.box([x, 3.1, z - 0.02], [x + 0.8, 3.65, z + 0.02], [0.85, 0.15, 0.12]);
}

// The land beside a real river: strips out from the river line, shaped by the
// mapped water (dipping under the surface wherever it's water, so islands and
// side channels show). Rows across are every 6 m along near the river and 12 m
// further out, with extra rows round any water beyond the bank.
const NEAR = [-6, 0, 3, 7, 12, 20, 30, 45];
const FAR_WATER = 120; // metres out from the bank to look for side channels (Fry's back channel is at most 100)
const FAR = [45, 65, 90, 120, 160, 220, 320];
function realLand(m, river, real, rand) {
  const { samples } = river;
  const at = (s, side, d) => [s.x + -s.tz * side * (s.half + d), s.z + s.tx * side * (s.half + d)];
  // fineRows(n): finer rows for this stretch (a far side channel), drawn in
  // two halves along; the coarse quads' shades are still drawn, so the random
  // draws after them don't change.
  const strip = (side, stride, rowsAt, fineRows = () => null) => {
    for (let n = 0; (n + 1) * stride < samples.length; n++) {
      const a = samples[n * stride];
      const b = samples[(n + 1) * stride];
      const across = rowsAt(n);
      const cover = coverAt(real, side, a.s);
      const point = (s, d) => {
        const [x, z] = at(s, side, d);
        const g = ground(river, x, z, d);
        return { p: [x, g.y, z], d: g.d };
      };
      const rows = fineRows(n);
      if (rows) {
        // The draws the coarse quads would have taken (only those that weren't mud).
        let was = [point(a, across[0]), point(b, across[0])];
        for (let k = 1; k < across.length; k++) {
          const next = [point(a, across[k]), point(b, across[k])];
          if (Math.min(was[0].d, was[1].d, next[0].d, next[1].d) >= 1) shade(COLORS.meadow, rand, 0.08);
          was = next;
        }
        const mid = samples[n * stride + stride / 2];
        for (const [u, v] of [[a, mid], [mid, b]]) {
          let prev = [point(u, rows[0]), point(v, rows[0])];
          for (let k = 1; k < rows.length; k++) {
            const next = [point(u, rows[k]), point(v, rows[k])];
            const near = Math.min(prev[0].d, prev[1].d, next[0].d, next[1].d);
            const green = near < 7 ? SHADED : COLORS.meadow;
            m.quad(prev[0].p, prev[1].p, next[1].p, next[0].p, near < 1 ? COLORS.mud : shade(green, fine, 0.08));
            prev = next;
          }
        }
        continue;
      }
      let prev = [point(a, across[0]), point(b, across[0])];
      for (let k = 1; k < across.length; k++) {
        const next = [point(a, across[k]), point(b, across[k])];
        const near = Math.min(prev[0].d, prev[1].d, next[0].d, next[1].d);
        const green = near < 7 && (cover === 'park' || cover === 'gardens') ? COLORS.mown : near < 7 ? SHADED : COLORS.meadow;
        const color = near < 1 ? COLORS.mud : shade(green, rand, 0.08);
        m.quad(prev[0].p, prev[1].p, next[1].p, next[0].p, color);
        prev = next;
      }
    }
  };
  // Shades for the finer land round a far side channel: their own draws, so
  // the rest of the world (every tree) stays as it was.
  const fine = mulberry32(404);
  for (const side of [-1, 1]) {
    // Other water beyond the bank (past some land: a side channel behind an
    // island), with rows every 2.5 m round it: near the river, and further out
    // (Fry's Island's back channel is 75-100 m off the line, where coarse land
    // spanned the channel and lay over its water like a sheet).
    const extra = [];
    const far = [];
    for (let i = 0; i < samples.length; i += 3) {
      let land = false;
      const wet = [];
      for (let d = 0; d < FAR_WATER; d += 2) {
        const w = river.land.inside(...at(samples[i], side, d));
        if (!w) land = true;
        else if (land) wet.push(d);
      }
      const near = wet.filter((d) => d < 45);
      const out = wet.filter((d) => d >= 45);
      extra.push(near.length ? [Math.max(2, near[0] - 8), Math.min(45, near.at(-1) + 8)] : null);
      far.push(out.length ? [Math.max(45, out[0] - 8), out.at(-1) + 8] : null);
    }
    strip(side, 3, (n) => {
      const rows = new Set(NEAR);
      for (let k = Math.max(0, n - 3); k <= Math.min(extra.length - 1, n + 4); k++) {
        if (extra[k]) for (let d = extra[k][0]; d <= extra[k][1]; d += 2.5) rows.add(Math.round(d * 2) / 2);
      }
      return [...rows].sort((p, q) => p - q);
    });
    // Far out, every 36 m and in big rows; where a side channel runs out there,
    // every 6 m and every 2.5 m across round it.
    const farRows = (n) => {
      const rows = new Set(FAR);
      for (let k = Math.max(0, n - 2); k <= Math.min(far.length - 1, n + 3); k++) {
        if (far[k]) for (let d = far[k][0]; d <= far[k][1]; d += 2.5) rows.add(Math.round(d * 2) / 2);
      }
      return [...rows].sort((p, q) => p - q);
    };
    strip(side, 6, () => FAR, (n) => (far.slice(Math.max(0, n * 2 - 2), n * 2 + 4).some(Boolean) ? farRows(n * 2) : null));
  }
}

// How each kind of bank is planted: trees per 6 m of bank, how far back, and
// how many of them are weeping willows.
// `again`: the chance of a second tree further back.
// The triangle budget (a phone draws the whole river every frame): woods are
// planted out to WOOD_REACH metres from the water, and trees further back than
// FAR_TREE get one ball of crown, not two.
const WOOD_REACH = 140;
const FAR_TREE = 70;
const PLANTING = {
  trees: { chance: 1, again: 0.5, near: 2, far: 30, willow: 0.2, bushes: 0.7 },
  wild: { chance: 1, again: 0.7, near: 1, far: 25, willow: 0.2, bushes: 1 },
  park: { chance: 0.35, again: 0, near: 6, far: 14, willow: 0.45, bushes: 0 },
  gardens: { chance: 0.45, again: 0.2, near: 5, far: 45, willow: 0.35, bushes: 0.15, stages: 0.15 },
};

// Styles for whole rows of houses: trees grow between them as between any others.
const ORDINARY = new Set(['balcony-terrace']);
function realScenery(m, course, real, rand) {
  // Building footprints, binned so trees can keep out of them (and well clear
  // of a landmark, so it can be seen from the water).
  const bins = new Map();
  const key = (x, z) => `${Math.floor(x / 20)},${Math.floor(z / 20)}`;
  for (const b of real.buildings) {
    const xs = b.shape.map((p) => p[0]);
    const zs = b.shape.map((p) => p[1]);
    const margin = b.style && !ORDINARY.has(b.style) ? 30 : 2;
    const box = [Math.min(...xs) - margin, Math.min(...zs) - margin, Math.max(...xs) + margin, Math.max(...zs) + margin];
    for (let x = box[0]; x <= box[2] + 20; x += 20) {
      for (let z = box[1]; z <= box[3] + 20; z += 20) {
        const k = key(Math.min(x, box[2]), Math.min(z, box[3]));
        bins.set(k, [...(bins.get(k) ?? []), box]);
      }
    }
  }
  const built = (x, z) => (bins.get(key(x, z)) ?? []).some((b) => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3]);
  // Footpaths (a portage's run) are kept clear: a tree that would stand on one
  // is drawn nowhere, so the random draws, and the rest of the world, stay as
  // they were.
  const paths = real.paths ?? [];
  const onPath = (x, z, clear) => paths.some((line) => line.some((a, i) => i > 0 && toSegment(x, z, line[i - 1], a) < clear));
  const nowhere = new MeshBuilder();
  // And so are the things pointed out in the footage (a beach, a club's lawn).
  const clearings = (real.features ?? []).filter((f) => CLEAR[f.style]).map((f) => [...f.at, CLEAR[f.style]]);
  // And the boat with figures on its roof, so no riverside tree stands over them.
  for (const b of real.moorings ?? []) {
    if (b.crew !== 'statues' || b.at) continue;
    const { origin, fwd } = berth(course, b, 1.05);
    for (let d = -b.length / 2; d <= b.length / 2; d += 3) clearings.push([origin[0] + fwd[0] * d, origin[2] + fwd[1] * d, 5]);
  }
  const cleared = (x, z) => clearings.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r);
  const plant = (x, z, willow, hidden = false) => {
    const g = ground(course, x, z);
    if (g.d < 1.5 || built(x, z)) return;
    const into = hidden || onPath(x, z, willow ? 7 : 4.5) || cleared(x, z) ? nowhere : m;
    if (willow) willowTree(into, x, g.y, z, rand);
    else tree(into, x, g.y, z, rand, true, fromRiver(course, x, z) > FAR_TREE);
  };
  for (const line of paths) footpath(m, course, line);

  // Along each bank, as the frames showed it.
  for (let s = 0; s < course.length; s += 6) {
    const c = pointAt(course, s);
    const w = widthAt(course, s).half;
    for (const side of [-1, 1]) {
      const p = PLANTING[coverAt(real, side, s)];
      const at = (d) => [c.x - c.tz * side * (w + d) + (rand() - 0.5) * 4, c.z + c.tx * side * (w + d) + (rand() - 0.5) * 4];
      if (rand() < p.chance) plant(...at(p.near + rand() ** 1.5 * (p.far - p.near)), rand() < p.willow);
      if (rand() < p.again) plant(...at(p.far * (0.6 + rand())), rand() < p.willow * 0.5);
      // Scrub hanging over the water's edge.
      if (rand() < p.bushes * 0.7 && !walled(real, side, s)) {
        const [x, z] = at(0.5 + rand() * 1.5);
        if (built(x, z)) continue;
        (onPath(x, z, 4) || cleared(x, z) ? nowhere : m).sphere([x, 0.4, z], 2 + rand() * 1.8, shade(LEAVES[Math.floor(rand() * LEAVES.length)], rand, 0.15), 3, 6);
      }
      if (p.stages && rand() < p.stages) landingStage(m, c, side, w);
    }
  }

  // Woods and copses: a tree every ~14 m inside each, out to 200 m from the river.
  for (const wood of real.woods) {
    const xs = wood.map((p) => p[0]);
    const zs = wood.map((p) => p[1]);
    for (let x = Math.min(...xs); x < Math.max(...xs); x += 14) {
      for (let z = Math.min(...zs); z < Math.max(...zs); z += 14) {
        const px = x + (rand() - 0.5) * 10;
        const pz = z + (rand() - 0.5) * 10;
        const d = inside(wood, px, pz) ? fromRiver(course, px, pz) : Infinity;
        if (d > 200) continue;
        plant(px, pz, rand() < 0.1, d > WOOD_REACH); // (out of reach: drawn nowhere, the draws kept)
      }
    }
  }
  for (const [x, z] of real.trees) plant(x, z, false);

  for (const b of real.buildings) building(m, course, b, rand);
  for (const w of real.walls ?? []) embankment(m, course, w, rand);
  for (const line of real.railways) railway(m, course, line);
  for (const lock of real.locks) lockGates(m, lock);
  for (const weir of real.weirs) weirSill(m, weir);
  for (const [x, z] of real.posts ?? []) post(m, x, z);
  for (const f of real.features ?? []) FEATURES[f.style]?.(m, course, spot(course, f.at));
  createAnglers({ scenery: { ...real, river: course } }).forEach((a, k) => angler(m, course, a, k));
}

// A tall, weathered concrete post standing in the water, green at the waterline.
function post(m, x, z) {
  const h = 3.6 + ((Math.abs(x * 13.7 + z * 7.1) % 1) * 0.9);
  const r = POST / 2;
  m.box([x - r, -1.5, z - r], [x + r, 0.5, z + r], POSTS.green);
  m.box([x - r, 0.5, z - r], [x + r, h, z + r], POSTS.concrete);
  m.box([x - r - 0.04, h - 0.25, z - r - 0.04], [x + r + 0.04, h, z + r + 0.04], POSTS.cap);
}

// Someone fishing from the bank: on a stool under a green umbrella, a rod out
// over the water and a line down to a bright float (anglers.js has the line).
function angler(m, course, a, k) {
  const g = ground(course, a.seat.x, a.seat.z);
  const y = Math.max(1, g.y); // on top of the wall where there's one (embankment: 1 m)
  const fwd = [-a.out[0], -a.out[1]]; // facing the water
  const right = [-fwd[1], fwd[0]];
  const origin = [a.seat.x, y, a.seat.z];
  const at = (x, h, z) => [origin[0] + right[0] * x + fwd[0] * z, y + h, origin[2] + right[1] * x + fwd[1] * z];
  const box = (xr, yr, zr, color) => orientedBox(m, origin, right, fwd, xr, yr, zr, color);
  const coat = ANGLER.coats[k % ANGLER.coats.length];
  box([-0.25, 0.25], [0, 0.45], [-0.25, 0.25], ANGLER.stool);
  box([-0.22, 0.22], [0.45, 1.1], [-0.15, 0.15], coat);
  box([-0.18, 0.18], [0.25, 0.5], [0.15, 0.6], ANGLER.trousers); // thighs
  box([-0.18, 0.18], [0, 0.5], [0.5, 0.65], ANGLER.trousers);
  m.sphere(at(0, 1.27, 0), 0.15, ANGLER.skin, 3, 6);
  box([-0.17, 0.17], [1.35, 1.45], [-0.17, 0.2], ANGLER.hat);
  // The umbrella behind, tipped back, and a tackle box.
  m.cylinder(at(0, 0, -0.9), 0.03, 2.1, 4, ANGLER.pole);
  m.cone(at(0, 1.6, -0.9), 1.4, 0.55, 8, ANGLER.brolly);
  box([0.4, 0.85], [0, 0.35], [-0.2, 0.2], ANGLER.tackle);
  // The rod, from the hands out over the water, and the line to the float.
  const tip = [a.tip.x, SNAG.tip[1], a.tip.z];
  beam(m, at(0.15, 0.9, 0.35), tip, 0.025, ANGLER.rod);
  beam(m, tip, [a.float.x, SNAG.float, a.float.z], 0.02, ANGLER.line);
  m.cylinder([a.float.x, -0.05, a.float.z], 0.06, 0.3, 5, ANGLER.float);
  m.sphere([a.float.x, 0.3, a.float.z], 0.07, COLORS.white, 2, 5);
}

function inside(poly, x, z) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

// A weeping willow: a domed crown, and a curtain of leaves falling from it
// almost straight down to the water.
function willowTree(m, x, y, z, rand, size = 1) {
  const h = (10 + rand() * 6) * size;
  m.cylinder([x, y - 0.3, z], 0.45, h * 0.6, 5, COLORS.trunk);
  const color = shade(COLORS.willow, rand, 0.1);
  const top = y + h * 0.74;
  m.sphere([x, top, z], h * 0.3, color, 3, 8);
  // The curtain: fronds hanging from the crown's rim, spreading a little as
  // they fall, ragged where they stop just above the water.
  const n = 14;
  const rt = h * 0.29;
  const rb = h * 0.42;
  const yt = top - h * 0.04;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const yb = y + 0.3 + rand() * 1.8;
    const p = (a, r, py) => [x + Math.cos(a) * r, py, z + Math.sin(a) * r];
    const out = [Math.cos((a0 + a1) / 2), -0.2, Math.sin((a0 + a1) / 2)];
    const c = color.map((v) => v * (i % 2 ? 0.92 : 0.8));
    m.triFacing(p(a0, rt, yt), p(a1, rt, yt), p(a1, rb, yb), c, out);
    m.triFacing(p(a0, rt, yt), p(a1, rb, yb), p(a0, rb, yb + 0.6), c, out);
  }
}

// Whether a stretch of bank is walled (real.walls, from the frames).
function walled(real, side, s) {
  return (real.walls ?? []).some((w) => w.side === side && s >= w.from - 3 && s <= w.to + 3);
}

// A quay or revetment at the water's edge: a stone face a metre high and its top.
function embankment(m, course, { side, from, to, style }, rand) {
  if (style === 'brick') return brickWall(m, course, { side, from, to }, rand);
  for (let s = from; s < to; s += 6) {
    const e = Math.min(to, s + 6);
    const [a, b] = [pointAt(course, s), pointAt(course, e)];
    const [wa, wb] = [widthAt(course, s).half, widthAt(course, e).half];
    const p = (c, w, d, y) => [c.x - c.tz * side * (w + d), y, c.z + c.tx * side * (w + d)];
    const water = [a.tz * side, 0, -a.tx * side];
    const color = shade(COLORS.quay, rand, 0.04);
    m.triFacing(p(a, wa, 0, -0.5), p(b, wb, 0, -0.5), p(b, wb, 0, 1), color, water);
    m.triFacing(p(a, wa, 0, -0.5), p(b, wb, 0, 1), p(a, wa, 0, 1), color, water);
    m.triFacing(p(a, wa, 0, 1), p(b, wb, 0, 1), p(b, wb, 1.2, 1), COLORS.coping, [0, 1, 0]);
    m.triFacing(p(a, wa, 0, 1), p(b, wb, 1.2, 1), p(a, wa, 1.2, 1), COLORS.coping, [0, 1, 0]);
  }
}

// A tall brick retaining wall straight out of the water (under the railway):
// dark weathered brick over a pale rubble apron at the waterline, a coping,
// and the railway's shrubs hanging over the top.
const RAIL_BRICK = [0.5, 0.42, 0.35];
function brickWall(m, course, { side, from, to }, rand) {
  for (let s = from; s < to; s += 4) {
    const e = Math.min(to, s + 4);
    const [a, b] = [pointAt(course, s), pointAt(course, e)];
    const [wa, wb] = [widthAt(course, s).half, widthAt(course, e).half];
    const p = (c, w, d, y) => [c.x - c.tz * side * (w + d), y, c.z + c.tx * side * (w + d)];
    const water = [a.tz * side, 0, -a.tx * side];
    const face = (y0, y1, color) => {
      m.triFacing(p(a, wa, 0, y0), p(b, wb, 0, y0), p(b, wb, 0, y1), color, water);
      m.triFacing(p(a, wa, 0, y0), p(b, wb, 0, y1), p(a, wa, 0, y1), color, water);
    };
    // From the footage: a pale apron of rubble at the foot, dark weathered brick above.
    face(-0.5, 0.6, [0.58, 0.55, 0.5]);
    face(0.6, 3.4, shade(RAIL_BRICK, rand, 0.06));
    m.triFacing(p(a, wa, -0.05, 3.4), p(b, wb, -0.05, 3.4), p(b, wb, 1.5, 3.4), COLORS.coping, [0, 1, 0]);
    m.triFacing(p(a, wa, -0.05, 3.4), p(b, wb, 1.5, 3.4), p(a, wa, 1.5, 3.4), COLORS.coping, [0, 1, 0]);
    // Shrubs along the top, leaning out over the wall (every other stretch).
    const k = Math.round((s - from) / 4);
    if (k % 2 === 0) m.sphere(p(a, wa, 1.6, 4.3 + (k % 3) * 0.4), 1.7 + (k % 5) * 0.2, LEAVES[(k % 3) + 1], 3, 6);
    // Ivy hanging down the face from the top, in patches.
    if (k % 3 !== 1) {
      const drop = 3.4 - (1.2 + (k % 4) * 0.5);
      m.triFacing(p(a, wa, -0.06, drop), p(b, wb, -0.06, drop + 0.4), p(b, wb, -0.06, 3.5), LEAVES[4 - (k % 2)], water);
      m.triFacing(p(a, wa, -0.06, drop), p(b, wb, -0.06, 3.5), p(a, wa, -0.06, 3.5), LEAVES[4 - (k % 2)], water);
    }
  }
}

// A boathouse's pontoon, floating along the bank in front of it.
function pontoon(m, course, at, length) {
  const c = pointAt(course, at.s);
  const side = Math.sign(at.lateral);
  const w = widthAt(course, at.s).half;
  orientedBox(m, [c.x, 0, c.z], [-c.tz * side, c.tx * side], [c.tx, c.tz], [w - 1.6, w + 0.3], [-0.1, 0.35], [-length / 2, length / 2], COLORS.pontoon);
}

// A timber landing stage at the foot of a garden.
function landingStage(m, c, side, w) {
  const right = [-c.tz * side, c.tx * side];
  const fwd = [c.tx, c.tz];
  orientedBox(m, [c.x, 0, c.z], right, fwd, [w - 2.2, w + 0.5], [0.15, 0.45], [-2.5, 2.5], COLORS.timber);
}

// A real building: its footprint's walls, and a hipped roof on a house or a
// boathouse, flat on flats and the rest.
function building(m, course, b, rand) {
  const ring = b.shape[0][0] === b.shape.at(-1)[0] && b.shape[0][1] === b.shape.at(-1)[1] ? b.shape.slice(0, -1) : b.shape;
  if (ring.length < 3) return;
  const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length;
  const cz = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  const g = ground(course, cx, cz);
  if (g.d < 0) return; // on an island or a pontoon the river line doesn't know about
  if (LANDMARKS[b.style]) return LANDMARKS[b.style](m, course, landmarkFacing(course, b.style, ring, cx, cz, g));
  const y0 = g.y - 1;
  const top = g.y + b.height;
  const clap = b.style === 'clapboard';
  if (b.style === 'stilts') return onStilts(m, course, b, ring, cx, cz, g, rand);
  if (b.style === 'balcony-terrace') return balconyTerrace(m, course, b, ring, cx, cz, g, rand);
  const wall = clap ? CLAP.walls[Math.floor(rand() * CLAP.walls.length)]
    : b.kind === 'boathouse' ? (rand() < 0.5 ? COLORS.white : [0.3, 0.42, 0.33]) : WALLS[Math.floor(rand() * WALLS.length)];
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    const out = [(ax + bx) / 2 - cx, 0, (az + bz) / 2 - cz];
    m.triFacing([ax, y0, az], [bx, y0, bz], [bx, top, bz], wall, out);
    m.triFacing([ax, y0, az], [bx, top, bz], [ax, top, az], wall, out);
  }
  // Windows, floor by floor, on the walls that face the river (all anyone sees).
  const river = locate(course, cx, cz);
  const toward = (() => {
    const p = pointAt(course, river.s);
    const len = Math.hypot(p.x - cx, p.z - cz) || 1;
    return [(p.x - cx) / len, (p.z - cz) / len];
  })();
  // (Only within 80 m: further back they're a few pixels behind the bank's trees.)
  if (fromRiver(course, cx, cz) < 80 && b.kind !== 'boathouse') {
    let count = 0;
    for (let i = 0; i < ring.length && count < 60; i++) {
      const [ax, az] = ring[i];
      const [bx, bz] = ring[(i + 1) % ring.length];
      const len = Math.hypot(bx - ax, bz - az);
      let n = [bz - az, -(bx - ax)].map((v) => v / len);
      if (n[0] * ((ax + bx) / 2 - cx) + n[1] * ((az + bz) / 2 - cz) < 0) n = n.map((v) => -v);
      if (len < 3 || n[0] * toward[0] + n[1] * toward[1] < 0.3) continue;
      const across = Math.floor((len - 1) / 2.8);
      for (let f = 0; f * 3 + 2.4 < b.height; f++) {
        for (let k = 0; k < across; k++) {
          const mid = (k + 0.5) / across;
          const half = 0.6 / len;
          const pt = (t, y) => [ax + (bx - ax) * t + n[0] * 0.06, y, az + (bz - az) * t + n[1] * 0.06];
          const [y1, y2] = [g.y + f * 3 + 1, g.y + f * 3 + 2.3];
          m.triFacing(pt(mid - half, y1), pt(mid + half, y1), pt(mid + half, y2), COLORS.window, [n[0], 0, n[1]]);
          m.triFacing(pt(mid - half, y1), pt(mid + half, y2), pt(mid - half, y2), COLORS.window, [n[0], 0, n[1]]);
          count++;
        }
      }
    }
  }
  if (b.kind === 'boathouse' && fromRiver(course, cx, cz) < 45) pontoon(m, course, river, Math.min(30, Math.max(15, Math.sqrt(area(ring)) * 2)));
  if (clap && fromRiver(course, cx, cz) < 80) clapboardFront(m, course, facing(course, ring, cx, cz, g), b.height);
  const pitched = b.kind === 'house' || b.kind === 'boathouse';
  const roof = clap ? CLAP.roof : pitched ? ROOFS[Math.floor(rand() * ROOFS.length)] : COLORS.coping;
  const peak = [cx, top + (pitched ? Math.min(4, 1.5 + Math.sqrt(area(ring)) * 0.18) : 0), cz];
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    m.tri([ax, top, az], [bx, top, bz], peak, roof);
  }
}

// --- landmarks, modelled from the frames ---------------------------------------

// A footprint squared up to face the river: `at(x, y, z)` is x metres along
// the bank, y up from the ground and z towards the water, from the middle of
// the footprint; `along` and `depth` are its extents ([min, max]).
// With `bank`, it's turned square to the mapped bank in front (its line 15 m
// either side), as the clubs are, instead of to the river line, and `edge` is
// straight out to that bank.
function facing(course, ring, cx, cz, g, bank = false) {
  const p = pointAt(course, locate(course, cx, cz).s);
  const len = Math.hypot(p.x - cx, p.z - cz) || 1;
  let fwd = [(p.x - cx) / len, (p.z - cz) / len];
  let right = [-fwd[1], fwd[0]];
  const out = (x) => {
    let d = 0;
    while (d < 80 && !course.land.inside(cx + right[0] * x + fwd[0] * d, cz + right[1] * x + fwd[1] * d)) d += 0.25;
    return d;
  };
  let straight = null;
  if (bank && course.land?.rings) {
    const [e0, e1] = [out(-15), out(15)];
    const k = Math.hypot(30, e1 - e0);
    right = [0, 1].map((i) => (right[i] * 30 + fwd[i] * (e1 - e0)) / k);
    fwd = [right[1], -right[0]];
    straight = out(0);
  }
  const xs = ring.map(([x, z]) => (x - cx) * right[0] + (z - cz) * right[1]);
  const zs = ring.map(([x, z]) => (x - cx) * fwd[0] + (z - cz) * fwd[1]);
  const origin = [cx, g.y, cz];
  const toWater = len - widthAt(course, locate(course, cx, cz).s).half;
  return {
    origin, right, fwd, toWater,
    // Where the water starts in front: the mapped bank where there is one.
    edge: straight ?? (course.land?.rings ? Math.min(toWater, course.land.shore(cx, cz)) : toWater),
    along: [Math.min(...xs), Math.max(...xs)], depth: [Math.min(...zs), Math.max(...zs)],
    at: (x, y, z) => [cx + right[0] * x + fwd[0] * z, g.y + y, cz + right[1] * x + fwd[1] * z],
    box: (m, xr, yr, zr, color) => orientedBox(m, origin, right, fwd, xr, yr, zr, color),
  };
}

const xz = (p) => [p[0], p[2]];

// The frame a landmark is built in (facing's), for tests and for putting a
// camera in front of it.
export function landmarkFrame(course, style) {
  const river = course.scenery?.river ?? course;
  river.land ??= waterMap(course.scenery?.water ?? []);
  const b = course.scenery?.buildings?.find((x) => x.style === style);
  if (!b) return null;
  const ring = b.shape[0][0] === b.shape.at(-1)[0] && b.shape[0][1] === b.shape.at(-1)[1] ? b.shape.slice(0, -1) : b.shape;
  const cx = ring.reduce((a, q) => a + q[0], 0) / ring.length;
  const cz = ring.reduce((a, q) => a + q[1], 0) / ring.length;
  return landmarkFacing(river, style, ring, cx, cz, ground(river, cx, cz));
}
// The one place a landmark's frame is made, for building it and for landmarkFrame.
function landmarkFacing(river, style, ring, cx, cz, g) {
  return facing(river, ring, cx, cz, g, BANKED.has(style));
}
const BANKED = new Set(['rowing-club', 'canoe-club', 'boatyard']); // landmarks squared to their bank (see facing)

const CLUB = {
  render: [0.94, 0.93, 0.89],
  tiles: [0.58, 0.27, 0.19],
  rail: [0.5, 0.22, 0.17],
  dark: [0.16, 0.17, 0.19],
  brick: [0.58, 0.29, 0.21],
  band: [0.86, 0.8, 0.66],
  door: [0.33, 0.34, 0.36],
  board: [0.95, 0.95, 0.93],
  hard: [0.74, 0.72, 0.67],
  piling: [0.45, 0.41, 0.34],
  slate: [0.24, 0.25, 0.27],
  blue: [0.1, 0.24, 0.6],
  stained: [0.42, 0.45, 0.36],
  pontoon: [0.62, 0.62, 0.6],
  glazing: [0.22, 0.3, 0.36],
  balcony: [0.62, 0.72, 0.76],
};
const POSTS = { concrete: [0.6, 0.59, 0.55], cap: [0.5, 0.49, 0.46], green: [0.3, 0.34, 0.24] };
const ANGLER = {
  coats: [[0.22, 0.32, 0.2], [0.3, 0.3, 0.32], [0.45, 0.38, 0.22]], trousers: [0.2, 0.22, 0.2], skin: [0.85, 0.66, 0.52],
  hat: [0.25, 0.3, 0.2], stool: [0.2, 0.3, 0.18], pole: [0.3, 0.3, 0.3], brolly: [0.2, 0.36, 0.2], tackle: [0.75, 0.75, 0.7],
  rod: [0.12, 0.12, 0.12], line: [0.92, 0.92, 0.85], float: [0.98, 0.35, 0.05],
};
const TATTY = {
  hulls: [[0.88, 0.85, 0.74], [0.82, 0.8, 0.72], [0.9, 0.9, 0.86], [0.78, 0.8, 0.82]],
  strakes: [[0.45, 0.2, 0.15], [0.2, 0.3, 0.45], [0.35, 0.33, 0.3]],
  tarps: [[0.25, 0.42, 0.25], [0.22, 0.35, 0.55], [0.55, 0.55, 0.52], [0.6, 0.5, 0.3]],
  cabin: [0.84, 0.82, 0.74], rust: [0.5, 0.28, 0.14], flag: [0.75, 0.12, 0.12], dinghy: [0.85, 0.5, 0.15],
};
const GREY = { wall: [0.76, 0.77, 0.76], shutter: [0.84, 0.85, 0.84], seam: [0.6, 0.61, 0.6], roof: [0.55, 0.57, 0.58], launch: [0.12, 0.3, 0.75] };
const VILLA = {
  board: [0.56, 0.63, 0.7], shadow: [0.48, 0.54, 0.6], slate: [0.3, 0.32, 0.36], coping: [0.85, 0.83, 0.78],
  urn: [0.8, 0.76, 0.68], plant: [0.72, 0.62, 0.25], window: [0.55, 0.65, 0.72],
};

// Reading Rowing Club, as the footage shows it from the water (x runs
// downstream): a long boathouse under a brown hipped roof with a white cupola,
// the brick ground floor's boat bays under a weathered timber balcony with
// X-braced railings, its stair coming down the front at the balcony's upstream
// end, a white upper storey with a band of windows over a blue door, and a
// white cross-wing upstream with its gable to the river. In front, a tarmac
// path along a low stone-faced bank, and a modular plastic pontoon, green with
// yellow floats on its bank side.
// Colours measured from the frames (overcast ones, scaled so the white walls are white).
export const ROWING = {
  brick: [0.52, 0.31, 0.25], band: [0.5, 0.42, 0.37], plinth: [0.36, 0.26, 0.23], render: [0.93, 0.93, 0.9],
  roof: [0.45, 0.29, 0.24], trim: [0.12, 0.27, 0.6], timber: [0.52, 0.5, 0.46], post: [0.45, 0.42, 0.38],
  beam: [0.24, 0.22, 0.2], window: [0.3, 0.36, 0.4], door: [0.1, 0.27, 0.5], path: [0.47, 0.45, 0.42],
  stone: [0.66, 0.62, 0.54], pontoon: [0.2, 0.38, 0.33], float: [0.8, 0.68, 0.3], hedge: [0.17, 0.27, 0.1],
  banner: [0.96, 0.95, 0.92], red: [0.75, 0.12, 0.15], navy: [0.14, 0.14, 0.42], rail: [0.15, 0.3, 0.65], gantry: [0.2, 0.45, 0.25],
  yellow: [0.88, 0.75, 0.2],
  // The downstream end, from the car park (the owner's photo).
  base: [0.3, 0.21, 0.19], course: [0.58, 0.25, 0.17], tarmac: [0.27, 0.27, 0.28], paving: [0.42, 0.37, 0.35],
  vent: [0.42, 0.42, 0.42], alarm: [0.85, 0.2, 0.15], kiosk: [0.5, 0.26, 0.2], moss: [0.45, 0.38, 0.27],
};
// Where the rowing club's parts stand in its frame (shared with its car park, carPark).
function rowingPlan(course, f) {
  const [west, east] = [Math.max(f.along[0], -19), Math.min(f.along[1], 19)];
  const wall = Math.min(f.depth[1] - 2.4, f.edge - 8); // the front wall; the balcony stands out over the path
  const back = Math.max(f.depth[0], wall - 13);
  // The downstream end bay: a gable as wide as the boathouse, its boat doors
  // to the car park; the boat hall reaches back from the long block on the land side.
  const [x0, zb] = [east - 4, Math.max(f.depth[0], wall - 20)];
  const floor = ground(course, ...xz(f.at(0, 0, wall))).y - f.origin[1]; // the path in front, at the wall
  return { west, east, wall, back, x0, zb, floor };
}
const PARK = { long: 22 }; // how far the car park runs out from the club's downstream end
// Its three boat doors, across the end wall from its middle (+z the river side), and their half width.
export const ROWING_DOORS = { at: [-6.9, -0.4, 6.2], half: 1.35 };
// The rowing club's car park, where the walk starts: `at(x, y, z)` is x out
// from the club's downstream end wall, z across it from its middle (+z towards
// the river), y up from the car park.
export function rowingEnd(course) {
  const f = landmarkFrame(course, 'rowing-club');
  if (!f) return null;
  const p = rowingPlan(course.scenery?.river ?? course, f);
  const zm = (p.zb + p.wall) / 2;
  return { at: (x, y, z) => f.at(p.east + x, p.floor + y, zm + z), half: (p.wall - p.zb) / 2, long: PARK.long };
}
function rowingClub(m, course, f) {
  const C = ROWING;
  const { west, east, wall, back, x0, zb, floor } = rowingPlan(course, f);
  const sea = -f.origin[1];
  const top = sea + 0.65; // the bank's edge, a little over the pontoon
  const [wing, stair] = [west + (east - west) * 0.3, east - (east - west) * 0.38]; // the cross-wing's downstream side; the stair's top
  const [g1, eave] = [floor + 3.1, floor + 5.2]; // first floor, eaves: just over the balcony's railing
  // The long block: brick below, white above.
  // Dark red brick, a band of greyer brick low down, a darker plinth.
  f.box(m, [wing, x0], [floor - 1, floor + 0.7], [back + 0.2, wall], C.plinth);
  f.box(m, [wing, x0], [floor + 0.7, floor + 1.3], [back + 0.2, wall], C.band);
  f.box(m, [wing, x0], [floor + 1.3, g1], [back + 0.2, wall], C.brick);
  f.box(m, [wing, x0], [g1, eave], [back, wall + 0.1], C.render);
  // The eaves: a deep white board, coved out, with a blue line along its top.
  f.box(m, [wing, x0 + 0.4], [eave - 0.3, eave], [back - 0.4, wall + 0.4], C.render);
  f.box(m, [wing, x0 + 0.7], [eave, eave + 0.55], [back - 0.7, wall + 0.75], C.render);
  f.box(m, [wing, x0 + 0.72], [eave + 0.55, eave + 0.65], [back - 0.72, wall + 0.77], C.trim);
  endBay(m, f, { east, wall, x0, zb, floor, wing: west, back, eave });
  // Upstairs windows: behind the balcony, and a band over the door.
  const pane = (x0, x1, y0, y1) => {
    f.box(m, [x0 - 0.08, x1 + 0.08], [y0 - 0.08, y1 + 0.08], [wall + 0.1, wall + 0.13], COLORS.white);
    f.box(m, [x0, x1], [y0, y1], [wall + 0.13, wall + 0.15], C.window);
  };
  for (let x = stair + 0.8; x < x0 - 1; x += 1.6) pane(x, x + 1.3, g1 + 0.4, eave - 0.35);
  for (let k = 0; k < 4; k++) pane(wing + 2.5 + k * 1.6, wing + 3.9 + k * 1.6, g1 + 0.8, eave - 0.35);
  f.box(m, [stair - 2.6, stair - 1.4], [floor, floor + 2.2], [wall, wall + 0.05], COLORS.white);
  f.box(m, [stair - 2.5, stair - 1.5], [floor, floor + 2.1], [wall + 0.05, wall + 0.08], C.door);
  // The balcony: a deck on timber posts, X-braced railing panels between them.
  const out = wall + 2.4;
  f.box(m, [stair, east], [g1 - 0.1, g1], [wall, out], C.timber);
  f.box(m, [stair, east], [g1 - 0.45, g1 - 0.1], [out - 0.3, out], C.beam); // the beam carrying it
  for (let x = stair, k = 0; x <= east + 0.01; x += (east - stair) / 7, k++) {
    f.box(m, [x - 0.08, x + 0.08], [floor, g1 + 1.1], [out - 0.2, out - 0.04], k % 3 === 1 ? C.post : COLORS.white);
    for (const e of [-1, 1]) beam(m, f.at(x, g1 - 1.2, out - 0.12), f.at(x + e * 0.9, g1 - 0.45, out - 0.12), 0.06, C.post);
  }
  // Floodlights on the railing.
  for (const x of [stair + 3, (stair + east) / 2 + 1.5, east - 3.5]) f.box(m, [x - 0.2, x + 0.2], [g1 + 1.12, g1 + 1.42], [out - 0.3, out + 0.1], C.beam);
  f.box(m, [stair, east], [g1 + 1, g1 + 1.12], [out - 0.2, out], C.timber);
  for (let x = stair; x < east - 0.5; x += 1.6) {
    beam(m, f.at(x, g1, out - 0.1), f.at(x + 1.6, g1 + 1, out - 0.1), 0.05, C.timber);
    beam(m, f.at(x, g1 + 1, out - 0.1), f.at(x + 1.6, g1, out - 0.1), 0.05, C.timber);
  }
  // The stair down the front, upstream from the balcony's end: stringers,
  // treads, and a braced side.
  const [foot, sz0, sz1] = [stair - 4.6, out - 1.3, out];
  for (const z of [sz0, sz1 - 0.1]) beam(m, f.at(stair, g1, z), f.at(foot, floor, z), 0.09, C.timber);
  for (let k = 1; k < 14; k++) {
    const t = k / 14;
    const x = stair + (foot - stair) * t;
    f.box(m, [x - 0.17, x + 0.17], [g1 + (floor - g1) * t - 0.05, g1 + (floor - g1) * t], [sz0, sz1], C.timber);
  }
  beam(m, f.at(stair, g1 + 1, sz1 - 0.05), f.at(foot + 0.6, floor + 1, sz1 - 0.05), 0.05, C.timber);
  for (let t = 0; t < 0.9; t += 0.3) {
    const [xa, xb] = [stair + (foot - stair) * t, stair + (foot - stair) * (t + 0.3)];
    const [ya, yb] = [g1 + (floor - g1) * t, g1 + (floor - g1) * (t + 0.3)];
    beam(m, f.at(xa, ya, sz1 - 0.05), f.at(xb, yb + 1, sz1 - 0.05), 0.04, C.timber);
    beam(m, f.at(xa, ya + 1, sz1 - 0.05), f.at(xb, yb, sz1 - 0.05), 0.04, C.timber);
  }
  // The roof, hipped at the downstream end, and the cupola on its ridge.
  roof(m, f, (x0 - wing) / 2 + 0.6, [back - 0.6, wall + 0.7], eave + 0.65, 5.4, C.roof, (wing + x0) / 2);
  const mid = (back + wall) / 2;
  const cx = wing + (x0 - wing) * 0.62;
  f.box(m, [cx - 0.7, cx + 0.7], [eave + 5.6, eave + 7], [mid - 0.7, mid + 0.7], C.render);
  m.cone(f.at(cx, eave + 7, mid), 1.05, 1.1, 4, C.roof);
  // The cross-wing: white, its gable to the river, the roof sweeping low on
  // its upstream side.
  const [wz0, wz1] = [back, wall + 0.8];
  const ridge = west + (wing - west) * 0.45;
  f.box(m, [west, wing], [floor - 1, eave - 0.3], [wz0, wz1], C.render);
  const apex = eave + 4;
  const low = floor + 3.4;
  for (const [x, y] of [[west - 0.6, low], [wing + 0.6, eave - 0.4]]) {
    const run = [f.at(x, y, wz0 - 0.5), f.at(x, y, wz1 + 0.5), f.at(ridge, apex, wz1 + 0.5), f.at(ridge, apex, wz0 - 0.5)];
    m.tri(run[0], run[1], run[2], C.roof);
    m.tri(run[0], run[2], run[3], C.roof);
  }
  for (const [z, e] of [[wz1, 1], [wz0, -1]]) {
    m.triFacing(f.at(west, low, z), f.at(wing, eave - 0.3, z), f.at(ridge, apex - 0.15, z), C.render, [f.fwd[0] * e, 0, f.fwd[1] * e]);
  }
  f.box(m, [west + 1, west + 1.1], [low, eave - 0.3], [wz1, wz1 + 0.02], C.render);
  for (const [x0, x1, y0, y1] of [[ridge - 1, ridge + 1, eave + 0.4, eave + 1.5], [west + 2, west + 4.4, g1 + 0.8, g1 + 2.2], [wing - 4, wing - 1.4, g1 + 0.8, g1 + 2.2]]) {
    f.box(m, [x0, x1], [y0, y1], [wz1, wz1 + 0.04], C.window);
  }
  beam(m, f.at(west - 0.6, low, wz1 + 0.5), f.at(ridge, apex, wz1 + 0.5), 0.12, C.roof.map((v) => v * 0.7));
  beam(m, f.at(ridge, apex, wz1 + 0.5), f.at(wing + 0.6, eave - 0.4, wz1 + 0.5), 0.12, C.roof.map((v) => v * 0.7));
  // A hedge in front of the wing.
  hedge(m, f, [west - 4, wing - 0.5], [floor - 0.5, floor + 1.9], [wz1 + 1, wz1 + 2.6], C.hedge);
  backDoors(m, course, f, [-12, -4, 4, 12].filter((x) => x > west + 1 && x < x0 - 1), floor, zb, C.door);
  // The path, down to the bank's stone face, and the pontoon along it.
  const edge = f.edge;
  const [px0, px1] = [west - 8, east + 8];
  const apron = [f.at(px0, floor + 0.04, wall), f.at(px1, floor + 0.04, wall), f.at(px1, top, edge - 0.5), f.at(px0, top, edge - 0.5)];
  m.tri(apron[0], apron[1], apron[2], C.path);
  m.tri(apron[0], apron[2], apron[3], C.path);
  // Rock-faced stone blocks along the edge, a little proud of the path.
  f.box(m, [px0, px1], [sea - 0.8, top], [edge - 0.5, edge + 0.1], C.stone);
  for (let x = px0, k = 0; x < px1; x += 0.8, k++) {
    const lift = (k % 4) * 0.03;
    pillow(m, f, [x + 0.03, x + 0.77], [top - 0.05, top + 0.3 + lift], [edge - 0.95, edge + 0.05], 0.13, C.stone.map((v) => v * (k % 3 === 1 ? 0.9 : k % 3 === 2 ? 1.05 : 1)));
  }
  // The pontoon: plastic cubes, green, the yellow ones along its bank side.
  const [p0, p1] = [west - 2, east + 2];
  f.box(m, [p0, p1], [sea - 0.3, sea + 0.32], [edge + 0.1, edge + 0.7], C.float);
  f.box(m, [p0, p1], [sea - 0.3, sea + 0.4], [edge + 0.7, edge + 4.6], C.pontoon);
  for (let x = p0 + 1; x < p1; x += 1) f.box(m, [x - 0.03, x + 0.03], [sea + 0.4, sea + 0.41], [edge + 0.7, edge + 4.6], C.pontoon.map((v) => v * 0.75));
  for (let z = edge + 1.7; z < edge + 4.6; z += 1) f.box(m, [p0, p1], [sea + 0.4, sea + 0.41], [z - 0.03, z + 0.03], C.pontoon.map((v) => v * 0.75));
  // Round hatches on the cubes.
  for (let x = p0 + 1.2, k = 0; x < p1 - 0.5; x += 2.3, k++) {
    disc(m, f.at(x, sea + 0.415, edge + 1.6 + (k % 2) * 1.8), 0.22, C.pontoon.map((v) => v * 0.55));
  }
  // A low blue railing of hoops along the edge downstream of the pontoon.
  for (let x = p1 + 0.5; x < p1 + 14; x += 0.9) f.box(m, [x, x + 0.05], [top + 0.2, top + 0.85], [edge - 0.7, edge - 0.66], C.rail);
  f.box(m, [p1 + 0.5, p1 + 14], [top + 0.82, top + 0.88], [edge - 0.72, edge - 0.64], C.rail);
  // At its upstream end, a green frame over the path with a yellow top bar, and a sign on a post.
  const gx = west - 1;
  for (const z of [wall + 4, edge - 0.9]) f.box(m, [gx - 0.1, gx + 0.1], [top, floor + 3.2], [z - 0.1, z + 0.1], C.gantry);
  f.box(m, [gx - 0.12, gx + 0.12], [floor + 3, floor + 3.12], [wall + 3.9, edge - 0.8], C.gantry);
  f.box(m, [gx - 0.12, gx + 0.12], [floor + 3.12, floor + 3.3], [wall + 3.9, edge - 0.8], C.yellow);
  f.box(m, [gx - 1.6, gx - 1.5], [top, top + 2.4], [edge - 1.2, edge - 1.1], C.post);
  f.box(m, [gx - 2, gx - 1.1], [top + 1.3, top + 2.3], [edge - 1.1, edge - 1.06], COLORS.white);
  // The club's banner on the railing at the downstream end, white with its name in red.
  f.box(m, [east - 7.4, east - 1.2], [g1 + 0.05, g1 + 1.05], [out + 0.02, out + 0.05], C.banner);
  sign(m, f, 'READING ROWING CLUB', east - 4.3, g1 + 0.55, out + 0.05, null, C.navy, 0.075);
  f.box(m, [east - 6.8, east - 1.8], [g1 + 0.3, g1 + 0.38], [out + 0.05, out + 0.07], C.red);
  f.box(m, [east - 6.8, east - 1.8], [g1 + 0.15, g1 + 0.22], [out + 0.05, out + 0.07], C.red);
}

// The rowing club's downstream end, as the owner's photo shows it from the car
// park (and Caversham Bridge sees it): one broad white weatherboarded gable,
// low eaves both sides, its top clipped back into a little hip, blue
// bargeboards on white brackets; a dark brick base with a red course, three
// white boat doors with a blue band, a window high up, the crest and the name
// board between. The boat hall runs back from it behind the long block under a
// lower roof, a little brick kiosk stands at its land-side corner, and the car
// park is in front.
function endBay(m, f, { east, wall, x0, zb, floor, wing, back, eave }) {
  const C = ROWING;
  const [x1, zf] = [east, wall];
  const [zm, half] = [(zb + zf) / 2, (zf - zb) / 2];
  const [low, ridge, clip, ov, hip] = [floor + 3.6, floor + 10.2, floor + 8, 0.6, 2.4];
  const pitch = (ridge - low) / half;
  const span = (y) => (ridge - y) / pitch; // the gable's half width at a height
  const w = span(clip);
  const toEnd = [f.right[0], 0, f.right[1]];
  // Walls: the base, then white boarding.
  f.box(m, [x0, x1], [floor - 1, floor + 1.9], [zb, zf], C.base);
  f.box(m, [x0, x1], [floor + 1.9, low], [zb, zf], C.render);
  for (const [x, e] of [[x1, 1], [x0, -1]]) {
    const P = (z, y) => f.at(x, y, z);
    const dir = toEnd.map((v) => v * e);
    m.triFacing(P(zb, low), P(zf, low), P(zm + w, clip), C.render, dir);
    m.triFacing(P(zb, low), P(zm + w, clip), P(zm - w, clip), C.render, dir);
  }
  // The roof: a slope each side down to the low eaves, the clipped hip at the end.
  const eaveY = low - ov * pitch;
  const tip = f.at(x1 + ov - hip, ridge, zm);
  for (const e of [1, -1]) {
    const ez = zm + e * (half + ov);
    const n = [f.fwd[0] * e, 1.5, f.fwd[1] * e];
    const [a, b, c, d] = [f.at(x0 - 0.3, eaveY, ez), f.at(x1 + ov, eaveY, ez), f.at(x1 + ov, clip, zm + e * w), f.at(x0 - 0.3, ridge, zm)];
    const color = e > 0 ? C.roof : C.roof.map((v) => v * 0.92);
    m.triFacing(a, b, c, color, n);
    m.triFacing(a, c, tip, color, n);
    m.triFacing(a, tip, d, color, n);
    // Blue bargeboards up both verges and along the eaves, on white brackets.
    beam(m, b, c, 0.1, C.trim);
    beam(m, a, f.at(x0 - 0.3, clip, zm + e * w), 0.1, C.trim);
    beam(m, a, b, 0.08, C.trim);
    for (const t of [0.12, 0.32, 0.52, 0.72]) {
      const z = zm + e * (half - (half - w) * t);
      const y = ridge - Math.abs(z - zm) * pitch;
      f.box(m, [x1, x1 + ov - 0.12], [y - 0.42, y - 0.1], [z - 0.07, z + 0.07], C.render);
    }
  }
  m.triFacing(f.at(x1 + ov, clip, zm - w), f.at(x1 + ov, clip, zm + w), tip, C.roof.map((v) => v * 0.85), [f.right[0], 1.5, f.right[1]]);
  beam(m, f.at(x1 + ov, clip, zm - w), f.at(x1 + ov, clip, zm + w), 0.1, C.trim);
  // The end wall: the red course over the base, red piers between the doors.
  const face = (zr, yr, color, d = 0.03, at = 0) => f.box(m, [x1 + at, x1 + at + d], yr, zr, color);
  face([zb, zf], [floor + 1.75, floor + 1.9], C.course);
  for (const z of [zm - 3.6, zm + 2.9]) face([z - 0.2, z + 0.2], [floor, floor + 1.9], C.course);
  // Three white boat doors, a blue band across and along the top.
  for (const z of ROWING_DOORS.at.map((d) => zm + d)) {
    const h = ROWING_DOORS.half;
    face([z - h, z + h], [floor, floor + 2.9], C.render, 0.06);
    face([z - h + 0.02, z + h - 0.02], [floor + 1.8, floor + 2], C.trim, 0.02, 0.06);
    face([z - h, z + h], [floor + 2.78, floor + 2.9], C.trim, 0.02, 0.06);
  }
  // The window high in the gable, vents and the alarm box beside it, the crest under it.
  face([zm - 1.85, zm + 1.85], [floor + 5.1, floor + 6.4], C.render, 0.08);
  face([zm - 1.75, zm + 1.75], [floor + 5.2, floor + 6.3], C.beam, 0.02, 0.08);
  face([zm - 0.58, zm - 0.48], [floor + 5.2, floor + 6.3], C.render, 0.03, 0.08);
  for (const z of [zm - 4.2, zm - 1.6, zm + 1.3]) face([z - 0.25, z + 0.25], [floor + 6.7, floor + 7.1], C.vent, 0.05);
  face([zm - 0.55, zm - 0.3], [floor + 6.75, floor + 7.05], C.alarm, 0.12);
  face([zm - 0.45, zm + 0.45], [floor + 4, floor + 4.9], C.banner, 0.05);
  face([zm - 0.25, zm + 0.25], [floor + 4.2, floor + 4.7], C.float, 0.01, 0.05);
  // The name board: sign() writes on a face towards +z, so turn the frame to the end wall.
  const end = { at: (x, y, z) => f.at(z, y, -x), box: (mm, xr, yr, zr, color) => f.box(mm, zr, yr, [-xr[1], -xr[0]], color) };
  sign(m, end, 'READING ROWING CLUB', -zm, floor + 3.45, x1 + 0.08, C.banner, C.beam, 0.055);
  // Brick ramp walls at both corners, sloping down into the car park.
  for (const [z0, z1] of [[zb, zb + 0.35], [zf - 0.35, zf]]) {
    const top = (z) => [f.at(x1, floor + 1.9, z), f.at(x1, floor, z), f.at(x1 + 2.2, floor, z)];
    const [p, q] = [top(z0), top(z1)];
    m.triFacing(...p, C.base, [-f.fwd[0], 0, -f.fwd[1]]);
    m.triFacing(...q, C.base, [f.fwd[0], 0, f.fwd[1]]);
    m.triFacing(p[0], q[0], q[2], C.course, [f.right[0], 1, f.right[1]]);
    m.triFacing(p[0], q[2], p[2], C.course, [f.right[0], 1, f.right[1]]);
  }
  // The boat hall behind, on the land side of the long block, under a lower roof.
  f.box(m, [wing, x0], [floor - 1, floor + 1.9], [zb, back], C.base);
  f.box(m, [wing, x0], [floor + 1.9, low], [zb, back], C.render);
  const up = eave + 0.3;
  const hall = [f.at(wing - 0.4, eaveY, zb - ov), f.at(x0, eaveY, zb - ov), f.at(x0, up, back), f.at(wing - 0.4, up, back)];
  const hn = [-f.fwd[0], 2.5, -f.fwd[1]];
  m.triFacing(hall[0], hall[1], hall[2], C.roof.map((v) => v * 0.92), hn);
  m.triFacing(hall[0], hall[2], hall[3], C.roof.map((v) => v * 0.92), hn);
  m.triFacing(f.at(wing, low, zb), f.at(wing, low, back), f.at(wing, up, back), C.render, [-f.right[0], 0, -f.right[1]]);
  beam(m, hall[0], hall[1], 0.08, C.trim);
  // The kiosk at the land-side corner: red-brown brick, a mossy hipped roof.
  f.box(m, [x1 - 6.5, x1 + 0.3], [floor - 0.5, floor + 2.6], [zb - 6, zb], C.kiosk);
  roof(m, f, 3.8, [zb - 6.4, zb + 0.2], floor + 2.6, 1.5, C.moss, x1 - 3.1);
  f.box(m, [x1 + 0.3, x1 + 0.36], [floor, floor + 2.1], [zb - 1.6, zb - 0.7], C.render);
  // The car park: tarmac, block paving along the wall.
  f.box(m, [x1, x1 + PARK.long], [floor - 0.3, floor + 0.04], [zb - 6, zf], C.tarmac);
  f.box(m, [x1, x1 + 2.5], [floor - 0.3, floor + 0.05], [zb, zf], C.paving);
  // White bay lines along its far side, so it reads as a car park.
  for (let z = zb - 5; z < zf - 2; z += 2.6) f.box(m, [x1 + 6, x1 + 11], [floor + 0.04, floor + 0.06], [z - 0.05, z + 0.05], COLORS.white);
}

// Reading Canoe Club, as the footage shows it from the water (x runs
// upstream): a two-storey red-brick boathouse with four roller doors. Upstream,
// a wing with a first-floor balcony behind white railings under a low roof's
// deep eaves; then a gable to the river with white bargeboards over another
// balcony, the club's name (blue on a white board) over a glass door at its
// side; downstream, a longer wing with a glazed corner room upstairs. In
// front: wide concrete steps down to the water at the upstream end, a hedge
// along the rest, two big trees, and a grey tube pontoon along the bank.
export const CANOE = {
  brick: [0.63, 0.37, 0.27], buff: [0.85, 0.72, 0.52], navy: [0.08, 0.12, 0.4], door: [0.3, 0.27, 0.24], rail: [0.95, 0.95, 0.93],
  soffit: [0.88, 0.87, 0.84], fascia: [0.3, 0.27, 0.26], roof: [0.3, 0.27, 0.27], window: [0.33, 0.4, 0.48],
  concrete: [0.6, 0.58, 0.54], glass: [0.5, 0.57, 0.64], cap: [0.55, 0.53, 0.5], tube: [0.86, 0.88, 0.9], deck: [0.3, 0.29, 0.27],
  hedge: [0.17, 0.27, 0.1], leaves: [[0.27, 0.36, 0.14], [0.22, 0.31, 0.12], [0.33, 0.38, 0.16]],
};
function canoeClub(m, course, f) {
  const C = CANOE;
  const [lo, hi] = [Math.max(f.along[0], -21), Math.min(f.along[1], 14)];
  const edge = f.edge;
  const front = Math.min(f.depth[1], edge - 9); // a paved forecourt, then the bank and its steps
  const back = Math.max(f.depth[0], front - 11);
  const sea = -f.origin[1];
  // Its forecourt stands two metres over the water, up a flight of steps.
  const floor = Math.max(ground(course, ...xz(f.at(0, 0, front))).y - f.origin[1], sea + 2);
  const [g1, eave] = [floor + 3.2, floor + 6.4];
  const top = sea + 0.75; // the bank's capping
  // The sections along the front (x upstream): the upstream wing, the gable, the downstream wing.
  const [a, b] = [hi - 9, hi - 17];
  // Ground floor and upstairs back walls; the balconies are set into the front.
  f.box(m, [lo, hi], [floor - 1, g1], [back, front], C.brick);
  f.box(m, [lo, hi], [g1, eave], [back, front - 2], C.brick);
  // Downstream, the wing bows out towards the river: three faces, a roller
  // door in each, a band of big white-framed windows over them, buff brick
  // bands at the door heads and the sills.
  const third = (b - lo) / 3;
  const bow = [0.5, 1.2, 0.5];
  for (let k = 0; k < 3; k++) {
    const [x0, x1, z] = [lo + k * third, lo + (k + 1) * third, front + bow[k]];
    f.box(m, [x0, x1], [floor - 1, eave], [front - 2, z], C.brick);
    roller(x0 + 0.7, x1 - 0.7, z);
    for (const [y0, y1] of [[floor + 2.85, floor + 3.05], [g1 + 0.35, g1 + 0.5], [eave - 0.25, eave - 0.1]]) f.box(m, [x0, x1], [y0, y1], [z, z + 0.03], C.buff);
    f.box(m, [x0 + 0.2, x1 - 0.2], [g1 + 0.5, eave - 0.35], [z, z + 0.03], COLORS.white);
    const panes = Math.round((x1 - x0 - 0.4) / 1.1);
    for (let j = 0; j < panes; j++) {
      const w = (x1 - x0 - 0.4) / panes;
      f.box(m, [x0 + 0.2 + j * w + 0.07, x0 + 0.2 + (j + 1) * w - 0.07], [g1 + 0.6, eave - 0.45], [z + 0.03, z + 0.05], C.glass);
    }
    // Buff quoins up the corners.
    for (let y = floor; y < eave - 0.3; y += 0.6) f.box(m, [x0, x0 + (Math.round(y * 5) % 2 ? 0.45 : 0.25)], [y, y + 0.3], [z, z + 0.035], C.buff);
  }
  // White downpipes at the joints of the bow.
  for (const x of [lo + third, lo + 2 * third]) f.box(m, [x - 0.06, x + 0.06], [floor, eave], [front + 0.55, front + 0.67], COLORS.white);
  // Roller doors: one under the gable, one upstream.
  for (const [x0, x1] of [[b + 2, a - 2.2], [a + 3.6, hi - 0.8]]) roller(x0, x1, front);
  // A roller door under a shallow brick arch.
  function roller(x0, x1, z) {
    const [head, rise] = [floor + 2.55, 0.35];
    f.box(m, [x0, x1], [floor, head], [z, z + 0.05], C.door);
    for (let y = floor + 0.3; y < head; y += 0.3) f.box(m, [x0, x1], [y, y + 0.03], [z + 0.05, z + 0.06], C.door.map((v) => v * 0.8));
    const out = [f.fwd[0], 0, f.fwd[1]];
    const arc = (t) => [x0 + (x1 - x0) * t, head + rise * Math.sin(Math.PI * t)];
    for (let j = 0; j < 6; j++) {
      const [[xa, ya], [xb, yb]] = [arc(j / 6), arc((j + 1) / 6)];
      m.triFacing(f.at(xa, head, z + 0.05), f.at(xb, head, z + 0.05), f.at(xb, yb, z + 0.05), C.door, out);
      m.triFacing(f.at(xa, head, z + 0.05), f.at(xb, yb, z + 0.05), f.at(xa, ya, z + 0.05), C.door, out);
      // The arch: a ring of bricks on end round the head.
      m.triFacing(f.at(xa, ya, z + 0.07), f.at(xb, yb, z + 0.07), f.at(xb, yb + 0.25, z + 0.07), C.brick.map((v) => v * 1.08), out);
      m.triFacing(f.at(xa, ya, z + 0.07), f.at(xb, yb + 0.25, z + 0.07), f.at(xa, ya + 0.25, z + 0.07), C.brick.map((v) => v * 1.08), out);
    }
  }
  for (const [y0, y1] of [[floor + 2.85, floor + 3.05], [eave - 0.25, eave - 0.1]]) f.box(m, [b, hi], [y0, y1], [front, front + 0.03], C.buff);
  // The glass door and the club's name over it, between the gable and the upstream wing.
  f.box(m, [a + 0.3, a + 2.5], [floor, floor + 2.4], [front, front + 0.05], COLORS.white);
  f.box(m, [a + 0.45, a + 2.35], [floor + 0.1, floor + 2.25], [front + 0.05, front + 0.08], COLORS.glass);
  f.box(m, [a - 1.3, a + 4.1], [floor + 2.5, floor + 3.12], [front + 0.05, front + 0.09], CLUB.board);
  sign(m, f, 'READING CANOE CLUB', a + 1.4, floor + 2.61, front + 0.1, null, C.navy, 0.07);
  // Balconies: white railings along the front of both balcony sections.
  for (const [x0, x1] of [[b, a], [a, hi]]) {
    f.box(m, [x0, x1], [g1 - 0.15, g1 + 0.05], [front - 2, front + 0.1], C.concrete);
    f.box(m, [x0, x1], [g1 + 1, g1 + 1.08], [front - 0.04, front + 0.04], C.rail);
    for (let x = x0 + 0.15; x < x1; x += 0.25) f.box(m, [x, x + 0.04], [g1 + 0.05, g1 + 1], [front - 0.02, front + 0.02], C.rail);
    for (let x = x0 + 1; x < x1 - 1; x += 2.2) f.box(m, [x, x + 1.4], [g1 + 0.6, g1 + 2.4], [front - 2, front - 1.96], C.window);
  }
  // Upstream: a low roof, its deep white soffit over the balcony.
  f.box(m, [a, hi + 0.6], [eave, eave + 0.45], [back - 0.6, front + 0.9], C.fascia);
  f.box(m, [a, hi + 0.6], [eave - 0.02, eave], [front - 2, front + 0.9], C.soffit);
  roof(m, f, (hi + 0.6 - a) / 2, [back - 0.6, front + 0.9], eave + 0.45, 1.4, C.roof, (a + hi + 0.6) / 2);
  // The gable, its ridge running back from the river, on white posts.
  const gx = (a + b) / 2;
  const apex = eave + 2.3;
  for (const x of [b + 0.2, a - 0.4]) f.box(m, [x, x + 0.2], [g1, eave], [front - 0.2, front], C.rail);
  m.triFacing(f.at(b - 0.3, eave, front), f.at(a + 0.3, eave, front), f.at(gx, apex, front), C.brick, [f.fwd[0], 0, f.fwd[1]]);
  for (const [x, y] of [[b - 0.5, eave - 0.2], [a + 0.5, eave - 0.2]]) {
    const run = [f.at(x, y, back), f.at(x, y, front + 0.6), f.at(gx, apex + 0.1, front + 0.6), f.at(gx, apex + 0.1, back)];
    m.tri(run[0], run[1], run[2], C.roof);
    m.tri(run[0], run[2], run[3], C.roof);
    beam(m, f.at(x, y, front + 0.6), f.at(gx, apex + 0.1, front + 0.6), 0.14, COLORS.white);
  }
  // Paler brick laid in diamonds on the gable, and the clock.
  for (const k of [0, 1, 2]) f.box(m, [gx - 0.5 + k * 0.1, gx + 0.5 - k * 0.1], [eave + 0.4 + k * 0.35, eave + 0.6 + k * 0.35], [front, front + 0.03], C.buff);
  m.cylinder(f.at(gx + 2.5, g1 - 0.9, front + 0.02), 0.3, 0.05, 10, COLORS.white);
  // Downstream: the glazed corner room, a deep white fascia and a low hipped roof.
  f.box(m, [lo - 0.8, lo + 3], [g1 + 0.3, eave - 0.2], [front - 0.4, front + 1.4], COLORS.white);
  f.box(m, [lo - 0.7, lo + 2.9], [g1 + 0.45, eave - 0.35], [front - 0.3, front + 1.44], COLORS.glass);
  f.box(m, [lo - 0.9, b], [eave, eave + 0.5], [back - 0.4, front + 1.9], COLORS.white);
  roof(m, f, (b - lo + 0.9) / 2, [back - 0.4, front + 1.9], eave + 0.5, 2, C.roof, (lo - 0.9 + b) / 2);
  // In front: the forecourt; two flights of steps down to the water, one in
  // front of the upstream roller door and a wider one in front of the gable,
  // a hedge clump between them under the name; a hedge along the rest; the
  // bank's capping and the pontoon.
  const stepsFrom = b + 0.3;
  const [x0, x1] = [lo - 6, hi + 26];
  const yard = edge - 3.6;
  f.box(m, [x0, x1], [sea - 0.6, floor + 0.04], [front, yard], C.concrete);
  f.box(m, [x0, b - 0.4], [floor, floor + 0.07], [yard - 2.2, yard], COLORS.grass); // a strip of lawn by the bank
  const steps = 7;
  const flights = [[b + 0.3, a - 0.6], [a + 3.2, hi + 0.4]];
  const stepZ = (k) => [k, k + 1].map((j) => yard + ((edge - 0.3 - yard) * j) / steps);
  for (const [fa, fb] of flights) {
    for (let k = 0; k < steps; k++) {
      const y = floor + ((top - floor) * (k + 1)) / steps;
      f.box(m, [fa, fb], [sea - 0.6, y], stepZ(k), C.concrete.map((v) => v * (k % 2 ? 0.86 : 1)));
    }
    // Brick cheek walls either side, stone-capped.
    for (const x of [fa - 0.35, fb]) {
      for (let k = 0; k < steps; k++) {
        const y = floor + ((top - floor) * k) / steps + 0.45;
        f.box(m, [x, x + 0.35], [sea - 0.6, y], stepZ(k), C.brick);
        f.box(m, [x - 0.03, x + 0.38], [y, y + 0.08], stepZ(k), C.cap);
      }
    }
  }
  // Grass banks down to the water: downstream, between the flights, upstream.
  for (const [xa, xb] of [[x0, b - 0.05], [a - 0.25, a + 2.85], [hi + 0.75, x1]]) {
    const bank = [f.at(xa, floor, yard), f.at(xb, floor, yard), f.at(xb, top, edge - 0.3), f.at(xa, top, edge - 0.3)];
    m.tri(bank[0], bank[1], bank[2], COLORS.grass.map((v) => v * 0.8));
    m.tri(bank[0], bank[2], bank[3], COLORS.grass.map((v) => v * 0.8));
  }
  hedge(m, f, [lo + 4, b - 0.4], [top, floor + 0.35], [edge - 1.7, edge - 0.5], C.hedge);
  hedge(m, f, [a - 0.1, a + 2.7], [floor - 0.6, floor + 0.9], [yard - 0.4, yard + 1.6], C.hedge);
  hedge(m, f, [hi + 3.5, hi + 9], [floor - 0.3, floor + 1.6], [yard - 1, yard + 1.4], C.hedge);
  backDoors(m, course, f, [-12, -4, 4, 12].filter((x) => x > lo + 1 && x < hi - 1), floor, back, CLUB.blue);
  f.box(m, [x0, x1], [sea - 0.8, top], [edge - 0.3, edge], C.cap);
  // A ladder up the bank beside the upstream flight, and its post.
  for (const y of [0.1, 0.45, 0.8]) f.box(m, [a + 2.4, a + 3], [sea + y, sea + y + 0.05], [edge, edge + 0.1], COLORS.white);
  f.box(m, [a + 2.3, a + 2.42], [sea - 0.3, floor + 1.2], [edge + 0.05, edge + 0.17], C.cap);
  f.box(m, [stepsFrom - 1, x1 - 2], [sea - 0.1, sea + 0.15], [edge, edge + 1.2], C.deck);
  tube(m, f.at(stepsFrom - 1, sea + 0.3, edge + 1.45), f.at(x1 - 2, sea + 0.3, edge + 1.45), 0.3, C.tube);
  // The two big trees: one in front of the downstream wing, one upstream.
  // Wide, ragged crowns: a few lumps of leaves round each, overhanging the bank.
  for (const [x, z, h] of [[b - 6, yard - 0.6, 15], [hi + 12, yard + 0.6, 16]]) {
    const at = f.at(x, floor, z);
    m.cylinder([at[0], at[1] - 0.3, at[2]], 0.35, h * 0.5, 6, COLORS.trunk);
    for (const [dx, dy, dz, r, c] of [[0, 0.68, 0, 0.26, 0], [2.6, 0.58, 1.6, 0.2, 1], [-2.8, 0.6, 0.8, 0.19, 2], [0.8, 0.8, -1.5, 0.17, 1], [-1, 0.5, 2.6, 0.16, 0]]) {
      m.sphere(f.at(x + dx, floor + h * dy, z + dz), h * r, C.leaves[c], 3, 6);
    }
  }
  // A motor launch moored along the hedge, under a blue cover.
  const [bx0, bx1] = [lo + 2, lo + 8.5];
  f.box(m, [bx0, bx1], [sea - 0.2, sea + 0.55], [edge + 0.3, edge + 2.3], COLORS.white);
  f.box(m, [bx0 - 0.8, bx0], [sea - 0.1, sea + 0.5], [edge + 0.7, edge + 1.9], COLORS.white);
  f.box(m, [bx0 + 0.6, bx1 - 0.4], [sea + 0.55, sea + 1.05], [edge + 0.45, edge + 2.15], [0.12, 0.3, 0.6]);
  // Upstream of it the bank is overgrown: shrubs down to the water and big trees.
  for (let x = hi + 4, k = 0; x < hi + 34; x += 2.6, k++) {
    const z = edge - 1.6 - (k % 3) * 0.7;
    const r = 2 + ((k * 7) % 5) * 0.3;
    m.sphere(f.at(x, top + r * 0.7, z), r, C.leaves[k % 3].map((v) => v * 1.1), 3, 6);
  }
  for (const [x, h] of [[hi + 20, 14], [hi + 30, 12]]) {
    const at = f.at(x, top, edge - 4);
    m.cylinder([at[0], at[1] - 0.3, at[2]], 0.3, h * 0.5, 6, COLORS.trunk);
    for (const [dx, dy, dz, r, c] of [[0, 0.7, 0, 0.27, 2], [2.4, 0.55, 1.4, 0.2, 0], [-2.2, 0.6, 1, 0.2, 1]]) {
      m.sphere(f.at(x + dx, top + h * dy, edge - 4 + dz), h * r, C.leaves[c], 3, 6);
    }
  }
  // A canoe rack on the grass at the downstream end, a few boats on it.
  const rack = [lo - 4.5, lo - 1.5];
  for (const x of rack) f.box(m, [x - 0.06, x + 0.06], [floor, floor + 1.6], [front + 2, front + 2.12], C.door);
  [[0.9, 0.9, 0.88], [0.2, 0.55, 0.6], [0.85, 0.85, 0.82], [0.25, 0.45, 0.7]].forEach((c, k) => {
    const y = floor + 0.5 + (k % 2) * 0.55;
    f.box(m, [lo - 5.2, lo - 0.8], [y, y + 0.3], [front + 1.5 + Math.floor(k / 2) * 0.7, front + 2 + Math.floor(k / 2) * 0.7], c);
  });
}

// A tall red-brick boathouse on the water (upstream of the canoe club, on the
// same bank): an open boat dock on the ground floor, a white first-floor slab
// and a glass balcony, another on the floor above, a steep dark gable to the
// river with white bargeboards, and white spiral stairs at both ends.
function spiralBoathouse(m, course, f) {
  const half = Math.min(5.5, Math.max(4.5, (f.along[1] - f.along[0]) / 2));
  const front = f.edge; // its dock opens onto the water
  const back = Math.max(f.depth[0], front - 11);
  const sea = -f.origin[1];
  // The dock: brick piers and a back wall, dark inside.
  f.box(m, [-half, half], [sea - 0.5, 3.2], [back, front - 7], CLUB.brick);
  f.box(m, [-half + 1.4, half - 1.4], [sea - 0.4, 3], [front - 7, front - 0.3], CLUB.dark);
  for (const e of [-1, 1]) f.box(m, e < 0 ? [-half, -half + 1.4] : [half - 1.4, half], [sea - 0.5, 3.2], [front - 7, front], CLUB.brick);
  f.box(m, [-half + 1.4, half - 1.4], [sea - 0.3, sea + 0.3], [front - 0.4, front], [0.88, 0.88, 0.86]); // the dock's sill
  // The floors above, each with a white slab and a glass balcony to the river.
  for (const [y0, y1, deep] of [[3.2, 6.4, 0], [6.4, 9.2, 1.2]]) {
    f.box(m, [-half - 0.3, half + 0.3], [y0, y0 + 0.35], [back - 0.3, front + 1.3], COLORS.white);
    f.box(m, [-half, half], [y0 + 0.35, y1], [back, front - 1 - deep], CLUB.brick);
    f.box(m, [-half + 1, half - 1], [y0 + 0.6, y1 - 0.3], [front - 1 - deep, front - 0.95 - deep], CLUB.glazing);
    f.box(m, [-half - 0.3, half + 0.3], [y0 + 0.35, y0 + 1.4], [front + 1.2, front + 1.3], CLUB.balcony);
  }
  // The gable to the river: dark roof, a big window in the end, white bargeboards.
  const [ey, rise] = [9.2, 4.6];
  const z0 = back - 0.4;
  const z1 = front - 1.2 + 0.4;
  const eaves = (x, z) => f.at(x, ey, z);
  const ridge = (z) => f.at(0, ey + rise, z);
  for (const e of [-1, 1]) {
    const o = e * (half + 0.5);
    m.tri(eaves(o, z0), eaves(o, z1), ridge(z1), CLUB.slate);
    m.tri(eaves(o, z0), ridge(z1), ridge(z0), CLUB.slate);
    m.tri(eaves(o, z1), eaves(o, z0), ridge(z0), CLUB.slate); // and its underside
    m.tri(eaves(o, z1), ridge(z0), ridge(z1), CLUB.slate);
    beam(m, f.at(o, ey, z1 + 0.05), f.at(0, ey + rise, z1 + 0.05), 0.12, COLORS.white);
  }
  for (const [z, e] of [[front - 2.2, 1], [back, -1]]) {
    m.triFacing(f.at(-half, ey, z), f.at(half, ey, z), f.at(0, ey + rise - 0.3, z), CLUB.brick, [f.fwd[0] * e, 0, f.fwd[1] * e]);
  }
  m.triFacing(f.at(-1.8, ey + 0.3, front - 2.15), f.at(1.8, ey + 0.3, front - 2.15), f.at(0, ey + 2.9, front - 2.15), CLUB.glazing, [f.fwd[0], 0, f.fwd[1]]);
  // White spiral stairs at both ends, from the dock up to the first floor.
  for (const e of [-1, 1]) {
    const c = [e * (half + 1.1), front - 0.9];
    m.cylinder(f.at(c[0], sea, c[1]), 0.08, 6.6 - sea, 5, COLORS.white);
    let last = null;
    for (let k = 0; k < 16; k++) {
      const a = k * 0.55 * e;
      const y = sea + 0.3 + (k * (6.4 - sea)) / 16;
      const tip = [c[0] + Math.cos(a) * 0.95, c[1] + Math.sin(a) * 0.95];
      beam(m, f.at(c[0], y, c[1]), f.at(tip[0], y, tip[1]), 0.16, COLORS.white);
      const rail = f.at(tip[0], y + 0.9, tip[1]);
      if (last) beam(m, last, rail, 0.03, COLORS.white);
      last = rail;
    }
  }
}

// A long two-storey boathouse in pale grey (just upstream of the spiral one):
// roller shutters below, an open bay where a launch is kept, a balcony with a
// white rail on white pillars above, a grey metal roof, and a blue launch.
function greyBoathouse(m, course, f) {
  const half = Math.min(12, Math.max(9, (f.along[1] - f.along[0]) / 2));
  const front = Math.min(f.depth[1], f.edge - 1.5);
  const back = Math.max(f.depth[0], front - 10);
  const sea = -f.origin[1];
  const split = half * 0.2; // shutters to the left of it, the open bay to the right
  f.box(m, [-half, half], [-1, 3], [back, front - 2.5], GREY.wall);
  f.box(m, [-half, split], [-1, 3], [front - 2.5, front], GREY.wall);
  f.box(m, [split, half], [-1, 2.9], [front - 2.5, front - 2.4], CLUB.dark);
  const doors = 3;
  for (let k = 0; k < doors; k++) {
    const x = -half + 0.6 + (k * (split + half - 0.6)) / doors;
    f.box(m, [x, x + (split + half) / doors - 1], [0, 2.6], [front, front + 0.05], GREY.shutter);
    for (let y = 0.3; y < 2.6; y += 0.3) f.box(m, [x, x + (split + half) / doors - 1], [y, y + 0.03], [front + 0.05, front + 0.07], GREY.seam);
  }
  // The upper floor runs out over the bay on white pillars, with a balcony.
  f.box(m, [-half, half], [3, 3.3], [back, front], COLORS.white);
  for (let x = split + 0.2; x <= half; x += (half - split) / 2) f.box(m, [x - 0.4, x - 0.1], [-0.3, 3], [front - 0.4, front - 0.1], COLORS.white);
  f.box(m, [-half, half], [3.3, 6.2], [back, front - 1.6], GREY.wall);
  for (let x = -half + 1.2; x < half - 1.6; x += 3.2) f.box(m, [x, x + 1.6], [4, 5.5], [front - 1.6, front - 1.55], CLUB.dark);
  f.box(m, [-half, half], [4.2, 4.3], [front - 0.1, front], COLORS.white);
  for (let x = -half; x <= half; x += 2) f.box(m, [x, x + 0.08], [3.3, 4.2], [front - 0.1, front], COLORS.white);
  f.box(m, [-3, 3], [3.6, 4.1], [front + 0.01, front + 0.04], COLORS.white); // a banner on the rail
  roof(m, f, half + 0.5, [back - 0.5, front + 0.3], 6.2, 1.8, GREY.roof);
  // The landing in front, and a blue launch alongside.
  f.box(m, [-half - 2, half + 4], [sea - 0.5, sea + 0.4], [front, f.edge], CLUB.hard);
  f.box(m, [split + 1, half + 1], [sea - 0.2, sea + 0.55], [f.edge + 0.4, f.edge + 2.4], GREY.launch);
  f.box(m, [split + 1.3, half + 0.7], [sea + 0.55, sea + 0.75], [f.edge + 0.6, f.edge + 2.2], COLORS.white);
}

// A grand riverside house well up the reach (by St Mary's Island): grey-blue
// clapboard, white corner boards, bands and window frames, a slate roof with
// dormers, and in front a long stone quay with white bollards and stone urns,
// a white summerhouse and a white timber tower.
function riversideVilla(m, course, f) {
  const half = Math.max(6.5, (f.along[1] - f.along[0]) / 2);
  const front = Math.min(f.depth[1], f.edge - 6);
  const back = Math.min(Math.max(f.depth[0], front - 10), front - 8);
  f.box(m, [-half, half], [-1, 6.2], [back, front], VILLA.board);
  for (let y = 0.4; y < 6.1; y += 0.35) f.box(m, [-half - 0.02, half + 0.02], [y, y + 0.04], [front, front + 0.03], VILLA.shadow);
  for (const y of [-0.2, 3, 6]) f.box(m, [-half - 0.1, half + 0.1], [y, y + 0.25], [back - 0.1, front + 0.1], COLORS.white);
  for (const x of [-half - 0.1, half - 0.25]) f.box(m, [x, x + 0.35], [-0.2, 6.2], [front - 0.1, front + 0.12], COLORS.white);
  for (const y of [0.8, 3.8]) {
    for (let x = -half + 1.2; x < half - 1.4; x += 2.6) {
      f.box(m, [x, x + 1.4], [y, y + 1.6], [front, front + 0.08], COLORS.white);
      f.box(m, [x + 0.12, x + 1.28], [y + 0.12, y + 1.48], [front + 0.08, front + 0.1], COLORS.glass);
    }
  }
  roof(m, f, half + 0.4, [back - 0.4, front + 0.4], 6.2, 3.2, VILLA.slate);
  for (const x of [-half / 2, half / 2]) {
    f.box(m, [x - 0.8, x + 0.8], [6.6, 8], [front - 1.4, front - 0.6], COLORS.white);
    f.box(m, [x - 0.55, x + 0.55], [6.8, 7.8], [front - 0.6, front - 0.58], COLORS.glass);
  }
  // The quay: a stone edge to the water, white bollards and stone urns along it.
  const sea = -f.origin[1];
  const [q0, q1] = [-half - 14, half + 14];
  f.box(m, [q0, q1], [sea - 0.8, sea + 0.7], [f.edge - 1.2, f.edge], COLORS.stone);
  f.box(m, [q0, q1], [sea + 0.7, sea + 0.85], [f.edge - 1.3, f.edge + 0.1], VILLA.coping);
  for (let x = q0 + 1; x <= q1 - 1; x += 3) {
    f.box(m, [x - 0.15, x + 0.15], [sea + 0.85, sea + 1.5], [f.edge - 0.7, f.edge - 0.4], COLORS.white);
    if (Math.round((x - q0) / 3) % 3 === 1) {
      m.sphere(f.at(x + 1.5, sea + 1.4, f.edge - 0.6), 0.4, VILLA.urn, 3, 6);
      m.sphere(f.at(x + 1.5, sea + 1.95, f.edge - 0.6), 0.45, VILLA.plant, 3, 6);
    }
  }
  // The white summerhouse, and the tower beyond it.
  const sx = half + 5;
  m.cylinder(f.at(sx, sea + 0.85, f.edge - 4), 1.7, 2.6, 8, COLORS.white);
  m.cylinder(f.at(sx, sea + 1.3, f.edge - 4), 1.72, 1.5, 8, VILLA.window);
  m.cone(f.at(sx, sea + 3.45, f.edge - 4), 2, 1.3, 8, VILLA.slate);
  const tx = half + 10;
  for (const [dx, dz] of [[-1.2, -1.2], [1.2, -1.2], [1.2, 1.2], [-1.2, 1.2]]) f.box(m, [tx + dx - 0.12, tx + dx + 0.12], [sea + 0.85, sea + 6.5], [f.edge - 5 + dz - 0.12, f.edge - 5 + dz + 0.12], COLORS.white);
  for (const y of [2.6, 4.4, 6.3]) f.box(m, [tx - 1.4, tx + 1.4], [sea + y, sea + y + 0.2], [f.edge - 6.4, f.edge - 3.6], COLORS.white);
  m.cone(f.at(tx, sea + 6.5, f.edge - 5), 2.1, 1.6, 4, COLORS.white);
}

// A half-timbered boathouse on the Caversham bank (1.7 km): brick boat bays
// below, a white first floor criss-crossed with black timbers, a balcony with
// a white rail along the front, a steep dark roof, a brick quay and a lawn.
const TUDOR = { render: [0.95, 0.94, 0.9], timber: [0.1, 0.09, 0.09], roof: [0.25, 0.22, 0.22] };
function tudorBoathouse(m, course, f) {
  const half = Math.min(9, Math.max(6, (f.along[1] - f.along[0]) / 2));
  const front = Math.min(f.depth[1], f.edge - 7);
  const back = Math.max(f.depth[0], front - 9);
  f.box(m, [-half, half], [-1, 3.2], [back, front], CLUB.brick);
  for (const x of [-half + 1, 1]) f.box(m, [x, x + half - 2], [0, 2.7], [front, front + 0.05], CLUB.dark);
  f.box(m, [-half, half], [3.2, 6.6], [back, front], TUDOR.render);
  // The timber framing on the front: posts, a rail and braces.
  for (let x = -half; x <= half + 0.01; x += 1.5) f.box(m, [x - 0.1, x + 0.1], [3.2, 6.6], [front, front + 0.06], TUDOR.timber);
  f.box(m, [-half, half], [4.8, 5], [front, front + 0.06], TUDOR.timber);
  for (let x = -half; x < half - 1.4; x += 3) beam(m, f.at(x, 3.3, front + 0.08), f.at(x + 1.5, 4.8, front + 0.08), 0.06, TUDOR.timber);
  // The balcony.
  f.box(m, [-half, half], [3.1, 3.3], [front, front + 1.5], TUDOR.render);
  f.box(m, [-half, half], [4.2, 4.3], [front + 1.4, front + 1.5], COLORS.white);
  for (let x = -half; x <= half; x += 1) f.box(m, [x, x + 0.06], [3.3, 4.2], [front + 1.42, front + 1.48], COLORS.white);
  roof(m, f, half + 0.5, [back - 0.5, front + 0.5], 6.6, 4, TUDOR.roof);
  // The lawn down to a brick quay.
  const sea = -f.origin[1];
  const lawn = [f.at(-half - 4, 0.05, front + 1.5), f.at(half + 4, 0.05, front + 1.5), f.at(half + 4, sea + 0.75, f.edge - 0.4), f.at(-half - 4, sea + 0.75, f.edge - 0.4)];
  m.tri(lawn[0], lawn[1], lawn[2], COLORS.mown);
  m.tri(lawn[0], lawn[2], lawn[3], COLORS.mown);
  f.box(m, [-half - 8, half + 8], [sea - 0.6, sea + 0.8], [f.edge - 0.5, f.edge], CLUB.brick);
}

// A white Victorian house at the water (1.8 km, Caversham bank): three
// storeys of white render under a steep red-tiled roof, a corner turret with
// a pointed cupola, white balconies, and a boat dock below.
const VICTORIAN = { render: [0.94, 0.93, 0.9], tiles: [0.62, 0.27, 0.2], trim: [0.3, 0.32, 0.34] };
function victorian(m, course, f) {
  const half = Math.min(8, Math.max(5, (f.along[1] - f.along[0]) / 2));
  const front = Math.min(f.depth[1], f.edge - 4);
  const back = Math.max(f.depth[0], front - 10);
  f.box(m, [-half, half], [-1, 8.5], [back, front], VICTORIAN.render);
  for (const y of [1, 4, 6.8]) for (let x = -half + 1.2; x < half - 1.2; x += 2.4) f.box(m, [x, x + 1.1], [y, y + 1.6], [front, front + 0.05], COLORS.window);
  for (const y of [3, 5.9]) {
    f.box(m, [-half + 0.5, half - 0.5], [y, y + 0.2], [front, front + 1.3], VICTORIAN.render);
    f.box(m, [-half + 0.5, half - 0.5], [y + 1, y + 1.08], [front + 1.2, front + 1.3], COLORS.white);
  }
  roof(m, f, half + 0.4, [back - 0.4, front + 0.4], 8.5, 4.5, VICTORIAN.tiles);
  // The turret, at the corner nearest the water, with its cupola.
  const t = f.at(half - 0.5, -1, front - 0.5);
  m.cylinder(t, 1.9, 12.5, 10, VICTORIAN.render);
  for (const y of [2.5, 5.5, 8.5]) m.cylinder(f.at(half - 0.5, y, front - 0.5), 1.93, 1.2, 10, COLORS.window.map((v) => v * 1.2));
  m.cone(f.at(half - 0.5, 11.5, front - 0.5), 2.2, 3.5, 10, VICTORIAN.tiles);
  m.cylinder(f.at(half - 0.5, 15, front - 0.5), 0.05, 1.2, 4, VICTORIAN.trim);
  // The boat dock under the front, at the water.
  const sea = -f.origin[1];
  f.box(m, [-half + 1, -0.5], [sea - 0.5, sea + 2.2], [front, f.edge], CLUB.dark);
  f.box(m, [-half, half], [sea + 2.2, sea + 2.5], [front, f.edge], VICTORIAN.render);
}

// The bar on Piper's Island, from the footage (the main channel's side, below
// Caversham Bridge): a white two-storey building glazed all round, a deck in
// front behind glass panels, a first-floor balcony behind more glass, a white
// gable over the middle with ISLAND on it, a low grey roof, and a bank of
// timber piling under it.
const ISLAND = {
  white: [0.93, 0.93, 0.9], glass: [0.45, 0.57, 0.65], panel: [0.72, 0.8, 0.83], roof: [0.36, 0.38, 0.42],
  deck: [0.55, 0.47, 0.38], pile: [0.42, 0.36, 0.3], letter: [0.25, 0.27, 0.3],
};
function islandBar(m, course, f) {
  const C = ISLAND;
  const half = Math.min(15, Math.max(8, (f.along[1] - f.along[0]) / 2));
  const front = Math.min(f.depth[1], f.edge - 3.5); // the deck between it and the water
  const back = Math.max(f.depth[0], front - 14);
  const sea = -f.origin[1];
  const floor = Math.max(sea + 1.4, -1); // its deck stands over the water on piling
  const [g1, eave] = [floor + 3.3, floor + 6.6];
  // The ground floor: glass between white posts, set back under the balcony.
  f.box(m, [-half, half], [floor - 2, g1], [back, front - 2], C.white);
  f.box(m, [-half + 0.3, half - 0.3], [floor + 0.2, g1 - 0.3], [front - 2, front - 1.95], C.glass);
  for (let x = -half + 0.3; x <= half - 0.2; x += 2.2) f.box(m, [x - 0.08, x + 0.08], [floor, g1], [front - 2, front - 1.9], C.white);
  // The first floor: the balcony slab, glass behind glass panels, white over.
  f.box(m, [-half, half], [g1 - 0.25, g1], [front - 2, front], C.white);
  f.box(m, [-half, half], [g1, eave], [back, front - 3], C.white);
  f.box(m, [-half + 0.3, half - 0.3], [g1 + 0.2, eave - 0.6], [front - 3, front - 2.95], C.glass);
  for (let x = -half + 0.3; x <= half - 0.2; x += 1.8) f.box(m, [x - 0.06, x + 0.06], [g1, eave - 0.6], [front - 3, front - 2.9], C.white);
  f.box(m, [-half, half], [g1, g1 + 1.05], [front - 0.08, front], C.panel);
  f.box(m, [-half, half], [g1 + 1.05, g1 + 1.12], [front - 0.1, front + 0.02], C.white);
  // The gable over the middle, ISLAND on it, and the low roof either side.
  const g = 6;
  f.box(m, [-g, g], [eave - 0.6, eave + 0.4], [front - 3.2, front - 2.6], C.white);
  m.triFacing(f.at(-g - 0.3, eave + 0.4, front - 2.6), f.at(g + 0.3, eave + 0.4, front - 2.6), f.at(0, eave + 2.6, front - 2.6), C.white, [f.fwd[0], 0, f.fwd[1]]);
  sign(m, f, 'ISLAND', 0, eave + 0.6, front - 2.58, null, C.letter, 0.16);
  roof(m, f, half + 0.3, [back - 0.3, front - 2.6], eave, 1.6, C.roof);
  for (const e of [-1, 1]) {
    const run = [f.at(e * (g + 0.4), eave + 0.3, front - 2.4), f.at(0, eave + 2.75, front - 2.4), f.at(0, eave + 2.75, back + 2), f.at(e * (g + 0.4), eave + 0.3, back + 2)];
    m.tri(run[0], run[1], run[2], C.roof);
    m.tri(run[0], run[2], run[3], C.roof);
  }
  // The deck in front behind glass panels, on a bank of timber piling.
  f.box(m, [-half - 1, half + 1], [floor - 0.2, floor], [front - 2, f.edge], C.deck);
  f.box(m, [-half - 1, half + 1], [floor, floor + 1], [f.edge - 0.08, f.edge], C.panel);
  f.box(m, [-half - 1, half + 1], [sea - 0.6, floor - 0.2], [f.edge - 0.3, f.edge], C.pile);
  for (let x = -half - 1; x < half + 1; x += 0.5) f.box(m, [x, x + 0.06], [sea - 0.3, floor - 0.2], [f.edge, f.edge + 0.04], C.pile.map((v) => v * 0.8));
  // Behind, on the north channel: an overgrown bank of shrubs and young trees against its walls.
  // (Spacing and sizes from fixed offsets, not the world's random draws.)
  const jit = [0.3, -0.5, 0.8, -0.2, 0.5, -0.7, 0.1];
  for (let x = -half, k = 0; x <= half; x += 2.4 + jit[k % 7], k++) {
    const r = 0.9 + ((k * 5) % 7) * 0.12;
    m.sphere(f.at(x, sea + r * 0.6, back + 0.6 + jit[(k + 3) % 7]), r, LEAVES[2 + (k % 3)], 4, 7);
  }
}

// A boatyard across the river from the marina (from the footage): a long
// two-storey building end on along its quay, pale walls with big windows and
// a roller door below, a band of windows above, a dark grey pitched roof, and
// a lower shed at one end.
export const BOATYARD = { wall: [0.74, 0.73, 0.69], upper: [0.62, 0.62, 0.6], roof: [0.24, 0.25, 0.27], window: [0.22, 0.26, 0.3], door: [0.74, 0.75, 0.74], quay: [0.6, 0.58, 0.54] };
function boatyard(m, course, f) {
  const C = BOATYARD;
  const half = Math.min(20, (f.along[1] - f.along[0]) / 2);
  const front = Math.min(f.depth[1], f.edge - 4);
  const back = Math.max(f.depth[0], front - 10);
  const [g1, eave] = [3.2, 6.2];
  f.box(m, [-half, half], [-1, g1], [back, front], C.wall);
  f.box(m, [-half + 6, half], [g1, eave], [back, front - 0.2], C.upper);
  // The roller door at the shed end, big and pale enough to read across the river.
  for (let x = -half + 8; x < half - 1; x += 3.2) f.box(m, [x, x + 2.4], [0.7, 2.6], [front, front + 0.05], C.window);
  f.box(m, [-half + 1, -half + 6.5], [0, 3], [front, front + 0.05], C.door);
  for (let y = 0.3; y < 3; y += 0.35) f.box(m, [-half + 1, -half + 6.5], [y, y + 0.04], [front + 0.05, front + 0.06], C.door.map((v) => v * 0.8));
  for (let x = -half + 7; x < half - 1; x += 2.4) f.box(m, [x, x + 1.6], [g1 + 0.7, eave - 0.6], [front - 0.2, front - 0.15], C.window);
  roof(m, f, (2 * half - 6) / 2 + 0.4, [back - 0.4, front + 0.2], eave, 3.4, C.roof, 3);
  roof(m, f, 3.4, [back - 0.4, front + 0.4], g1, 1.4, C.roof, -half + 3);
  // The quay along the front.
  const sea = -f.origin[1];
  f.box(m, [-half - 6, half + 10], [sea - 0.6, sea + 0.7], [front, f.edge], C.quay);
}

const LANDMARKS = { 'island-bar': islandBar, victorian, 'tudor-boathouse': tudorBoathouse, 'rowing-club': rowingClub, 'canoe-club': canoeClub, 'spiral-boathouse': spiralBoathouse, 'grey-boathouse': greyBoathouse, 'riverside-villa': riversideVilla, 'glass-house': glassHouse, boatyard };

// Riverside town houses and flats across the open river below Piper's Island
// (from the footage): three and four storeys, steep gables to the river, red
// brick with red-painted balconies, or cream render with white trim.
export const TERRACE = {
  brick: [0.6, 0.33, 0.25], cream: [0.9, 0.86, 0.76], red: [0.72, 0.14, 0.12], roof: [0.3, 0.29, 0.3],
  trim: [0.95, 0.95, 0.93], window: [0.22, 0.26, 0.3],
};
function balconyTerrace(m, course, b, ring, cx, cz, g, rand) {
  const f = facing(course, ring, cx, cz, g);
  const cream = rand() < 0.35;
  // As many random draws as a plain building takes (its wall, and a roof on a
  // house), so everything drawn after it stays where it was.
  if (b.kind === 'house' || b.kind === 'boathouse') rand();
  const wall = cream ? TERRACE.cream : TERRACE.brick;
  const [x0, x1] = f.along;
  const [z0, z1] = f.depth;
  const h = Math.max(b.height, 10);
  f.box(m, [x0, x1], [-1, h], [z0, z1], wall);
  // A gable to the river (its ridge runs back from the water).
  const mid = (x0 + x1) / 2;
  const apex = h + Math.min(3.5, (x1 - x0) * 0.35);
  for (const x of [x0 - 0.3, x1 + 0.3]) {
    const run = [f.at(x, h - 0.2, z0 - 0.3), f.at(x, h - 0.2, z1 + 0.3), f.at(mid, apex, z1 + 0.3), f.at(mid, apex, z0 - 0.3)];
    m.tri(run[0], run[1], run[2], TERRACE.roof);
    m.tri(run[0], run[2], run[3], TERRACE.roof);
  }
  for (const [z, e] of [[z1, 1], [z0, -1]]) m.triFacing(f.at(x0, h, z), f.at(x1, h, z), f.at(mid, apex - 0.2, z), cream ? TERRACE.trim : wall, [f.fwd[0] * e, 0, f.fwd[1] * e]);
  // The river front: windows floor by floor, and red balconies on the brick
  // ones (only on the row along the water: the rest are behind it).
  if (fromRiver(course, cx, cz) > 90) return;
  const w = x1 - x0;
  const bays = Math.max(1, Math.round(w / 4));
  for (let y = 0.8; y + 1.6 < h; y += 3) {
    for (let k = 0; k < bays; k++) {
      const x = x0 + (w * (k + 0.5)) / bays;
      f.box(m, [x - 0.7, x + 0.7], [y, y + 1.6], [z1, z1 + 0.05], TERRACE.window);
    }
    if (!cream && y > 2) {
      f.box(m, [x0 + w * 0.15, x1 - w * 0.15], [y - 0.25, y - 0.1], [z1, z1 + 1.2], TERRACE.red);
      f.box(m, [x0 + w * 0.15, x1 - w * 0.15], [y - 0.1, y + 0.9], [z1 + 1.15, z1 + 1.22], TERRACE.red);
    }
  }
}

// Brick flats on concrete stilts over the water's edge (the north channel at
// Piper's Island, from the owner's photo): an open floor of pillars in shadow,
// brick floors above with white balcony rails to the river, and a saw-tooth of
// little gables along the roof.
const STILTS = { brick: [0.45, 0.29, 0.22], pillar: [0.72, 0.71, 0.68], shade: [0.12, 0.12, 0.12], rail: [0.78, 0.79, 0.8], roof: [0.4, 0.24, 0.18], slab: [0.8, 0.79, 0.75] };
function onStilts(m, course, b, ring, cx, cz, g, rand) {
  const lift = 3;
  const base = Math.max(0.3, g.y);
  const top = base + lift + Math.max(6, b.height - 3);
  // The pillars, at the corners and every few metres along each wall, and the dark space under.
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    const len = Math.hypot(bx - ax, bz - az);
    for (let t = 0; t < len; t += 4) {
      const [px, pz] = [ax + ((bx - ax) * t) / len, az + ((bz - az) * t) / len];
      m.box([px - 0.25, -0.6, pz - 0.25], [px + 0.25, base + lift, pz + 0.25], STILTS.pillar);
    }
  }
  const inner = ring.map(([x, z]) => [cx + (x - cx) * 0.8, cz + (z - cz) * 0.8]);
  for (let i = 0; i < inner.length; i++) {
    const [ax, az] = inner[i];
    const [bx, bz] = inner[(i + 1) % inner.length];
    m.quad([ax, -0.3, az], [bx, -0.3, bz], [bx, base + lift, bz], [ax, base + lift, az], STILTS.shade);
  }
  // The floors above.
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    const out = [(ax + bx) / 2 - cx, 0, (az + bz) / 2 - cz];
    m.triFacing([ax, base + lift, az], [bx, base + lift, bz], [bx, top, bz], STILTS.brick, out);
    m.triFacing([ax, base + lift, az], [bx, top, bz], [ax, top, az], STILTS.brick, out);
    // White balcony rails, floor by floor, on the walls to the water.
    const len = Math.hypot(bx - ax, bz - az) || 1;
    let n = [(bz - az) / len, -(bx - ax) / len]; // the wall's outward normal
    if (n[0] * out[0] + n[1] * out[2] < 0) n = [-n[0], -n[1]];
    if (len < 4 || course.land.shore((ax + bx) / 2 + n[0] * 6, (az + bz) / 2 + n[1] * 6) > 6) continue;
    for (let y = base + lift + 0.9; y < top - 1.5; y += 3) {
      const p = (t, h, d) => [ax + (bx - ax) * t + n[0] * d, h, az + (bz - az) * t + n[1] * d];
      m.quad(p(0.05, y, 0.9), p(0.95, y, 0.9), p(0.95, y + 0.12, 0.9), p(0.05, y + 0.12, 0.9), STILTS.rail);
      m.quad(p(0.05, y - 0.9, 0.9), p(0.95, y - 0.9, 0.9), p(0.95, y - 0.9, 0.05), p(0.05, y - 0.9, 0.05), STILTS.pillar);
      // The slab's pale edge, a band along the brick at each floor.
      m.quad(p(0.05, y - 1.15, 0.92), p(0.95, y - 1.15, 0.92), p(0.95, y - 0.9, 0.92), p(0.05, y - 0.9, 0.92), STILTS.slab);
    }
    // The saw-tooth: a little gable every 5 m along this wall.
    for (let t = 0; t + 5 / len <= 1.001; t += 5 / len) {
      const q = (u, h) => [ax + (bx - ax) * u, h, az + (bz - az) * u];
      m.tri(q(t, top), q(t + 5 / len, top), q(t + 2.5 / len, top + 1.8), STILTS.roof);
    }
  }
  const peak = [cx, top, cz];
  for (let i = 0; i < ring.length; i++) m.tri([ring[i][0], top, ring[i][1]], [ring[(i + 1) % ring.length][0], top, ring[(i + 1) % ring.length][1]], peak, COLORS.coping);
}

// A big riverside house in white or grey clapboard (below Mapledurham): board
// lines and white corner boards on the river front, a white balcony, a timber
// deck down the garden and a jetty out into the river.
const CLAP = { walls: [[0.93, 0.93, 0.9], [0.8, 0.82, 0.83], [0.7, 0.74, 0.78]], roof: [0.3, 0.32, 0.36], line: [0.6, 0.62, 0.62] };
function clapboardFront(m, course, f, height) {
  const [x0, x1] = f.along;
  const front = f.depth[1];
  for (let y = 0.5; y < height; y += 0.45) f.box(m, [x0, x1], [y, y + 0.05], [front, front + 0.03], CLAP.line);
  for (const x of [x0 - 0.1, x1 - 0.25]) f.box(m, [x, x + 0.35], [-0.3, height], [front - 0.1, front + 0.1], COLORS.white);
  // The balcony on the first floor.
  f.box(m, [x0 + 1, x1 - 1], [3, 3.2], [front, front + 1.6], COLORS.white);
  f.box(m, [x0 + 1, x1 - 1], [4.1, 4.2], [front + 1.5, front + 1.6], COLORS.white);
  for (let x = x0 + 1; x <= x1 - 1; x += 0.8) f.box(m, [x, x + 0.06], [3.2, 4.1], [front + 1.5, front + 1.56], COLORS.white);
  // The deck, and a jetty from the bottom of the garden.
  const sea = -f.origin[1];
  if (f.edge - front > 2) f.box(m, [x0, x1], [0.15, 0.4], [front, front + 3], COLORS.timber);
  const jx = (x0 + x1) / 2;
  f.box(m, [jx - 1, jx + 1], [sea + 0.3, sea + 0.55], [f.edge - 2, f.edge + 4], COLORS.timber);
  for (const z of [f.edge, f.edge + 3.8]) for (const e of [-1, 1]) f.box(m, [jx + e * 0.9 - 0.1, jx + e * 0.9 + 0.1], [sea - 0.8, sea + 0.9], [z - 0.1, z + 0.1], COLORS.timber);
}

// A modern flat-roofed house (owner's point, below the marina): a ground floor
// of dark glass in white frames, a white upper floor with a glass band, a flat
// white roof, and a timber edge to the lawn at the water.
function glassHouse(m, course, f) {
  const half = Math.min(9, Math.max(6, (f.along[1] - f.along[0]) / 2));
  const front = Math.min(f.depth[1], f.edge - 8);
  const back = Math.max(f.depth[0], front - 9);
  f.box(m, [-half, half], [-1, 0.2], [back, front], COLORS.white);
  f.box(m, [-half + 0.2, half - 0.2], [0.2, 3.1], [back + 0.2, front - 0.2], COLORS.glass);
  for (let x = -half; x <= half; x += 2.25) f.box(m, [x - 0.08, x + 0.08], [0.2, 3.1], [front - 0.25, front - 0.05], COLORS.white);
  f.box(m, [-half - 0.6, half + 0.6], [3.1, 3.5], [back - 0.4, front + 0.8], COLORS.white);
  f.box(m, [-half + 1.5, half], [3.5, 6.3], [back, front - 1.2], COLORS.white);
  f.box(m, [-half + 2, half - 0.5], [4.3, 5.6], [front - 1.25, front - 1.15], COLORS.glass);
  f.box(m, [-half + 1.3, half + 0.2], [6.3, 6.6], [back - 0.2, front - 1], COLORS.white);
  const sea = -f.origin[1];
  f.box(m, [-half - 6, half + 6], [sea - 0.5, sea + 0.55], [f.edge - 0.3, f.edge], COLORS.timber);
}

// --- things pointed out in the footage, at a point on the bank ------------------

// A frame at a point on the bank, facing the water (the river line): at(x, y,
// z) is x along the bank, y up from the water's level, z out over the water
// (negative: inland). ground(x, z) is the land's height there.
function spot(course, [x, z]) {
  const p = pointAt(course, locate(course, x, z).s);
  const len = Math.hypot(p.x - x, p.z - z) || 1;
  const fwd = [(p.x - x) / len, (p.z - z) / len];
  const right = [-fwd[1], fwd[0]];
  const origin = [x, 0, z];
  const at = (a, y, b) => [x + right[0] * a + fwd[0] * b, y, z + right[1] * a + fwd[1] * b];
  return {
    origin, right, fwd, at,
    box: (m, xr, yr, zr, color) => orientedBox(m, origin, right, fwd, xr, yr, zr, color),
    ground: (a, b) => { const q = at(a, 0, b); return ground(course, q[0], q[2]).y; },
    // A seed of its own, so a feature's random touches don't disturb the rest of the world.
    rand: mulberry32(Math.round(Math.abs(x * 31 + z * 17))),
  };
}

// How far round each feature other trees keep off (metres).
const CLEAR = { 'boat-shed': 7, 'ivy-boathouse': 6, quay: 4, truss: 8, wharf: 8, jetty: 3, beach: 21, landing: 7, marina: 45, willow: 7, 'sculling-club': 14, 'glass-restaurant': 14, 'ferry-landing': 8, sandbags: 8, gazebo: 5, boardwalk: 23, 'deck-boathouse': 23, 'dead-tree': 8 };

const FEAT = {
  sand: [0.82, 0.73, 0.54], wetSand: [0.62, 0.55, 0.42], bag: [0.74, 0.65, 0.48], bagDark: [0.66, 0.57, 0.42], pipe: [0.15, 0.15, 0.16],
  stone: [0.74, 0.71, 0.64], scull: [0.95, 0.93, 0.85], blade: [0.95, 0.8, 0.15], rack: [0.35, 0.36, 0.38],
  caravan: [[0.93, 0.92, 0.88], [0.88, 0.88, 0.84], [0.82, 0.84, 0.8]], caravanRoof: [0.55, 0.56, 0.56],
  clubTimber: [0.24, 0.22, 0.2], clubRoof: [0.2, 0.21, 0.23], flags: [[0.8, 0.1, 0.12], [0.1, 0.25, 0.6], [0.95, 0.95, 0.95]],
  frame: [0.12, 0.13, 0.14], umbrella: [0.12, 0.3, 0.65], red: [0.82, 0.08, 0.08], blue: [0.08, 0.25, 0.65], gazebo: [0.42, 0.3, 0.2],
};

// A sandy beach running into the shallows, `half` metres each way along the
// bank and `deep` up it: the landing for the portage (the put-in is a little one).
function beach(m, course, f, half = 20, deep = 18) {
  const [n, rows] = [Math.round(half / 2), 6];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < rows; j++) {
      const [a0, a1] = [-half + (2 * half * i) / n, -half + (2 * half * (i + 1)) / n];
      const [b0, b1] = [-deep + (j * deep) / rows, -deep + ((j + 1) * deep) / rows];
      // A shelving beach: a little above the bank's own ground, down into the shallows.
      const y = (a, b) => Math.max(-0.3, f.ground(a, b) + 0.15 * Math.min(1, -b / 4)) + 0.05;
      const pts = [[a0, b0], [a1, b0], [a1, b1], [a0, b1]].map(([a, b]) => f.at(a, y(a, b), b));
      m.quad(...pts, j === rows - 1 ? FEAT.wetSand : shade(FEAT.sand, f.rand, 0.04));
    }
  }
}

// The put-in: a stepped wall of sandbags up from the water with a drain pipe
// through it, and a timber deck with railings at the top.
function sandbags(m, course, f) {
  for (let row = 0; row < 5; row++) {
    const z = -row * 0.45;
    const y = -0.4 + row * 0.38;
    for (let x = -9 + (row % 2) * 0.35; x < 9; x += 0.72) {
      f.box(m, [x, x + 0.66], [y, y + 0.36], [z - 0.5, z], shade(row % 2 ? FEAT.bag : FEAT.bagDark, f.rand, 0.08));
    }
  }
  beam(m, f.at(2, 0.25, -2), f.at(2, 0.25, 0.3), 0.18, FEAT.pipe);
  const top = 1.5;
  f.box(m, [-7, 7], [top, top + 0.15], [-6, -2.2], COLORS.timber);
  for (let x = -7; x <= 7; x += 1.75) f.box(m, [x - 0.05, x + 0.05], [top, top + 1], [-2.3, -2.2], COLORS.timber);
  f.box(m, [-7, 7], [top + 0.95, top + 1.05], [-2.3, -2.2], COLORS.timber);
}

// A blue sign on a post at the water's edge: CHANNEL and an arrow, facing
// down the river to boats coming up.
function channelSign(m, course, f) {
  m.cylinder(f.at(0, -0.5, 0), 0.07, 3.1, 5, COLORS.white);
  const c = pointAt(course, locate(course, f.origin[0], f.origin[2]).s);
  const fwd = [-c.tx, -c.tz];
  const right = [-fwd[1], fwd[0]];
  const face = { at: (x, y, z) => [f.origin[0] + right[0] * x + fwd[0] * z, y, f.origin[2] + right[1] * x + fwd[1] * z], box: (mm, xr, yr, zr, color) => orientedBox(mm, f.origin, right, fwd, xr, yr, zr, color) };
  face.box(m, [-0.9, 0.9], [2.1, 2.65], [0.02, 0.08], FEAT.blue);
  // The word, then an arrow to its right as you read it (x runs to your left).
  sign(m, face, 'CHANNEL', 0.2, 2.25, 0.1, null, COLORS.white, 0.05);
  face.box(m, [-0.75, -0.45], [2.34, 2.42], [0.08, 0.1], COLORS.white);
  m.triFacing(face.at(-0.75, 2.27, 0.1), face.at(-0.75, 2.49, 0.1), face.at(-0.86, 2.38, 0.1), COLORS.white, [fwd[0], 0, fwd[1]]);
}

// The little red box on the railway wall, just above the water (the owner
// calls it the mailbox): snapped onto the wall's face.
function mailbox(m, course, f) {
  const at = locate(course, f.origin[0], f.origin[2]);
  const c = pointAt(course, at.s);
  const side = Math.sign(at.lateral) || -1;
  const w = widthAt(course, at.s).half;
  const o = [c.x - c.tz * side * w, 0, c.z + c.tx * side * w];
  const fwd = [c.tz * side, -c.tx * side]; // out from the wall
  const right = [-fwd[1], fwd[0]];
  const box = (xr, yr, zr, color) => orientedBox(m, o, right, fwd, xr, yr, zr, color);
  box([-0.25, 0.25], [1.1, 1.75], [0, 0.3], FEAT.red);
  box([-0.27, 0.27], [1.75, 1.82], [-0.02, 0.33], FEAT.red.map((v) => v * 0.8)); // the lid
  box([-0.14, 0.14], [1.55, 1.6], [0.3, 0.31], FEAT.frame); // the slot
  box([-0.1, 0.1], [1.25, 1.38], [0.3, 0.31], COLORS.white);
}

// A timber gazebo on a deck at the water, a ladder down into the river.
function gazebo(m, course, f) {
  const g = Math.max(0.6, f.ground(0, -3));
  f.box(m, [-2.5, 2.5], [g - 0.2, g], [-5, 0.3], COLORS.timber);
  for (const [x, z] of [[-1.8, -4.4], [1.8, -4.4], [1.8, -1.2], [-1.8, -1.2]]) f.box(m, [x - 0.1, x + 0.1], [g, g + 2.4], [z - 0.1, z + 0.1], FEAT.gazebo);
  f.box(m, [-1.9, 1.9], [g + 0.9, g + 1], [-1.3, -1.1], FEAT.gazebo);
  const peak = f.at(0, g + 3.6, -2.8);
  const eaves = [f.at(-2.3, g + 2.4, -4.9), f.at(2.3, g + 2.4, -4.9), f.at(2.3, g + 2.4, -0.7), f.at(-2.3, g + 2.4, -0.7)];
  for (let i = 0; i < 4; i++) m.tri(eaves[i], eaves[(i + 1) % 4], peak, CLUB.slate);
  // The ladder: two rails from the deck down into the water, and rungs.
  const rail = (x, t) => f.at(x, g + (-0.8 - g) * t, 0.2 + 0.4 * t);
  for (const x of [-0.3, 0.3]) beam(m, rail(x, 0), rail(x, 1), 0.03, COLORS.steel);
  for (let t = 0.15; t < 1; t += 0.2) beam(m, rail(-0.3, t), rail(0.3, t), 0.02, COLORS.steel);
}

// A sculling club on the lawn: sculls upside down on racks, oars standing in a
// rack, a landing stage, and a tall stone memorial pillar beside them.
function scullingClub(m, course, f) {
  const sea = 0;
  f.box(m, [-9, 9], [sea - 0.1, sea + 0.3], [-0.2, 2.6], COLORS.pontoon);
  for (const x of [-7, -3]) {
    for (const [z, h] of [[-7, 1], [-7, 1.6]]) {
      f.box(m, [x - 0.06, x + 0.06], [f.ground(x, z), f.ground(x, z) + h + 0.1], [z - 4.2, z - 4], FEAT.rack);
      f.box(m, [x - 0.06, x + 0.06], [f.ground(x, z), f.ground(x, z) + h + 0.1], [z + 4, z + 4.2], FEAT.rack);
    }
  }
  // Single and double sculls on two tiers, their length along the bank.
  for (const [tier, h] of [[0, 1.05], [1, 1.65]]) {
    for (const z of [-8.6, -7.2, -5.8]) {
      const y = f.ground(-5, -7) + h + tier * 0.02;
      f.box(m, [-10, 0], [y, y + 0.22], [z - 0.17, z + 0.17], FEAT.scull);
      f.box(m, [-10, 0], [y + 0.19, y + 0.23], [z - 0.06, z + 0.06], [0.75, 0.2, 0.15]);
    }
  }
  // An oar rack: oars on end, yellow blades up.
  const gy = f.ground(3, -9);
  f.box(m, [1.5, 4.5], [gy + 2.2, gy + 2.3], [-9.2, -9], FEAT.rack);
  for (let x = 1.7; x < 4.4; x += 0.3) {
    f.box(m, [x - 0.025, x + 0.025], [gy, gy + 2.6], [-9.1, -9.05], COLORS.white);
    f.box(m, [x - 0.1, x + 0.1], [gy + 2.6, gy + 3.1], [-9.12, -9.06], FEAT.blade);
  }
  // The memorial: a plinth, a tall shaft and its cap.
  const py = f.ground(9, -9);
  f.box(m, [8, 10], [py - 0.3, py + 0.6], [-10, -8], FEAT.stone);
  f.box(m, [8.4, 9.6], [py + 0.6, py + 1.4], [-9.6, -8.4], FEAT.stone);
  f.box(m, [8.6, 9.4], [py + 1.4, py + 6.6], [-9.4, -8.6], FEAT.stone);
  f.box(m, [8.5, 9.5], [py + 6.6, py + 6.9], [-9.5, -8.5], FEAT.stone.map((v) => v * 0.9));
}

// A glass-fronted restaurant at the water: a long low pavilion of dark glass in
// black frames, a terrace with a glass balustrade, and a white round tower.
function glassRestaurant(m, course, f) {
  const y = Math.max(0.8, f.ground(0, -4));
  f.box(m, [-11, 9], [y - 1.2, y], [-14, 0], COLORS.quay); // the terrace, up from the water
  f.box(m, [-10, 8], [y, y + 4.2], [-13, -4], COLORS.glass);
  for (let x = -10; x <= 8; x += 2) f.box(m, [x - 0.08, x + 0.08], [y, y + 4.2], [-4.1, -3.95], FEAT.frame);
  f.box(m, [-10, 8], [y + 2.9, y + 3], [-4.1, -3.95], FEAT.frame);
  f.box(m, [-10.6, 8.6], [y + 4.2, y + 4.7], [-13.4, -3.4], FEAT.frame);
  f.box(m, [-11, 9], [y, y + 1.1], [-0.15, 0], [0.6, 0.72, 0.76]); // glass balustrade
  m.cylinder(f.at(-13, y - 1.2, -9), 2.3, 10.5, 12, COLORS.white);
  m.cylinder(f.at(-13, y + 9.3, -9), 2.36, 0.4, 12, FEAT.frame);
  // Small square windows up the tower, on the side to the river.
  for (let k = 0; k < 3; k++) for (const a of [-0.5, 0, 0.5]) f.box(m, [-13 + Math.sin(a) * 2.3 - 0.35, -13 + Math.sin(a) * 2.3 + 0.35], [y + 2.2 + k * 2.6, y + 3.1 + k * 2.6], [-9 + Math.cos(a) * 2.3 - 0.05, -9 + Math.cos(a) * 2.3 + 0.05], COLORS.window);
}

// The ferry's landing: a long pontoon at the bank with a rail, blue
// umbrellas on the quay behind it and a flag.
function ferryLanding(m, course, f) {
  f.box(m, [-15, 15], [-0.1, 0.35], [0.2, 3], COLORS.pontoon);
  f.box(m, [-15, 15], [1.25, 1.32], [2.85, 2.95], COLORS.white);
  for (let x = -15; x <= 15; x += 2.5) f.box(m, [x - 0.04, x + 0.04], [0.35, 1.3], [2.86, 2.94], COLORS.white);
  beam(m, f.at(-2, 0.35, 1.5), f.at(-2, 1.2, -1.5), 0.6, COLORS.pontoon); // the gangway up
  const y = Math.max(0.9, f.ground(0, -4));
  for (const x of [-9, -3, 3, 9]) {
    m.cylinder(f.at(x, y, -4), 0.04, 2.2, 4, COLORS.white);
    m.cone(f.at(x, y + 2, -4), 1.5, 0.5, 8, FEAT.umbrella);
  }
  m.cylinder(f.at(12, y, -3), 0.06, 7, 5, COLORS.white);
  f.box(m, [12.1, 13.6], [y + 5.8, y + 6.8], [-3.02, -2.98], FEAT.red);
}

// The marina: a dark timber clubhouse with flagpoles at the water, pontoon
// walkways, and rows of static caravans behind.
function marina(m, course, f) {
  const g = Math.max(0.8, f.ground(0, -10));
  f.box(m, [-8, 8], [g - 1, g + 5.5], [-16, -7], FEAT.clubTimber);
  for (let y = g + 0.5; y < g + 5.5; y += 0.5) f.box(m, [-8.02, 8.02], [y, y + 0.04], [-7, -6.97], [0.3, 0.28, 0.25]);
  for (const x of [-5, -1, 3]) f.box(m, [x, x + 2.4], [g + 1, g + 2.4], [-7, -6.95], COLORS.glass);
  f.box(m, [-7, 7], [g + 3.2, g + 4.6], [-7, -6.95], COLORS.glass);
  roof(m, { ...f, at: (x, y, z) => f.at(x, y, z) }, 8.6, [-16.6, -6.4], g + 5.5, 2.6, FEAT.clubRoof);
  FEAT.flags.forEach((color, k) => {
    const x = 10 + k * 2.5;
    m.cylinder(f.at(x, g, -6), 0.05, 7.5, 5, COLORS.white);
    f.box(m, [x + 0.05, x + 1.5], [g + 6.4, g + 7.3], [-6.02, -5.98], color);
  });
  f.box(m, [-25, 25], [-0.1, 0.3], [0.2, 1.6], COLORS.pontoon); // the walkway along the moorings
  // The caravans: long white boxes in rows, end-on to the river.
  for (let row = 0; row < 3; row++) {
    for (let k = 0; k < 7; k++) {
      const x = -36 + k * 6 + (row % 2) * 3;
      const z = -26 - row * 13;
      const y = f.ground(x, z);
      if (y < 0.3) continue;
      const color = FEAT.caravan[(row + k) % 3];
      f.box(m, [x - 1.7, x + 1.7], [y - 0.2, y + 2.8], [z - 5, z + 5], color);
      f.box(m, [x - 1.8, x + 1.8], [y + 2.8, y + 3.1], [z - 5.1, z + 5.1], FEAT.caravanRoof);
      f.box(m, [x - 1.2, x + 1.2], [y + 1, y + 2], [z + 5, z + 5.04], COLORS.glass);
    }
  }
}

// A big weeping willow at the water.
function willow(m, course, f) {
  willowTree(m, ...f.at(0, Math.max(0.3, f.ground(0, -6)), -6), f.rand, 1.4);
}

// An old concrete wharf at the water (below the festival field): a low
// stained wall with a flat top, and a little concrete hut on it.
function wharf(m, course, f) {
  f.box(m, [-14, 14], [-0.6, 0.7], [-0.4, 0.4], [0.62, 0.6, 0.55]);
  f.box(m, [-14, 14], [0.7, 0.8], [-3, 0.4], [0.68, 0.66, 0.6]);
  f.box(m, [-14, 14], [-0.6, 0.1], [0.38, 0.42], [0.35, 0.36, 0.3]); // green-stained at the waterline
  f.box(m, [2, 4.2], [0.8, 3.1], [-2.6, -0.6], [0.66, 0.64, 0.6]);
  f.box(m, [1.9, 4.3], [3.1, 3.25], [-2.7, -0.5], [0.55, 0.54, 0.5]);
  f.box(m, [2.7, 3.5], [0.9, 2.6], [-0.62, -0.58], [0.3, 0.3, 0.32]);
}

// A green timber boat shed at the water with a white sign board.
function boatShed(m, course, f) {
  const y = Math.max(0.5, f.ground(0, -3));
  f.box(m, [-4, 4], [y - 1, y + 2.8], [-6, -1], [0.2, 0.38, 0.25]);
  f.box(m, [-3, 3], [y + 1.6, y + 2.5], [-1, -0.95], COLORS.white);
  f.box(m, [-1.2, 1.2], [y, y + 2], [-1, -0.97], [0.16, 0.26, 0.2]);
  roof(m, { at: (x, yy, z) => f.at(x, yy, z) }, 4.4, [-6.4, -0.6], y + 2.8, 1.2, [0.3, 0.3, 0.3]);
  f.box(m, [-4, 4], [-0.2, 0.35], [-1, 1.5], COLORS.timber);
}

// A weathered timber boathouse at the water (upstream of the riverside villa,
// from the footage): grey boarding, a dark opening to the river, a deck on its
// roof behind a timber railing, and a thick bank of shrubs beside it.
function deckBoathouse(m, course, f) {
  const grey = [0.5, 0.47, 0.43];
  const y = Math.max(0.6, f.ground(0, -3));
  f.box(m, [-3, 3], [-0.6, y + 2.6], [-6, -0.3], grey);
  for (let x = -3; x <= 3; x += 0.5) f.box(m, [x - 0.03, x + 0.03], [-0.4, y + 2.6], [-0.3, -0.26], grey.map((v) => v * 0.8));
  f.box(m, [-1.8, 1.8], [-0.4, y + 1.4], [-0.3, -0.24], [0.13, 0.12, 0.11]);
  f.box(m, [-3.2, 3.2], [y + 2.6, y + 2.8], [-6.2, -0.1], grey.map((v) => v * 0.9));
  // The roof deck's railing, round its three open sides.
  f.box(m, [-3.2, 3.2], [y + 3.7, y + 3.8], [-0.2, -0.1], grey.map((v) => v * 0.75));
  for (const x of [-3.2, 3.1]) f.box(m, [x, x + 0.1], [y + 3.7, y + 3.8], [-6.2, -0.1], grey.map((v) => v * 0.75));
  for (let x = -3.2; x <= 3.2; x += 1.6) f.box(m, [x - 0.05, x + 0.05], [y + 2.8, y + 3.8], [-0.2, -0.1], grey.map((v) => v * 0.75));
  f.box(m, [-6, 3], [0.2, 0.45], [-0.3, 1.2], COLORS.timber);
  // A tall bank of shrubs along the water, and trees over it.
  // (Each wholly on land: a shrub whose spot is water, where the bank curves away, is left out.)
  for (let x = 4, k = 0; x < 24; x += 1.6, k++) {
    const r = 1.4 + (k % 3) * 0.2;
    const z = -(r + 0.3) - (k % 2) * 0.7;
    if (f.ground(x, z) < 0 || f.ground(x, z + r) < 0) continue;
    m.sphere(f.at(x, f.ground(x, z) + r * 0.75, z), r, LEAVES[(k % 3) + 1], 4, 7);
  }
  for (const [x, h] of [[8, 13], [16, 15], [-6, 14]]) {
    const at = f.at(x, y, -7);
    m.cylinder([at[0], at[1] - 0.3, at[2]], 0.35, h * 0.5, 4, COLORS.trunk);
    for (const [dx, dy, dz, r, c] of [[0, 0.7, 0, 0.27, 0], [2.2, 0.55, 1.2, 0.2, 1], [-2, 0.58, 0.8, 0.2, 4]]) m.sphere(f.at(x + dx, y + h * dy, -7 + dz), h * r, LEAVES[c], 3, 6);
  }
}

// A big dead tree at the water's edge (above Mapledurham, from the footage):
// a pale grey trunk forking into bare branches, some reaching out over the water.
function deadTree(m, course, f) {
  const bark = [0.42, 0.4, 0.37];
  const y = Math.max(0.2, f.ground(0, -1.5));
  const base = f.at(0, y - 0.3, -1.5);
  const fork = f.at(0.3, y + 4.5, -1.2);
  beam(m, base, fork, 0.55, bark);
  // Thick limbs spreading wide and low, then forks and twigs (fixed, not the
  // world's random draws), one leaning out over the water.
  const limbs = [[-6, 9.5, -1, 0.32], [5, 10, 2.5, 0.3], [0.5, 12.5, -2.5, 0.26], [7.5, 7, 5, 0.24], [-4, 7.5, 3.5, 0.22]];
  for (const [x, h, z, r] of limbs) {
    const mid = f.at(0.3 + x * 0.55, y + h * 0.75, -1.2 + z * 0.55);
    const end = f.at(0.3 + x, y + h, -1.2 + z);
    beam(m, fork, mid, r, bark);
    beam(m, mid, end, r * 0.7, bark);
    for (const [dx, dh, dz] of [[x * 0.35 + 1.4, 2.2, 1], [x * 0.3 - 1.4, 1.7, -1.1], [x * 0.2, 2.8, 0.2]]) beam(m, end, f.at(0.3 + x + dx, y + h + dh, -1.2 + z + dz), r * 0.35, bark);
  }
}

// A white sign board on a white post at the water's edge.
function riverSign(m, course, f) {
  m.cylinder(f.at(0, -0.6, 0.4), 0.06, 2.6, 4, COLORS.white);
  f.box(m, [-0.45, 0.45], [1.4, 1.9], [0.32, 0.38], COLORS.white);
  f.box(m, [-0.38, 0.38], [1.48, 1.82], [0.38, 0.4], [0.15, 0.2, 0.45]);
  f.box(m, [-0.3, 0.3], [1.6, 1.7], [0.4, 0.41], COLORS.white);
}

// An old brick boathouse at the water, mostly under ivy.
function ivyBoathouse(m, course, f) {
  const y = Math.max(0.4, f.ground(0, -4));
  f.box(m, [-3.5, 3.5], [-0.6, y + 3.2], [-7, -0.5], CLUB.brick);
  f.box(m, [-2.3, 2.3], [-0.6, y + 1.8], [-0.5, -0.45], CLUB.dark);
  // Ivy: lumps of dark green up the walls and over the roof.
  for (const [x, yy, z, r] of [[-3, y + 1.5, -0.6, 1.4], [2.8, y + 2.2, -0.8, 1.6], [0, y + 3.4, -3, 2.4], [-2.6, y + 2.6, -5, 1.8], [3, y + 0.8, -4, 1.5]]) m.sphere(f.at(x, yy, z), r, LEAVES[4], 3, 6);
  roof(m, { at: (x, yy, z) => f.at(x, yy, z) }, 4, [-7.4, -0.1], y + 3.2, 1.6, [0.35, 0.22, 0.18]);
}

// A timber quay on piles along the bank, with a railing and a ladder.
function quay(m, course, f) {
  f.box(m, [-12, 12], [0.4, 0.6], [-0.6, 1.2], COLORS.timber);
  for (let x = -12; x <= 12; x += 2) f.box(m, [x - 0.12, x + 0.12], [-0.8, 0.6], [1, 1.24], [0.35, 0.27, 0.19]);
  for (let x = -12; x <= 12; x += 3) f.box(m, [x - 0.04, x + 0.04], [0.6, 1.6], [-0.4, -0.32], COLORS.white);
  f.box(m, [-12, 12], [1.5, 1.6], [-0.42, -0.3], COLORS.white);
  for (const x of [3.7, 4.3]) beam(m, f.at(x, 0.6, 1.24), f.at(x, -0.6, 1.5), 0.03, COLORS.steel);
}

// A steel lattice gantry on the bank (an old crane): two braced towers and a beam.
function truss(m, course, f) {
  const y = Math.max(0.5, f.ground(0, -3));
  const grey = [0.42, 0.44, 0.46];
  for (const x of [-5, 5]) {
    for (const [dx, dz] of [[-0.8, -0.8], [0.8, -0.8], [0.8, 0.8], [-0.8, 0.8]]) beam(m, f.at(x + dx, y, -3 + dz), f.at(x + dx * 0.5, y + 8, -3 + dz * 0.5), 0.07, grey);
    for (let h = 1; h < 8; h += 1.6) beam(m, f.at(x - 0.8 + h * 0.05, y + h, -3.8 + h * 0.05), f.at(x + 0.8 - h * 0.05, y + h + 1.6, -2.2 - h * 0.05), 0.04, grey);
  }
  for (const z of [-3.4, -2.6]) beam(m, f.at(-6, y + 8, z), f.at(6, y + 8, z), 0.1, grey);
  for (let x = -5; x < 5; x += 1.5) beam(m, f.at(x, y + 8, -3.4), f.at(x + 1.5, y + 8.9, -2.6), 0.04, grey);
}

// A timber landing stage on posts, with a ladder.
function jetty(m, course, f) {
  f.box(m, [-5, 5], [0.45, 0.65], [-0.5, 2.2], COLORS.timber);
  for (const x of [-4.8, 0, 4.8]) for (const z of [0, 2]) f.box(m, [x - 0.1, x + 0.1], [-0.8, 1.2], [z - 0.1, z + 0.1], COLORS.timber);
  for (const x of [-0.3, 0.3]) beam(m, f.at(x, 0.65, 2.2), f.at(x, -0.6, 2.5), 0.03, COLORS.steel);
}

// A timber boardwalk on piles out over the water along the bank (below
// Christchurch Bridge, from the footage): a deck, its piles, and a red-brown
// slatted fence on the water side.
function boardwalk(m, course, f) {
  const [x0, x1] = [-22, 22];
  const deck = 1.6;
  const timber = [0.48, 0.3, 0.22];
  f.box(m, [x0, x1], [deck - 0.15, deck], [-1, 2.2], timber.map((v) => v * 0.85));
  for (let x = x0; x <= x1; x += 2.75) for (const z of [-0.8, 2]) f.box(m, [x - 0.12, x + 0.12], [-1, deck - 0.15], [z - 0.12, z + 0.12], timber.map((v) => v * 0.6));
  f.box(m, [x0, x1], [deck, deck + 1.1], [2.1, 2.2], timber);
  for (let x = x0; x <= x1; x += 1.375) f.box(m, [x - 0.05, x + 0.05], [deck, deck + 1.2], [2.08, 2.24], timber.map((v) => v * 0.75));
}

const FEATURES = {
  'boat-shed': boatShed, 'ivy-boathouse': ivyBoathouse, quay, truss, wharf, jetty, beach, landing: (m, course, f) => beach(m, course, f, 6, 7), sandbags, 'channel-sign': channelSign, mailbox, gazebo, 'sculling-club': scullingClub,
  'glass-restaurant': glassRestaurant, 'ferry-landing': ferryLanding, marina, willow, boardwalk, 'deck-boathouse': deckBoathouse, 'dead-tree': deadTree, 'river-sign': riverSign,
};
export const FEATURE_STYLES = Object.keys(FEATURES);
export const LANDMARK_STYLES = Object.keys(LANDMARKS);

// A hipped roof over x in [-half, half], z in [z0, z1], from eaves at `y` up `rise`.
function roof(m, f, half, [z0, z1], y, rise, color, cx = 0) {
  const mid = (z0 + z1) / 2;
  const inset = Math.min(half, (z1 - z0) / 2);
  const c = [f.at(cx - half, y, z0), f.at(cx + half, y, z0), f.at(cx + half, y, z1), f.at(cx - half, y, z1)];
  const ridge = [f.at(cx - half + inset, y + rise, mid), f.at(cx + half - inset, y + rise, mid)];
  m.tri(c[0], c[1], ridge[1], color);
  m.tri(c[0], ridge[1], ridge[0], color);
  m.tri(c[3], c[2], ridge[1], color.map((v) => v * 0.9));
  m.tri(c[3], ridge[1], ridge[0], color.map((v) => v * 0.9));
  m.tri(c[0], c[3], ridge[0], color.map((v) => v * 0.8));
  m.tri(c[1], c[2], ridge[1], color.map((v) => v * 0.8));
}

// Blocky capitals, 3 by 5 pixels, for club names.
const GLYPHS = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  G: '011100101101011', H: '101101111101101', I: '111010010010111', L: '100100100100111', N: '101111111111101', O: '010101101101010',
  R: '110101110101101', S: '011100010001110', U: '101101101101111', W: '101101111111101', ' ': '000000000000000',
};

// `text` centred at x, its bottom at y, on the face at depth z, facing the
// water, on an optional `board` colour behind it. `px`: pixel size, metres.
export function sign(m, f, text, x, y, z, board, color, px = 0.12) {
  const width = text.length * 4 * px - px;
  if (board) f.box(m, [x - width / 2 - px, x + width / 2 + px], [y - px, y + 6 * px], [z - 0.02, z], board);
  [...text].forEach((ch, i) => {
    // A letter with no glyph would show as a gap ("I LAND"): add it to GLYPHS.
    if (!GLYPHS[ch]) throw new Error(`sign: no glyph for ${JSON.stringify(ch)} in ${JSON.stringify(text)}`);
    const glyph = GLYPHS[ch];
    for (let k = 0; k < 15; k++) {
      if (glyph[k] !== '1') continue;
      // Laid out towards -x: facing's x runs to the left as you look at the front.
      const gx = x + width / 2 - (i * 4 + (k % 3) + 1) * px;
      const gy = y + (4 - Math.floor(k / 3)) * px;
      f.box(m, [gx, gx + px], [gy, gy + px], [z, z + 0.02], color);
    }
  });
}

function area(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    a += ax * bz - bx * az;
  }
  return Math.abs(a / 2);
}

// A block with its top edges rounded off (a rock-faced stone, a sandbag):
// the top face is `inset` in from the sides, the sides slope up to it.
function pillow(m, f, [x0, x1], [y0, y1], [z0, z1], inset, color) {
  const b = [f.at(x0, y0, z0), f.at(x1, y0, z0), f.at(x1, y0, z1), f.at(x0, y0, z1)];
  const mid = y0 + (y1 - y0) * 0.55;
  const w = [f.at(x0, mid, z0), f.at(x1, mid, z0), f.at(x1, mid, z1), f.at(x0, mid, z1)];
  const t = [f.at(x0 + inset, y1, z0 + inset), f.at(x1 - inset, y1, z0 + inset), f.at(x1 - inset, y1, z1 - inset), f.at(x0 + inset, y1, z1 - inset)];
  const c = f.at((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const face = (p, q, r) => m.triFacing(p, q, r, color, [0, 1, 2].map((i) => (p[i] + q[i] + r[i]) / 3 - c[i]));
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    face(b[i], b[j], w[j]); face(b[i], w[j], w[i]);
    face(w[i], w[j], t[j]); face(w[i], t[j], t[i]);
  }
  m.tri(t[0], t[1], t[2], color);
  m.tri(t[0], t[2], t[3], color);
}

// A clipped hedge: a block, its top paler where the light catches the new growth.
function hedge(m, f, xr, [y0, y1], zr, color) {
  f.box(m, xr, [y0, y1 - 0.12], zr, color);
  f.box(m, [xr[0] + 0.05, xr[1] - 0.05], [y1 - 0.12, y1], [zr[0] + 0.05, zr[1] - 0.05], color.map((v) => v * 1.45));
}

// Doors on a club's land side (the walk's labels hang over them), facing away
// from the water, at x along its back wall `z`.
function backDoors(m, course, f, xs, floor, z, color) {
  for (const x of xs) {
    const y = Math.max(floor, ground(course, ...xz(f.at(x, 0, z - 0.6))).y - f.origin[1]); // the ground at the door
    f.box(m, [x - 0.7, x + 0.7], [y - 0.3, y + 2.3], [z - 0.08, z + 0.25], COLORS.white);
    f.box(m, [x - 0.6, x + 0.6], [y - 0.3, y + 2.2], [z - 0.1, z + 0.25], color);
  }
}

// A flat disc lying level (a hatch, a plate).
function disc(m, [x, y, z], r, color, segments = 8) {
  for (let k = 0; k < segments; k++) {
    const [a, b] = [k, k + 1].map((j) => (j / segments) * Math.PI * 2);
    m.tri([x, y, z], [x + Math.cos(a) * r, y, z + Math.sin(a) * r], [x + Math.cos(b) * r, y, z + Math.sin(b) * r], color);
  }
}

// A round bar lying between two points (a floating pipe), lit as round.
function tube(m, a, b, r, color, segments = 8) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(...d);
  const u = cross3(d, [0, 1, 0]).map((v) => v / Math.hypot(...cross3(d, [0, 1, 0])));
  const v = cross3(u, d).map((x) => x / len);
  const ring = (k) => u.map((x, i) => (x * Math.cos((k / segments) * Math.PI * 2) + v[i] * Math.sin((k / segments) * Math.PI * 2)) * r);
  for (let k = 0; k < segments; k++) {
    const [p, q] = [ring(k), ring(k + 1)];
    const out = p.map((x, i) => x + q[i]);
    const [a0, a1, b0, b1] = [a.map((x, i) => x + p[i]), a.map((x, i) => x + q[i]), b.map((x, i) => x + p[i]), b.map((x, i) => x + q[i])];
    m.triFacing(a0, b0, b1, color, out);
    m.triFacing(a0, b1, a1, color, out);
  }
}

// A square-section bar between two points: cables, struts, rails.
function beam(m, a, b, r, color) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(...d);
  const up = Math.abs(d[1]) / len > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = cross3(d, up).map((v) => (v / Math.hypot(...cross3(d, up))) * r);
  const v = cross3(d, u).map((x) => (x / len));
  const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([i, j]) => u.map((x, k) => x * i + v[k] * j));
  for (let k = 0; k < 4; k++) {
    const p = corners[k];
    const q = corners[(k + 1) % 4];
    const out = p.map((x, i) => x + q[i]);
    const at = (base, off) => base.map((x, i) => x + off[i]);
    m.triFacing(at(a, p), at(a, q), at(b, q), color, out);
    m.triFacing(at(a, p), at(b, q), at(b, p), color, out);
  }
}

function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

// A motor cruiser (or a long two-deck passenger boat): white hull, a dark
// stripe, a cabin with windows.
function cruiser(m, course, boat, rand) {
  const { length, kind, crew, paint } = boat;
  const beamW = kind === 'trip-boat' ? 2.3 : 1.7;
  const { origin, right, fwd } = berth(course, boat, beamW);
  const half = length / 2;
  const at = (x, y, z) => [origin[0] + right[0] * x + fwd[0] * z, y, origin[2] + right[1] * x + fwd[1] * z];
  // A navy-hulled boat (the trip boat at Piper's Island) is navy to the deck.
  const hull = paint === 'navy' ? COLORS.navy : paint === 'black' ? [0.08, 0.08, 0.1] : COLORS.white;
  orientedBox(m, origin, right, fwd, [-beamW, beamW], [-0.3, 0.9], [-half, half - 2], hull);
  const stripe = rand() < 0.5 ? COLORS.navy : [0.6, 0.12, 0.1];
  orientedBox(m, origin, right, fwd, [-beamW - 0.01, beamW + 0.01], [0.25, 0.45], [-half, half - 2], crew === 'tower' ? [0.1, 0.45, 0.32] : stripe);
  for (const e of [-1, 1]) {
    m.triFacing(at(e * beamW, -0.3, half - 2), at(e * beamW, 0.9, half - 2), at(0, 1.0, half), hull, [right[0] * e, 0, right[1] * e]);
    m.triFacing(at(e * beamW, -0.3, half - 2), at(0, -0.3, half - 0.6), at(0, 1.0, half), hull, [right[0] * e, 0, right[1] * e]);
  }
  m.triFacing(at(-beamW, 0.9, half - 2), at(beamW, 0.9, half - 2), at(0, 1.0, half), COLORS.white, [0, 1, 0]);
  // Fenders over the side (blue on the big Bayliner below the marina), and
  // orange lifebuoys on a trip boat's rail.
  if (crew === 'fenders') for (const z of [-half + 1.5, -half / 3, half / 3, half - 3]) for (const e of [-1, 1]) m.cylinder(at(e * (beamW + 0.12), 0.15, z), 0.13, 0.6, 6, [0.12, 0.25, 0.65]);
  if (kind === 'trip-boat') for (const z of [-half / 2, 0, half / 2 - 2]) for (const e of [-1, 1]) orientedBox(m, origin, right, fwd, [e * (beamW - 0.29) - 0.02, e * (beamW - 0.29) + 0.02], [3.1, 3.7], [z - 0.3, z + 0.3], [0.95, 0.45, 0.1]);
  if (crew === 'tower') {
    // An open wakeboard boat: a green cover over the cockpit, and the tower arching over it.
    orientedBox(m, origin, right, fwd, [-beamW + 0.2, beamW - 0.2], [0.9, 1.05], [-half + 0.5, half - 3], [0.12, 0.4, 0.28]);
    const legs = [at(-beamW + 0.15, 0.9, 0), at(-0.6, 2.7, -0.4), at(0.6, 2.7, -0.4), at(beamW - 0.15, 0.9, 0)];
    for (let i = 0; i < 3; i++) beam(m, legs[i], legs[i + 1], 0.06, COLORS.steel);
    return;
  }
  const decks = kind === 'trip-boat' ? 2 : 1;
  for (let d = 0; d < decks; d++) {
    const y = 0.9 + d * 1.9;
    orientedBox(m, origin, right, fwd, [-beamW + 0.3, beamW - 0.3], [y, y + 1.5], [-half + 1, half - 4 - d * 2], COLORS.white);
    orientedBox(m, origin, right, fwd, [-beamW + 0.28, beamW - 0.28], [y + 0.5, y + 1.15], [-half + 1.5, half - 4.5 - d * 2], COLORS.glass);
  }
}

// A big timber houseboat (below Mapledurham): a wide flat hull, a boxy cabin
// of weathered boards with windows along it, a deck rail with a lifebuoy, and
// a mast.
const HOUSEBOAT = { hull: [0.32, 0.27, 0.22], boards: [0.55, 0.45, 0.33], dark: [0.4, 0.33, 0.25], roof: [0.3, 0.32, 0.3] };
function houseboat(m, course, boat) {
  const { length, paint } = boat;
  // (A white one: painted boards on a dark hull.)
  const boards = paint === 'white' ? [0.9, 0.9, 0.87] : HOUSEBOAT.boards;
  const lines = paint === 'white' ? [0.78, 0.78, 0.76] : HOUSEBOAT.dark;
  const beamW = 2.3;
  const { origin, right, fwd } = berth(course, boat, beamW);
  const half = length / 2;
  const at = (x, y, z) => [origin[0] + right[0] * x + fwd[0] * z, y, origin[2] + right[1] * x + fwd[1] * z];
  const box = (xr, yr, zr, color) => orientedBox(m, origin, right, fwd, xr, yr, zr, color);
  box([-beamW, beamW], [-0.4, 0.5], [-half, half], HOUSEBOAT.hull);
  box([-beamW + 0.4, beamW - 0.4], [0.5, 2.9], [-half + 1.5, half - 2.5], boards);
  for (let y = 0.8; y < 2.9; y += 0.3) box([-beamW + 0.38, beamW - 0.38], [y, y + 0.04], [-half + 1.5, half - 2.5], lines);
  for (let z = -half + 2.5; z < half - 3.5; z += 2.2) box([-beamW + 0.36, beamW - 0.36], [1.4, 2.3], [z, z + 1.2], COLORS.window);
  box([-beamW + 0.2, beamW - 0.2], [2.9, 3.1], [-half + 1.3, half - 2.3], HOUSEBOAT.roof);
  box([-beamW, beamW], [1.2, 1.26], [half - 2.4, half], COLORS.white); // the rail on the front deck
  orientedBox(m, origin, right, fwd, [beamW - 0.05, beamW + 0.03], [0.7, 1.5], [half - 1.6, half - 0.8], [0.95, 0.4, 0.1]); // the lifebuoy
  m.cylinder(at(0, 3.1, half - 3.5), 0.08, 5, 5, HOUSEBOAT.dark);
}

// A tired old cruiser (below Caversham Bridge): yellowed and faded, a tarp
// over the cockpit or the whole cabin, rust under the rubbing strake, a flag
// at the stern, and now and then a dinghy alongside.
function tattyCruiser(m, course, boat, rand) {
  const { length, side } = boat;
  const beamW = 1.6;
  const { origin, right, fwd } = berth(course, boat, beamW);
  const half = length / 2;
  const at = (x, y, z) => [origin[0] + right[0] * x + fwd[0] * z, y, origin[2] + right[1] * x + fwd[1] * z];
  const box = (xr, yr, zr, color) => orientedBox(m, origin, right, fwd, xr, yr, zr, color);
  const hull = TATTY.hulls[Math.floor(rand() * TATTY.hulls.length)];
  box([-beamW, beamW], [-0.3, 0.85], [-half, half - 2], hull);
  box([-beamW - 0.01, beamW + 0.01], [0.5, 0.62], [-half, half - 2], TATTY.strakes[Math.floor(rand() * TATTY.strakes.length)]);
  for (let z = -half + 1; z < half - 3; z += 1.5 + rand() * 2) {
    if (rand() < 0.5) box([-side * beamW - 0.03, -side * beamW + 0.03], [0, 0.5], [z, z + 0.15], TATTY.rust); // on the river side
  }
  for (const e of [-1, 1]) {
    m.triFacing(at(e * beamW, -0.3, half - 2), at(e * beamW, 0.85, half - 2), at(0, 0.95, half), hull, [right[0] * e, 0, right[1] * e]);
    m.triFacing(at(e * beamW, -0.3, half - 2), at(0, -0.3, half - 0.6), at(0, 0.95, half), hull, [right[0] * e, 0, right[1] * e]);
  }
  m.triFacing(at(-beamW, 0.85, half - 2), at(beamW, 0.85, half - 2), at(0, 0.95, half), hull, [0, 1, 0]);
  const tarp = TATTY.tarps[Math.floor(rand() * TATTY.tarps.length)];
  if (rand() < 0.4) {
    // Covered from bow to stern, sagging between the stanchions.
    box([-beamW + 0.15, beamW - 0.15], [0.85, 1.9], [-half + 0.5, half - 2.5], tarp);
    box([-beamW + 0.4, beamW - 0.4], [1.9, 2.15], [-half + 0.8, half - 2.8], tarp.map((v) => v * 0.85));
  } else {
    box([-beamW + 0.3, beamW - 0.3], [0.85, 2.2], [-half / 3, half - 3.5], TATTY.cabin);
    box([-beamW + 0.28, beamW - 0.28], [1.35, 1.9], [-half / 3 + 0.4, half - 4], COLORS.glass);
    box([-beamW + 0.2, beamW - 0.2], [0.85, 1.7], [-half + 0.4, -half / 3], tarp); // the cockpit cover
  }
  // A flag at the stern; sometimes a dinghy tied alongside on the river side.
  m.cylinder(at(0, 0.85, -half + 0.3), 0.03, 1.6, 4, COLORS.white);
  box([-0.02, 0.02], [1.9, 2.4], [-half + 0.3, -half + 1.1], TATTY.flag);
  if (rand() < 0.35) {
    const x = -side * (beamW + 0.9);
    box([x - 0.6, x + 0.6], [-0.15, 0.3], [-1.4, 1.4], TATTY.dinghy);
  }
}

// A cable-stayed foot bridge (Christchurch Bridge, from the footage): a slim
// deck rising in a gentle arch from bank to bank, dark grey steel underneath,
// white railings on posts, hung from one tall leaning white mast on one bank
// by a fan of cables.
function cableStayedBridge(m, course, { s, mast = -1 }) {
  const c = pointAt(course, s);
  const right = [-c.tz, c.tx];
  const fwd = [c.tx, c.tz];
  const origin = [c.x, 0, c.z];
  const span = widthAt(course, s).half + 12;
  const deck = 5.5;
  const rise = 2.6;
  const y = (x) => deck - 0.6 + rise * (1 - (x / span) ** 2); // the deck's top
  const at = (x, h, z) => [origin[0] + right[0] * x + fwd[0] * z, h, origin[2] + right[1] * x + fwd[1] * z];
  const n = 10;
  for (let k = 0; k < n; k++) {
    const [x0, x1] = [-span + (2 * span * k) / n, -span + (2 * span * (k + 1)) / n];
    const [y0, y1] = [y(x0), y(x1)];
    // The steel box under, sloping with the deck, and the walkway on top.
    const steel = [0.32, 0.34, 0.37];
    for (const z of [-2.2, 2.2]) {
      const out = [fwd[0] * Math.sign(z), 0, fwd[1] * Math.sign(z)];
      m.triFacing(at(x0, y0 - 0.7, z), at(x1, y1 - 0.7, z), at(x1, y1, z), steel, out);
      m.triFacing(at(x0, y0 - 0.7, z), at(x1, y1, z), at(x0, y0, z), steel, out);
    }
    m.quad(at(x0, y0 - 0.7, -2.2), at(x1, y1 - 0.7, -2.2), at(x1, y1 - 0.7, 2.2), at(x0, y0 - 0.7, 2.2), steel);
    m.quad(at(x0, y0, -2.2), at(x1, y1, -2.2), at(x1, y1, 2.2), at(x0, y0, 2.2), [0.62, 0.62, 0.6]);
    // The railings: a top rail and a post at each end of the bay.
    for (const z of [-2.15, 2.15]) {
      beam(m, at(x0, y0 + 1.1, z), at(x1, y1 + 1.1, z), 0.04, COLORS.white);
      for (const t of [0, 0.5]) beam(m, at(x0 + (x1 - x0) * t, y(x0 + (x1 - x0) * t), z), at(x0 + (x1 - x0) * t, y(x0 + (x1 - x0) * t) + 1.1, z), 0.035, COLORS.white);
    }
  }
  const foot = at(mast * (span - 6), 0, 0);
  const tip = at(mast * (span - 14), 39, 0);
  beam(m, foot, tip, 0.6, COLORS.white);
  for (let k = 1; k <= 7; k++) {
    const x = mast * (span - 6) - mast * k * ((2 * span - 10) / 8);
    for (const z of [-2, 2]) beam(m, at(mast * (span - 13.5), 37 - k * 1.5, z * 0.15), at(x, y(x), z), 0.05, COLORS.steel);
  }
}

// A 1920s concrete road bridge: wide flat arches over the water it crosses
// (over each channel, where it crosses an island), piers between them, a pale
// stone face, balustrades and lamp posts.
// A bridge's frame: `origin` on the river line's crossing, `right` along its
// road, `fwd` across it (horizontal unit vectors as [x, z]).
function bridgeFrame(course, { s, ends }) {
  const c = pointAt(course, s);
  let right = [-c.tz, c.tx];
  let fwd = [c.tx, c.tz];
  let origin = [c.x, 0, c.z];
  if (ends) {
    // Along its road, which can cross the river at a slant (Caversham Bridge
    // crosses both channels round Piper's Island at about 70 degrees).
    const [a, b] = ends;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    right = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    fwd = [-right[1], right[0]];
    const t = (c.x - a[0]) * right[0] + (c.z - a[1]) * right[1];
    origin = [a[0] + right[0] * t, 0, a[1] + right[1] * t];
  }
  return { c, origin, right, fwd };
}

// Caversham Bridge as seen from its upstream pavement (the walk's opening
// shot, club.js): a viewing bay out over the water between two stone
// pedestals carrying green double lamps, a stone balustrade, pavements either
// side of the road. Where the bay is, along the road (`t`) and on which side
// (`e`, the upstream one, towards the clubs), with the bridge's frame.
export const BRIDGE = { deck: 6.5, half: 5.75, pavement: 2.6, bay: 3.2, out: 3, pedestal: 0.75 };
export function bridgeBay(course, bridge) {
  if (bridge?.name !== 'Caversham Bridge') return null;
  const { c, origin, right, fwd } = bridgeFrame(course, bridge);
  const target = [c.x + c.tx * 5.5 - c.tz * 7, c.z + c.tz * 5.5 + c.tx * 7];
  const t = (target[0] - origin[0]) * right[0] + (target[1] - origin[2]) * right[1];
  const e = Math.sign(c.tx * fwd[0] + c.tz * fwd[1]) || 1;
  const at = (x, y, z) => [origin[0] + right[0] * x + fwd[0] * z, y, origin[2] + right[1] * x + fwd[1] * z];
  return { t, e, origin, right, fwd, at };
}

const STONE = [0.93, 0.92, 0.88];
const PAVING = [0.72, 0.71, 0.68];
const ROAD = [0.3, 0.3, 0.32];
const BRONZE = [0.42, 0.6, 0.52];
const GLOBE = [0.93, 0.93, 0.9];

// A stone balustrade from (x0, z0) to (x1, z1) in a bridge's frame: plinth,
// coping, and balusters between (only near the bay: far off, a solid panel).
function balustrade(m, f, [x0, z0], [x1, z1], balusters) {
  const { deck } = BRIDGE;
  const len = Math.hypot(x1 - x0, z1 - z0);
  const u = [(x1 - x0) / len, (z1 - z0) / len];
  const v = [-u[1], u[0]];
  const box = (a0, a1, y0, y1, w, col) => {
    // A box along the run from a0 to a1, w either side of it.
    const c = [[a0, -w], [a1, -w], [a1, w], [a0, w]].map(([a, b]) => [x0 + u[0] * a + v[0] * b, z0 + u[1] * a + v[1] * b]);
    const p = (q, y) => f.at(q[0], y, q[1]);
    m.prism(c.map((q) => p(q, y0)), c.map((q) => p(q, y1)), col);
  };
  box(0, len, deck, deck + 0.25, 0.25, STONE);
  box(0, len, deck + 0.95, deck + 1.1, 0.27, STONE);
  if (!balusters) return box(0, len, deck + 0.25, deck + 0.95, 0.16, mix(STONE, [0, 0, 0], 0.12));
  for (let a = 0.2; a < len - 0.1; a += 0.3) {
    box(a - 0.06, a + 0.06, deck + 0.25, deck + 0.95, 0.06, STONE);
    box(a - 0.09, a + 0.09, deck + 0.52, deck + 0.68, 0.09, STONE); // the swell
  }
}

// A green double lamp standard on a stone pedestal at (x, z).
function lamp(m, f, x, z, along) {
  const { deck } = BRIDGE;
  const p = f.at(x, deck, z);
  m.box([p[0] - 0.75, deck, p[2] - 0.75], [p[0] + 0.75, deck + 1.45, p[2] + 0.75], STONE);
  m.box([p[0] - 0.85, deck + 1.45, p[2] - 0.85], [p[0] + 0.85, deck + 1.6, p[2] + 0.85], STONE);
  m.cylinder([p[0], deck + 1.6, p[2]], 0.32, 0.7, 8, BRONZE);
  m.cylinder([p[0], deck + 2.3, p[2]], 0.13, 3.4, 8, BRONZE);
  const top = deck + 5.7;
  for (const side of [-1, 1]) {
    const q = [p[0] + along[0] * side * 0.45, top, p[2] + along[1] * side * 0.45];
    m.box([Math.min(p[0], q[0]) - 0.05, top + 0.05, Math.min(p[2], q[2]) - 0.05], [Math.max(p[0], q[0]) + 0.05, top + 0.15, Math.max(p[2], q[2]) + 0.05], BRONZE);
    m.sphere([q[0], top + 0.3, q[2]], 0.24, GLOBE, 4, 8);
  }
  m.sphere([p[0], top + 0.35, p[2]], 0.1, BRONZE, 2, 5);
}

// Triangles in one bridge on its own (for the budget test: the river as a
// whole is near its limit, so a bridge has its own).
export function bridgeTriangles(course, bridge) {
  const m = new MeshBuilder();
  concreteBridge(m, course, bridge);
  return m.build().count / 3;
}

function concreteBridge(m, course, bridge) {
  const f = bridgeFrame(course, bridge);
  const { origin, right, fwd } = f;
  f.at = (x, y, z) => [origin[0] + right[0] * x + fwd[0] * z, y, origin[2] + right[1] * x + fwd[1] * z];
  const { s } = bridge;
  const deck = BRIDGE.deck;
  const half = widthAt(course, s).half;
  const wet = (x) => (course.land?.rings ? course.land.inside(origin[0] + right[0] * x, origin[2] + right[1] * x) : Math.abs(x) < half);
  // The water across the line, out to where a long stretch of land begins.
  const spans = [];
  for (const dir of [-1, 1]) {
    let dry = 0;
    for (let x = 0; Math.abs(x) < 150 && dry < 25; x += dir) {
      dry = wet(x) ? 0 : dry + 1;
      if (wet(x)) spans.push(x);
    }
  }
  const [lo, hi] = [Math.min(-half, ...spans) - 1, Math.max(half, ...spans) + 1];
  const arches = [];
  for (let x = lo; x <= hi; x++) {
    if (!wet(x)) continue;
    if (arches.length && x - arches.at(-1)[1] <= 2) arches.at(-1)[1] = x;
    else arches.push([x, x]);
  }
  for (const [a0, b0] of arches) {
    const [a, b] = [a0 - 1, b0 + 1];
    const mid = (a + b) / 2;
    const span = (b - a) / 2;
    const under = (x) => 1.2 + 3.6 * Math.sqrt(Math.max(0, 1 - ((x - mid) / span) ** 2));
    const n = Math.max(4, Math.round(span / 2));
    for (let k = 0; k < n; k++) {
      const x0 = a + ((b - a) * k) / n;
      const x1 = a + ((b - a) * (k + 1)) / n;
      orientedBox(m, origin, right, fwd, [x0, x1], [under((x0 + x1) / 2), deck], [-6, 6], COLORS.cream);
    }
  }
  // Piers and the abutments: the deck carried solid over the land between.
  for (let k = 0; k <= arches.length; k++) {
    const a = k ? arches[k - 1][1] + 1 : lo - 12;
    const b = k < arches.length ? arches[k][0] - 1 : hi + 12;
    if (b > a) orientedBox(m, origin, right, fwd, [a, b], [-0.5, deck], [-6.5, 6.5], COLORS.cream);
  }
  const bay = bridgeBay(course, bridge);
  if (!bay) {
    for (const e of [-1, 1]) {
      orientedBox(m, origin, right, fwd, [lo - 12, hi + 12], [deck, deck + 1.1], e < 0 ? [-6, -5.5] : [5.5, 6], COLORS.white);
      for (let x = lo; x <= hi; x += 12) {
        const p = [origin[0] + right[0] * x + fwd[0] * e * 5.75, deck + 1.1, origin[2] + right[1] * x + fwd[1] * e * 5.75];
        m.cylinder(p, 0.08, 3.2, 5, COLORS.boatHull);
        m.sphere([p[0], p[1] + 3.3, p[2]], 0.25, COLORS.white, 2, 5);
      }
    }
    return;
  }
  // The road and its pavements, a kerb up.
  const { half: H, pavement: P, bay: B, out: O } = BRIDGE;
  orientedBox(m, origin, right, fwd, [lo - 12, hi + 12], [deck, deck + 0.02], [-H + P, H - P], ROAD);
  for (const e of [-1, 1]) orientedBox(m, origin, right, fwd, [lo - 12, hi + 12], [deck, deck + 0.14], e < 0 ? [-H, -H + P] : [H - P, H], PAVING);
  // The balustrades, open (balusters) for 30 m either side of the bay on its
  // side, a panel elsewhere; a gap for the bay with a pedestal and lamp each side.
  const near = 30;
  for (const e of [-1, 1]) {
    const z = e * H;
    const cuts = e === bay.e ? [[lo - 12, bay.t - near, false], [bay.t - near, bay.t - B - 0.75, true], [bay.t + B + 0.75, bay.t + near, true], [bay.t + near, hi + 12, false]] : [[lo - 12, hi + 12, false]];
    for (const [x0, x1, open] of cuts) if (x1 > x0) balustrade(m, f, [x0, z], [x1, z], open);
    // Lamp standards along it, every 24 m, clear of the bay.
    for (let x = lo; x <= hi; x += 24) if (e !== bay.e || Math.abs(x - bay.t) > 12) lamp(m, f, x, z, right);
  }
  // The bay: paved, out over the water, with its own balustrade round three sides.
  const z0 = bay.e * H;
  const z1 = bay.e * (H + O);
  orientedBox(m, origin, right, fwd, [bay.t - B, bay.t + B], [deck - 0.7, deck + 0.14], bay.e < 0 ? [z1, z0] : [z0, z1], PAVING);
  orientedBox(m, origin, right, fwd, [bay.t - B, bay.t + B], [deck - 1.4, deck - 0.7], bay.e < 0 ? [z1 + 0.3, z0] : [z0, z1 - 0.3], COLORS.cream);
  balustrade(m, f, [bay.t - B, z1], [bay.t + B, z1], true);
  balustrade(m, f, [bay.t - B, z0], [bay.t - B, z1], true);
  balustrade(m, f, [bay.t + B, z0], [bay.t + B, z1], true);
  for (const side of [-1, 1]) lamp(m, f, bay.t + side * (B + 0.75), z0, right);
}

// A railway on its embankment: a ballast bed with overhead-line portals.
function railway(m, course, line) {
  let since = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (!len) continue;
    const ga = ground(course, ax, az);
    const gb = ground(course, bx, bz);
    if (ga.d < 3 || gb.d < 3 || fromRiver(course, ax, az) > 220) continue; // over the river (bridges), or out of sight
    const r = [-(bz - az) / len * 6, (bx - ax) / len * 6];
    const ya = ga.y + 1.2;
    const yb = gb.y + 1.2;
    m.quad([ax - r[0], ya, az - r[1]], [bx - r[0], yb, bz - r[1]], [bx + r[0], yb, bz + r[1]], [ax + r[0], ya, az + r[1]], COLORS.ballast);
    for (since += len; since > 60; since -= 60) {
      const f = 1 - (since - 60) / len;
      const x = ax + (bx - ax) * f;
      const z = az + (bz - az) * f;
      const y = ya + (yb - ya) * f;
      // The overhead-line masts stand clear of the riverside trees, as in the footage.
      for (const e of [-1, 1]) m.cylinder([x + r[0] * e * 1.2, y, z + r[1] * e * 1.2], 0.18, 11, 4, COLORS.mast);
      beam(m, [x - r[0] * 1.2, y + 10.8, z - r[1] * 1.2], [x + r[0] * 1.2, y + 10.8, z + r[1] * 1.2], 0.15, COLORS.mast);
    }
  }
}

// A lock: stone walls round the chamber, and black gates with white balance beams.
function lockGates(m, { gates, chamber }) {
  if (chamber) {
    for (let i = 0; i < chamber.length - 1; i++) {
      const [ax, az] = chamber[i];
      const [bx, bz] = chamber[i + 1];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const n = [-(bz - az) / len, (bx - ax) / len];
      m.quad([ax, 1.3, az], [bx, 1.3, bz], [bx + n[0] * 1.5, 1.3, bz + n[1] * 1.5], [ax + n[0] * 1.5, 1.3, az + n[1] * 1.5], COLORS.stone);
      m.quad([ax, -0.5, az], [bx, -0.5, bz], [bx, 1.3, bz], [ax, 1.3, az], COLORS.stone);
    }
  }
  for (const gate of gates) {
    const [a, b] = [gate[0], gate.at(-1)];
    beam(m, [a[0], 0.4, a[1]], [b[0], 0.4, b[1]], 0.9, COLORS.boatHull);
    for (const end of [a, b]) {
      const other = end === a ? b : a;
      const d = [end[0] - other[0], end[1] - other[1]];
      const len = Math.hypot(...d) || 1;
      beam(m, [end[0], 1.6, end[1]], [end[0] + (d[0] / len) * 5, 1.4, end[1] + (d[1] / len) * 5], 0.18, COLORS.white);
    }
  }
}

// A weir: a sill across the river with white water pouring over it.
function weirSill(m, line) {
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    beam(m, [ax, 0.3, az], [bx, 0.3, bz], 0.6, COLORS.concrete);
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const n = [-(bz - az) / len * 4, (bx - ax) / len * 4];
    m.quad([ax, 0.06, az], [bx, 0.06, bz], [bx + n[0], 0.03, bz + n[1]], [ax + n[0], 0.03, az + n[1]], COLORS.foam);
    m.quad([ax, 0.06, az], [bx, 0.06, bz], [bx - n[0], 0.03, bz - n[1]], [ax - n[0], 0.03, az - n[1]], COLORS.foam);
  }
}
