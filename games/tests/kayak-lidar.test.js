// The stretch from Caversham Bridge up past Reading Canoe Club and Caversham
// Court from Environment Agency lidar (lidar.js): the measured ground,
// buildings' heights and trees, and how wooded the banks look in the water.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { courseFromFile, pointAt } from '../reading-thames/course.js';
import { buildWorld, groundAt, bankWoods, landmarkFrame, CANOE } from '../reading-thames/world.js';
import { MeshBuilder } from '../reading-thames/meshes.js';
import { LIDAR } from '../reading-thames/lidar.js';
import { waterMap } from '../reading-thames/water.js';

const data = async (id) => JSON.parse(await readFile(new URL(`../reading-thames/courses/${id}.json`, import.meta.url), 'utf8'));
const { x0, z0, cell, w, h, dm } = LIDAR.ground;
const [x1, z1] = [x0 + (w - 1) * cell, z0 + (h - 1) * cell];
const FADE = 150; // metres beyond the patch over which its ground hands over to the made-up ground (world.js)
const inPatch = (x, z, margin = 0) => x >= x0 + margin && x <= x1 - margin && z >= z0 + margin && z <= z1 - margin;
// The measured bank top at a point (as world.js reads lidar.js).
const top = (x, z) => {
  const [u, v] = [(x - x0) / cell, (z - z0) / cell];
  const [i, j] = [Math.floor(u), Math.floor(v)];
  const q = (a, b) => dm[b * w + a] / 10;
  return (q(i, j) * (1 - (u - i)) + q(i + 1, j) * (u - i)) * (1 - (v - j)) + (q(i, j + 1) * (1 - (u - i)) + q(i + 1, j + 1) * (u - i)) * (v - j);
};
// Builds the river with lidar.js moved out of the way (as if it had none).
async function without(build) {
  const kept = { ground: LIDAR.ground, buildings: LIDAR.buildings, trees: LIDAR.trees };
  Object.assign(LIDAR, { ground: { ...LIDAR.ground, x0: 1e6, z0: 1e6 }, buildings: [], trees: [] });
  try { return await build(); } finally { Object.assign(LIDAR, kept); }
}

// The world's triangles, as { p: [[x, y, z] x 3], color }.
let triangles;
async function world() {
  if (triangles) return triangles;
  const { vertices } = buildWorld(courseFromFile(await data('reading')), 1, 'river');
  triangles = [];
  for (let i = 0; i < vertices.length; i += 27) {
    triangles.push({ p: [0, 9, 18].map((k) => [vertices[i + k], vertices[i + k + 1], vertices[i + k + 2]]), color: [vertices[i + 6], vertices[i + 7], vertices[i + 8]] });
  }
  return triangles;
}

test('lidar.js holds numbers worked out from the lidar, not the lidar itself: 5 m ground over one stretch', () => {
  assert.ok(cell >= 5, `${cell} m cells`);
  assert.equal(dm.length, w * h);
  assert.ok(dm.every(Number.isInteger), 'whole decimetres');
  assert.ok((x1 - x0) * (z1 - z0) < 600_000, `${((x1 - x0) * (z1 - z0) / 1e6).toFixed(2)} km²`);
  // The bridge, both clubs and Caversham Court Gardens (beside the canoe club, upstream) are all in it.
  assert.ok(inPatch(-526, -459, 40) && inPatch(-686, -506, 40) && inPatch(-881, -690, 40) && inPatch(-930, -700, 40));
});

