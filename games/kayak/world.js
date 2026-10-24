// Builds the static scenery for a course into one mesh: river banks with a
// towpath, trees, moored narrowboats, brick bridges, distant hills, start and
// finish gantries and distance markers. A real river (course.scenery, from a
// course file) gets its own buildings, bridges, boats, woods, railway and lock
// instead of the made-up ones. Pure, no GPU.
import { MeshBuilder } from './meshes.js';
import { locate, pointAt, widthAt } from './course.js';

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
  beak: [0.95, 0.5, 0.12],
};

// Narrowboat paintwork: cabin sides, and the trim along the top.
const PAINT = [
  [[0.12, 0.32, 0.2], [0.75, 0.15, 0.12]],
  [[0.45, 0.08, 0.1], [0.9, 0.75, 0.2]],
  [[0.1, 0.18, 0.4], [0.85, 0.85, 0.8]],
  [[0.2, 0.2, 0.22], [0.8, 0.3, 0.1]],
  [[0.6, 0.12, 0.08], [0.1, 0.3, 0.15]],
];

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

export function buildWorld(course, seed = 1) {
  const rand = mulberry32(seed);
  const m = new MeshBuilder();
  const { samples } = course;
  const stride = 3; // bank quads every 6 m
  const real = course.scenery;
  const profile = real ? REAL_PROFILE : PROFILE;

  // The towpath runs along the left bank; a real river's banks are coloured by
  // what's on them.
  for (const side of [-1, 1]) {
    for (let i = 0; i + stride < samples.length; i += stride) {
      const a = samples[i];
      const b = samples[i + stride];
      const cover = real && coverAt(real, side, a.s);
      for (let k = 0; k < profile.length - 1; k++) {
        const [d0, h0] = profile[k];
        const [d1, h1] = profile[k + 1];
        const p = (s, d, h) => [s.x + -s.tz * side * (s.half + d), h + bump(s.x, s.z, d), s.z + s.tx * side * (s.half + d)];
        const green = real
          ? (k <= 2 && (cover === 'park' || cover === 'gardens') ? COLORS.mown : k <= 2 ? SHADED : COLORS.meadow)
          : k === 1 ? (side < 0 ? COLORS.towpath : COLORS.grass) : COLORS.meadow;
        const color = k === 0 ? COLORS.mud : shade(green, rand, 0.08);
        m.quad(p(a, d0, h0), p(b, d0, h0), p(b, d1, h1), p(a, d1, h1), color);
      }
    }
  }
  const half = Math.max(...samples.map((p) => p.half));

  // Close the river off just before the start and after the end. A real river's
  // banks reach much further, so its ends are closed further back too (at the
  // far end of the Reading Thames, just behind a lock's gates).
  for (const s of [0, course.length]) {
    const c = pointAt(course, s);
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

  if (real) realScenery(m, course, real, rand);

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

  course.moorings.forEach((boat, k) => {
    if (boat.kind === 'cruiser' || boat.kind === 'trip-boat') cruiser(m, course, boat, rand);
    else narrowboat(m, course, boat, PAINT[k % PAINT.length]);
  });
  for (const b of course.bridges) {
    if (typeof b === 'number') bridge(m, course, b);
    else if (b.style === 'cable-stayed') cableStayedBridge(m, course, b);
    else if (b.style === 'concrete-arch') concreteBridge(m, course, b);
    else bridge(m, course, b.s);
  }

  // Hills on the horizon, kept well clear of every part of the river.
  const xs = samples.map((p) => p.x);
  const zs = samples.map((p) => p.z);
  const box = [Math.min(...xs) - 900, Math.min(...zs) - 900, Math.max(...xs) + 900, Math.max(...zs) + 900];
  for (let placed = 0, tries = 0; placed < 60 && tries < 2000; tries++) {
    const x = box[0] + rand() * (box[2] - box[0]);
    const z = box[1] + rand() * (box[3] - box[1]);
    const radius = 120 + rand() * 160;
    if (Math.abs(locate(course, x, z).lateral) < radius + 450) continue;
    m.cone([x, 0, z], radius, 50 + rand() * 90, 7, shade(COLORS.hill, rand, 0.1));
    placed++;
  }

  gantry(m, course, course.start, COLORS.start, COLORS.post);
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

  return m.build();
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

// A narrowboat moored against the bank: black hull, painted cabin, a roof
// and a chimney, with a pointed bow upstream.
function narrowboat(m, course, { s, length, side }, [paint, trim]) {
  const c = pointAt(course, s);
  const w = widthAt(course, s).half;
  const right = [-c.tz, c.tx];
  const fwd = [c.tx, c.tz];
  const origin = [c.x + right[0] * side * (w - 1.05), 0, c.z + right[1] * side * (w - 1.05)];
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
    orientedBox(m, origin, right, fwd, [-0.97, 0.97], [0.95, 1.3], [z, z + 0.6], COLORS.window);
  }
  const chimney = at(0.3, 1.78, half - 4.5);
  m.cylinder(chimney, 0.08, 0.6, 6, COLORS.boatHull);
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
function tree(m, x, y, z, rand, real = false) {
  const pine = !real && rand() < 0.2; // mostly broadleaf: oaks, willows, alders
  const h = pine ? 7 + rand() * 9 : real ? 9 + rand() * 9 : 5 + rand() * 6;
  m.cylinder([x, y - 0.3, z], 0.2 + h * 0.015, h * 0.35, 5, COLORS.trunk);
  if (pine) {
    for (let k = 0; k < 3; k++) {
      m.cone([x, y + h * (0.25 + k * 0.22), z], h * (0.32 - k * 0.07), h * 0.42, 7, shade(COLORS.pine, rand, 0.1));
    }
  } else if (real) {
    // A big riverside crown, its lower branches reaching down to the water.
    const leaf = LEAVES[Math.floor(rand() * LEAVES.length)];
    const r = h * 0.34;
    m.sphere([x, y + h * 0.64, z], r, shade(leaf, rand, 0.1), 3, 6);
    const a = rand() * Math.PI * 2;
    m.sphere([x + Math.cos(a) * r * 0.7, y + h * 0.36, z + Math.sin(a) * r * 0.7], r * 0.85, shade(leaf, rand, 0.15), 3, 6);
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

// The ground under any point beside a real river, and how far it is from the water.
function ground(course, x, z) {
  const at = locate(course, x, z);
  const d = Math.abs(at.lateral) - widthAt(course, at.s).half;
  return { d, y: d < 0 ? -0.4 : groundHeight(d, REAL_PROFILE) + bump(x, z, d) };
}

// How each kind of bank is planted: trees per 6 m of bank, how far back, and
// how many of them are weeping willows.
// `again`: the chance of a second tree further back.
const PLANTING = {
  trees: { chance: 1, again: 0.5, near: 2, far: 30, willow: 0.2, bushes: 0.7 },
  wild: { chance: 1, again: 0.7, near: 1, far: 25, willow: 0.2, bushes: 1 },
  park: { chance: 0.35, again: 0, near: 6, far: 14, willow: 0.45, bushes: 0 },
  gardens: { chance: 0.45, again: 0.2, near: 5, far: 45, willow: 0.35, bushes: 0.15, stages: 0.15 },
};

function realScenery(m, course, real, rand) {
  // Building footprints, binned so trees can keep out of them.
  const bins = new Map();
  const key = (x, z) => `${Math.floor(x / 20)},${Math.floor(z / 20)}`;
  for (const b of real.buildings) {
    const xs = b.shape.map((p) => p[0]);
    const zs = b.shape.map((p) => p[1]);
    const box = [Math.min(...xs) - 2, Math.min(...zs) - 2, Math.max(...xs) + 2, Math.max(...zs) + 2];
    for (let x = box[0]; x <= box[2] + 20; x += 20) {
      for (let z = box[1]; z <= box[3] + 20; z += 20) {
        const k = key(Math.min(x, box[2]), Math.min(z, box[3]));
        bins.set(k, [...(bins.get(k) ?? []), box]);
      }
    }
  }
  const built = (x, z) => (bins.get(key(x, z)) ?? []).some((b) => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3]);
  const plant = (x, z, willow) => {
    const g = ground(course, x, z);
    if (g.d < 1.5 || built(x, z)) return;
    if (willow) willowTree(m, x, g.y, z, rand);
    else tree(m, x, g.y, z, rand, true);
  };

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
        m.sphere([x, 0.4, z], 2 + rand() * 1.8, shade(LEAVES[Math.floor(rand() * LEAVES.length)], rand, 0.15), 3, 6);
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
        if (!inside(wood, px, pz) || ground(course, px, pz).d > 200) continue;
        plant(px, pz, rand() < 0.1);
      }
    }
  }
  for (const [x, z] of real.trees) plant(x, z, false);

  for (const b of real.buildings) building(m, course, b, rand);
  for (const w of real.walls ?? []) embankment(m, course, w, rand);
  swans(m, course, real, rand);
  for (const line of real.railways) railway(m, course, line);
  for (const lock of real.locks) lockGates(m, lock);
  for (const weir of real.weirs) weirSill(m, weir);
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
function willowTree(m, x, y, z, rand) {
  const h = 10 + rand() * 6;
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
function embankment(m, course, { side, from, to }, rand) {
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

// Mute swans, in pairs and small groups, a few metres out from the bank;
// most of them in town.
function swans(m, course, real, rand) {
  for (let s = course.start - 40; s < course.finish; s += rand() < 0.5 ? 90 : 160) {
    if (s > 1600 && rand() < 0.75) continue;
    const side = rand() < 0.5 ? -1 : 1;
    if (real.moorings.some((b) => b.side === side && Math.abs(b.s - s) < b.length)) continue;
    const c = pointAt(course, s);
    const w = widthAt(course, s).half;
    const group = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < group; k++) {
      const d = w - 3 - rand() * 5;
      const along = (rand() - 0.5) * 8;
      const x = c.x - c.tz * side * d + c.tx * along;
      const z = c.z + c.tx * side * d + c.tz * along;
      swan(m, x, z, Math.atan2(c.tx, -c.tz) + (rand() - 0.5) * 2.5);
    }
  }
}

function swan(m, x, z, heading) {
  const f = [Math.sin(heading), -Math.cos(heading)];
  const at = (ahead, y) => [x + f[0] * ahead, y, z + f[1] * ahead];
  m.sphere(at(0, 0.12), 0.38, COLORS.white, 3, 6);
  m.sphere(at(-0.35, 0.2), 0.26, COLORS.white, 2, 5);
  beam(m, at(0.3, 0.25), at(0.42, 0.62), 0.06, COLORS.white);
  beam(m, at(0.42, 0.62), at(0.36, 0.9), 0.055, COLORS.white);
  m.sphere(at(0.42, 0.92), 0.08, COLORS.white, 2, 5);
  beam(m, at(0.46, 0.91), at(0.6, 0.88), 0.03, COLORS.beak);
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
  const y0 = g.y - 1;
  const top = g.y + b.height;
  const wall = b.kind === 'boathouse' ? (rand() < 0.5 ? COLORS.white : [0.3, 0.42, 0.33]) : WALLS[Math.floor(rand() * WALLS.length)];
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
  if (g.d < 150 && b.kind !== 'boathouse') {
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
  if (b.kind === 'boathouse' && g.d < 45) pontoon(m, course, river, Math.min(30, Math.max(15, Math.sqrt(area(ring)) * 2)));
  const pitched = b.kind === 'house' || b.kind === 'boathouse';
  const roof = pitched ? ROOFS[Math.floor(rand() * ROOFS.length)] : COLORS.coping;
  const peak = [cx, top + (pitched ? Math.min(4, 1.5 + Math.sqrt(area(ring)) * 0.18) : 0), cz];
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    m.tri([ax, top, az], [bx, top, bz], peak, roof);
  }
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
function cruiser(m, course, { s, length, side, kind }, rand) {
  const c = pointAt(course, s);
  const w = widthAt(course, s).half;
  const beamW = kind === 'trip-boat' ? 2.3 : 1.7;
  const right = [-c.tz, c.tx];
  const fwd = [c.tx, c.tz];
  const origin = [c.x + right[0] * side * (w - beamW), 0, c.z + right[1] * side * (w - beamW)];
  const half = length / 2;
  const at = (x, y, z) => [origin[0] + right[0] * x + fwd[0] * z, y, origin[2] + right[1] * x + fwd[1] * z];
  orientedBox(m, origin, right, fwd, [-beamW, beamW], [-0.3, 0.9], [-half, half - 2], COLORS.white);
  orientedBox(m, origin, right, fwd, [-beamW - 0.01, beamW + 0.01], [0.25, 0.45], [-half, half - 2], rand() < 0.5 ? COLORS.navy : [0.6, 0.12, 0.1]);
  for (const e of [-1, 1]) {
    m.triFacing(at(e * beamW, -0.3, half - 2), at(e * beamW, 0.9, half - 2), at(0, 1.0, half), COLORS.white, [right[0] * e, 0, right[1] * e]);
    m.triFacing(at(e * beamW, -0.3, half - 2), at(0, -0.3, half - 0.6), at(0, 1.0, half), COLORS.white, [right[0] * e, 0, right[1] * e]);
  }
  m.triFacing(at(-beamW, 0.9, half - 2), at(beamW, 0.9, half - 2), at(0, 1.0, half), COLORS.white, [0, 1, 0]);
  const decks = kind === 'trip-boat' ? 2 : 1;
  for (let d = 0; d < decks; d++) {
    const y = 0.9 + d * 1.9;
    orientedBox(m, origin, right, fwd, [-beamW + 0.3, beamW - 0.3], [y, y + 1.5], [-half + 1, half - 4 - d * 2], COLORS.white);
    orientedBox(m, origin, right, fwd, [-beamW + 0.28, beamW - 0.28], [y + 0.5, y + 1.15], [-half + 1.5, half - 4.5 - d * 2], COLORS.glass);
  }
}

// A cable-stayed foot bridge: a slim white deck from bank to bank, hung from
// one tall leaning mast on one bank by a fan of cables.
function cableStayedBridge(m, course, { s, mast = -1 }) {
  const c = pointAt(course, s);
  const right = [-c.tz, c.tx];
  const fwd = [c.tx, c.tz];
  const origin = [c.x, 0, c.z];
  const span = widthAt(course, s).half + 12;
  const deck = 5.5;
  orientedBox(m, origin, right, fwd, [-span, span], [deck - 0.6, deck], [-2.2, 2.2], COLORS.steel);
  for (const e of [-1, 1]) orientedBox(m, origin, right, fwd, [-span, span], [deck, deck + 1.1], e < 0 ? [-2.2, -2.1] : [2.1, 2.2], COLORS.steel);
  const at = (x, y, z) => [origin[0] + right[0] * x + fwd[0] * z, y, origin[2] + right[1] * x + fwd[1] * z];
  const foot = at(mast * (span - 6), 0, 0);
  const tip = at(mast * (span - 14), 39, 0);
  beam(m, foot, tip, 0.6, COLORS.white);
  for (let k = 1; k <= 7; k++) {
    const x = mast * (span - 6) - mast * k * ((2 * span - 10) / 8);
    for (const z of [-2, 2]) beam(m, at(mast * (span - 13.5), 37 - k * 1.5, z * 0.15), at(x, deck, z), 0.05, COLORS.steel);
  }
}

// A 1920s concrete road bridge: two wide flat arches on a pier, a pale stone
// face, balustrades and lamp posts.
function concreteBridge(m, course, { s }) {
  const c = pointAt(course, s);
  const right = [-c.tz, c.tx];
  const fwd = [c.tx, c.tz];
  const origin = [c.x, 0, c.z];
  const span = widthAt(course, s).half + 2;
  const deck = 6.5;
  const pier = span * 0.35; // the pier stands to one side of the main channel
  const arches = [[-span, pier - 2], [pier + 2, span]];
  for (const [a, b] of arches) {
    const mid = (a + b) / 2;
    const half = (b - a) / 2;
    const under = (x) => 1.2 + 3.6 * Math.sqrt(Math.max(0, 1 - ((x - mid) / half) ** 2));
    const n = 16;
    for (let k = 0; k < n; k++) {
      const x0 = a + ((b - a) * k) / n;
      const x1 = a + ((b - a) * (k + 1)) / n;
      orientedBox(m, origin, right, fwd, [x0, x1], [under((x0 + x1) / 2), deck], [-6, 6], COLORS.cream);
    }
  }
  orientedBox(m, origin, right, fwd, [pier - 2, pier + 2], [-0.5, deck], [-6.5, 6.5], COLORS.stone);
  for (const e of [-1, 1]) {
    orientedBox(m, origin, right, fwd, e < 0 ? [-span - 12, -span] : [span, span + 12], [-0.5, deck], [-6.5, 6.5], COLORS.stone);
    orientedBox(m, origin, right, fwd, [-span - 12, span + 12], [deck, deck + 1.1], e < 0 ? [-6, -5.5] : [5.5, 6], COLORS.white);
    for (let x = -span; x <= span; x += 12) {
      const p = [origin[0] + right[0] * x + fwd[0] * e * 5.75, deck + 1.1, origin[2] + right[1] * x + fwd[1] * e * 5.75];
      m.cylinder(p, 0.08, 3.2, 5, COLORS.boatHull);
      m.sphere([p[0], p[1] + 3.3, p[2]], 0.25, COLORS.white, 2, 5);
    }
  }
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
    if (ga.d < 3 || gb.d < 3 || ga.d > 220) continue; // over the river (bridges), or out of sight
    const r = [-(bz - az) / len * 6, (bx - ax) / len * 6];
    const ya = ga.y + 1.2;
    const yb = gb.y + 1.2;
    m.quad([ax - r[0], ya, az - r[1]], [bx - r[0], yb, bz - r[1]], [bx + r[0], yb, bz + r[1]], [ax + r[0], ya, az + r[1]], COLORS.ballast);
    for (since += len; since > 60; since -= 60) {
      const f = 1 - (since - 60) / len;
      const x = ax + (bx - ax) * f;
      const z = az + (bz - az) * f;
      const y = ya + (yb - ya) * f;
      for (const e of [-1, 1]) m.cylinder([x + r[0] * e * 1.2, y, z + r[1] * e * 1.2], 0.15, 7.5, 4, COLORS.mast);
      beam(m, [x - r[0] * 1.2, y + 7.3, z - r[1] * 1.2], [x + r[0] * 1.2, y + 7.3, z + r[1] * 1.2], 0.15, COLORS.mast);
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