test('the ground in the stretch is the measured ground, eased into the made-up ground beyond its edges', async () => {
  const reading = courseFromFile(await data('reading'));
  const river = reading.scenery.river;
  groundAt(reading, 0, 0);
  const pads = river.pads;
  river.pads = []; // (the rowing club's car park is levelled on top)
  const land = waterMap((await data('reading')).water);
  // Grid points well inside, away from the water.
  let checked = 0;
  for (let j = 10; j < h - 10; j += 7) {
    for (let i = 10; i < w - 10; i += 7) {
      const [x, z] = [x0 + i * cell, z0 + j * cell];
      const y = groundAt(reading, x, z);
      if (y < 0.3 || land.shore(x, z) < 2) continue; // the river, and the bank's step up from it
      assert.ok(Math.abs(y - dm[j * w + i] / 10) < 0.05, `at ${x}, ${z}: ${y.toFixed(2)}, measured ${dm[j * w + i] / 10}`);
      checked++;
    }
  }
  assert.ok(checked > 30, `${checked} points`);
  // Just outside, the patch's edge carries on (Caversham hill doesn't stop at it).
  for (const [x, z, ex, ez] of [[x0 - 1, -800, x0, -800], [-700, z0 - 1, -700, z0], [x1 + 1, -900, x1, -900]]) {
    assert.ok(Math.abs(groundAt(reading, x, z) - groundAt(reading, ex, ez)) < 0.1, `at ${x}, ${z}`);
  }
  // Well outside it, the made-up ground as it was.
  const lidar = river.lidar;
  const outside = [[x0 - FADE - 1, z0 + 300], [x1 + FADE + 1, z1 - 50], [x1 + FADE + 1, -900]];
  const was = outside.map(([x, z]) => groundAt(reading, x, z));
  river.lidar = null;
  assert.deepEqual(outside.map(([x, z]) => groundAt(reading, x, z)), was);
  // And the made-up ground had hummocks the meadow doesn't: 2 m and more out by the rowing club.
  const meadow = [-700, -470];
  const madeUp = groundAt(reading, ...meadow);
  river.lidar = lidar;
  river.pads = pads;
  assert.ok(Math.abs(madeUp - groundAt(reading, ...meadow)) > 2, `made up ${madeUp.toFixed(1)}, measured ${groundAt(reading, ...meadow).toFixed(1)}`);
});

test('everything outside the stretch is as it was without lidar: the made-up trees in it keep their random draws', async () => {
  const course = await data('reading');
  const vertices = (v) => {
    const out = [];
    for (let i = 0; i < v.length; i += 27) {
      // Well clear of the patch and the ground's easing beyond it (and of the trees and buildings standing
      // in that: a building's walls go down to its lowest corner's ground).
      const m = FADE + 60;
      if ([0, 9, 18].every((k) => v[i + k] < x0 - m || v[i + k] > x1 + m || v[i + k + 2] < z0 - m || v[i + k + 2] > z1 + m)) out.push(Array.from(v.subarray(i, i + 27)).join(','));
    }
    return out;
  };
  const measured = vertices(buildWorld(courseFromFile(course), 1, 'river').vertices);
  const madeUp = await without(() => vertices(buildWorld(courseFromFile(course), 1, 'river').vertices));
  assert.ok(measured.length > 200_000, `${measured.length} triangles outside`);
  assert.equal(measured.length, madeUp.length);
  assert.ok(measured.every((t, k) => t === madeUp[k]), 'the same triangles, in the same order');
});

test('no step in the ground where the measured patch meets the made-up ground', async () => {
  const reading = courseFromFile(await data('reading'));
  groundAt(reading, 0, 0);
  const land = waterMap((await data('reading')).water);
  const lines = [];
  // From beyond the easing, across it, and into the patch (on its north edge Caversham hill is 30 m up).
  const out = FADE + 10;
  for (let t = 0.1; t < 1; t += 0.2) {
    lines.push([[x0 - out, z0 + t * (z1 - z0)], [1, 0]], [[x1 + out, z0 + t * (z1 - z0)], [-1, 0]]);
    lines.push([[x0 + t * (x1 - x0), z0 - out], [0, 1]], [[x0 + t * (x1 - x0), z1 + out], [0, -1]]);
  }
  let pairs = 0;
  for (const [[sx, sz], [dx, dz]] of lines) {
    for (let k = 0; k < out + 40; k++) {
      const [a, b] = [[sx + dx * k, sz + dz * k], [sx + dx * (k + 1), sz + dz * (k + 1)]];
      if ([a, b].some(([x, z]) => land.inside(x, z) || land.shore(x, z) < 3)) continue; // (the bank's own step)
      const step = Math.abs(groundAt(reading, ...a) - groundAt(reading, ...b));
      assert.ok(step < 0.35, `${step.toFixed(2)} m in a metre at ${a.map((v) => v.toFixed(0))}`);
      pairs++;
    }
  }
  assert.ok(pairs > 2500, `${pairs} metres walked`);
});

test('the bank rises from the water to its measured top within a metre and a half: a step, not a beach', async () => {
  const reading = courseFromFile(await data('reading'));
  const land = waterMap((await data('reading')).water);
  let banks = 0;
  for (const s of [720, 760, 800, 840]) {
    const c = pointAt(reading.scenery.river, s);
    for (const side of [-1, 1]) {
      const [nx, nz] = [-c.tz * side, c.tx * side];
      let d = 0;
      while (land.inside(c.x + nx * d, c.z + nz * d) && d < 120) d += 0.05;
      const at = (e) => [c.x + nx * (d + e), c.z + nz * (d + e)];
      if (!inPatch(...at(0), 45) || land.shore(...at(2)) < 1.8) continue; // (a corner of the shore: not straight out)
      const want = top(...at(2));
      assert.ok(groundAt(reading, ...at(0.2)) < want * 0.4, `at the edge ${groundAt(reading, ...at(0.2)).toFixed(2)}, the top ${want.toFixed(2)}`);
      assert.ok(Math.abs(groundAt(reading, ...at(2)) - want) < 0.05, `2 m up the bank ${groundAt(reading, ...at(2)).toFixed(2)}, measured ${want.toFixed(2)}`);
      banks++;
    }
  }
  assert.ok(banks >= 4, `${banks} banks`);
});

test("every measured building is one of the map's footprints (a course rebuild that moved them would drop the heights)", async () => {
  const reading = await data('reading');
  for (const [cx, cz] of LIDAR.buildings) {
    const hits = reading.buildings.filter((q) => {
      const closed = q.shape[0][0] === q.shape.at(-1)[0] && q.shape[0][1] === q.shape.at(-1)[1];
      const ring = closed ? q.shape.slice(0, -1) : q.shape;
      return Math.abs(ring.reduce((a, p) => a + p[0], 0) / ring.length - cx) < 0.1 && Math.abs(ring.reduce((a, p) => a + p[1], 0) / ring.length - cz) < 0.1;
    });
    assert.equal(hits.length, 1, `${cx}, ${cz}`);
  }
});

test("the big building by Caversham Bridge stands its measured 16 m, not the map's 6", async () => {
  const reading = await data('reading');
  const [cx, cz, height] = LIDAR.buildings.find(([x, z]) => Math.hypot(x + 609, z + 409) < 5);
  assert.ok(height > 15, `${height} m`);
  const b = reading.buildings.find((q) => {
    const ring = q.shape.slice(0, -1);
    return Math.abs(ring.reduce((a, p) => a + p[0], 0) / ring.length - cx) < 0.1 && Math.abs(ring.reduce((a, p) => a + p[1], 0) / ring.length - cz) < 0.1;
  });
  assert.equal(b.height, 6, "the map's height");
  const xs = b.shape.map((p) => p[0]);
  const zs = b.shape.map((p) => p[1]);
  const over = (await world()).filter(({ p }) => p.every(([x, , z]) => x >= Math.min(...xs) - 0.1 && x <= Math.max(...xs) + 0.1 && z >= Math.min(...zs) - 0.1 && z <= Math.max(...zs) + 0.1));
  // Its flat roof (a tree's crown over it is never flat).
  const top = Math.max(...over.filter(({ p }) => p[0][1] === p[1][1] && p[1][1] === p[2][1]).map(({ p }) => p[0][1]));
  const ground = groundAt(courseFromFile(reading), cx, cz);
  assert.ok(Math.abs(top - ground - height) < 0.5, `roof ${(top - ground).toFixed(1)} m up`);
  // Its five floors of windows don't all go on one wall: every wall that faces the river gets some.
  const window = [0.15, 0.17, 0.2];
  const walls = new Set(over.filter(({ color }) => color.every((c, k) => Math.abs(c - window[k]) < 0.002)).map(({ p }) => {
    const [a, b] = [p[0], p[1][0] === p[0][0] && p[1][2] === p[0][2] ? p[2] : p[1]];
    return Math.round((Math.atan2(b[2] - a[2], b[0] - a[0]) * 180) / Math.PI / 10 + 36) % 18; // the wall's direction, in tens of degrees
  }));
  assert.ok(walls.size >= 3, `windows on ${walls.size} walls`);
});

test('the trees in the stretch are the measured ones, each its measured height; no made-up ones', async () => {
  const trunk = [0.35, 0.25, 0.17];
  // (The canoe club's model has its own trees from the footage, out to 30 m upstream of it.)
  const club = clubBox(courseFromFile(await data('reading')), 'canoe-club', 35);
  const trunks = (await world()).filter(({ p, color }) => color.every((c, k) => Math.abs(c - trunk[k]) < 0.002) && p.every(([x, , z]) => inPatch(x, z)) && !p.every(([x, , z]) => club(x, z)));
  assert.ok(trunks.length > 100, `${trunks.length} trunk triangles`);
  for (const { p } of trunks) {
    const [x, z] = [(p[0][0] + p[1][0] + p[2][0]) / 3, (p[0][2] + p[1][2] + p[2][2]) / 3];
    const tree = LIDAR.trees.find(([tx, tz]) => Math.hypot(tx - x, tz - z) < 1);
    assert.ok(tree, `a trunk at ${x.toFixed(1)}, ${z.toFixed(1)} that lidar doesn't have`);
    // A trunk is the lower 35% of its tree.
    const height = Math.max(...p.map((q) => q[1])) - Math.min(...p.map((q) => q[1]));
    assert.ok(Math.abs(height - tree[2] * 0.35) < 0.05, `trunk ${height.toFixed(1)} m for a ${tree[2]} m tree`);
  }
});

// Whether (x, z) is within `margin` metres of a landmark's footprint, in its frame.
function clubBox(course, style, margin) {
  groundAt(course, 0, 0);
  const f = landmarkFrame(course, style);
  return (x, z) => {
    const [dx, dz] = [x - f.origin[0], z - f.origin[2]];
    const [u, v] = [dx * f.right[0] + dz * f.right[1], dx * f.fwd[0] + dz * f.fwd[1]];
    return u > f.along[0] - margin && u < f.along[1] + margin && v > f.depth[0] - margin && v < f.edge + margin;
  };
}

test("measured trees keep off a landmark: none on the canoe club's forecourt or by its back doors (the walk's shot)", async () => {
  const reading = courseFromFile(await data('reading'));
  const near = clubBox(reading, 'canoe-club', 6);
  // Lidar has trees there (the club's own two, and more on its forecourt and lawn)...
  assert.ok(LIDAR.trees.filter(([x, z]) => near(x, z)).length >= 3);
  // ...but the world plants none of them: the club's model has its trees.
  const trunk = [0.35, 0.25, 0.17];
  const planted = (await world()).filter(({ p, color }) => color.every((c, k) => Math.abs(c - trunk[k]) < 0.002) && p.every(([x, , z]) => near(x, z)));
  const theirs = planted.filter(({ p }) => LIDAR.trees.some(([tx, tz]) => Math.hypot(tx - p[0][0], tz - p[0][2]) < 1));
  assert.equal(theirs.length, 0, `${theirs.length} trunk triangles of measured trees`);
});

test('Caversham hill: the ground behind the canoe club climbs as measured, and the meadow across the river is flat', async () => {
  const reading = courseFromFile(await data('reading'));
  const river = reading.scenery.river;
  // d metres out from mid-river (the river is about 25 m across here).
  const out = (s, side, d) => {
    const c = pointAt(river, s);
    return [c.x - c.tz * side * d, c.z + c.tx * side * d];
  };
  const madeUp = await without(() => groundAt(reading, ...out(1170, 1, 80)));
  const hill = groundAt(reading, ...out(1170, 1, 80));
  assert.ok(hill > 8, `80 m back from mid-river: ${hill.toFixed(1)} m`);
  assert.ok(hill - madeUp > 4, `made up ${madeUp.toFixed(1)} m`);
  for (const s of [1140, 1170, 1200]) {
    const y = groundAt(reading, ...out(s, -1, 55));
    assert.ok(y > 0.4 && y < 1.6, `the Reading meadow at ${s}: ${y.toFixed(1)} m`);
  }
});

test('a building on a slope goes down to its lowest corner (a house on Caversham hill stood clear of its downhill side)', async () => {
  const reading = await data('reading');
  const course = courseFromFile(reading);
  let checked = 0;
  for (const b of reading.buildings) {
    if (b.style) continue;
    const ring = b.shape.slice(0, -1);
    if (!ring.every(([x, z]) => inPatch(x, z, 10))) continue;
    const grounds = ring.map(([x, z]) => groundAt(course, x, z));
    if (Math.max(...grounds) - Math.min(...grounds) < 2) continue;
    const xs = ring.map((p) => p[0]);
    const zs = ring.map((p) => p[1]);
    const walls = (await world()).filter(({ p }) => p.every(([x, , z]) => x >= Math.min(...xs) - 0.01 && x <= Math.max(...xs) + 0.01 && z >= Math.min(...zs) - 0.01 && z <= Math.max(...zs) + 0.01));
    const bottom = Math.min(...walls.flatMap(({ p }) => p.map((q) => q[1])));
    assert.ok(bottom <= Math.min(...grounds), `${b.shape[0]}: walls down to ${bottom.toFixed(1)}, lowest corner ${Math.min(...grounds).toFixed(1)}`);
    checked++;
  }
  assert.ok(checked >= 5, `${checked} houses on a slope`);
});

test("the canoe club's forecourt stands about 2 m over the water, as the footage and lidar show (not lifted by the hill behind)", async () => {
  const reading = courseFromFile(await data('reading'));
  groundAt(reading, 0, 0);
  const f = landmarkFrame(reading, 'canoe-club');
  const front = Math.min(f.depth[1], f.edge - 9);
  const court = f.at(0, 0, (front + f.edge - 3.6) / 2);
  const y = groundAt(reading, court[0], court[2]);
  assert.ok(y > 1.7 && y < 2.6, `${y.toFixed(2)} m`);
  const wall = f.at(0, 0, front);
  assert.ok(groundAt(reading, wall[0], wall[2]) - y > 0.3, 'at the wall the ground is filled in from the hill');
  // The model's paving is at that height: the top of its concrete, flat, in front of the club.
  const onCourt = ([x, , z]) => {
    const [dx, dz] = [x - f.origin[0], z - f.origin[2]];
    const v = dx * f.fwd[0] + dz * f.fwd[1];
    return Math.abs(dx * f.right[0] + dz * f.right[1]) < 50 && v > front - 0.1 && v < f.edge - 3.5;
  };
  const paving = (await world()).filter(({ p, color }) => color.every((c, k) => Math.abs(c - CANOE.concrete[k]) < 0.002) && p.every(onCourt) && p[0][1] === p[1][1] && p[1][1] === p[2][1]);
  const top = Math.max(...paving.map(({ p }) => p[0][1]));
  assert.ok(Math.abs(top - (y + 0.04)) < 0.05, `paving at ${top.toFixed(2)} m, the forecourt's ground ${y.toFixed(2)} m`);
});

test("a sphere draws no triangles without area (its poles' were a third of every crown)", () => {
  const m = new MeshBuilder();
  m.sphere([0, 0, 0], 2, [1, 1, 1], 3, 6);
  const { vertices, count } = m.build();
  assert.equal(count / 3, 2 * 3 * 6 - 2 * 6);
  for (let i = 0; i < vertices.length; i += 27) {
    const [a, b, c] = [0, 9, 18].map((k) => [vertices[i + k], vertices[i + k + 1], vertices[i + k + 2]]);
    const [u, v] = [[b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]];
    const cross = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
    assert.ok(cross > 1e-6, 'a triangle with no area');
  }
});

test("the water mirrors the stretch's measured tree line: a wall of trees on the Caversham bank, the open bank by the rowing club", async () => {
  const reading = courseFromFile(await data('reading'));
  const p = pointAt(reading.scenery.river, 810);
  const [left, right] = bankWoods(reading, p.x, p.z, p.tx, p.tz);
  assert.ok(right > 0.9, `Caversham bank ${right}`);
  assert.ok(left < 0.2, `rowing club bank ${left}`);
});

test('the game credits the Environment Agency for the lidar, as its licence asks', async () => {
  const page = await readFile(new URL('../reading-thames/index.html', import.meta.url), 'utf8');
  assert.match(page, /&copy; Environment Agency copyright and\/or database right/);
  assert.match(page, /Open Government Licence/);
});
