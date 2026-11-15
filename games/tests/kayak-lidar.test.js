// The reach from Caversham Lock to Mapledurham Lock from Environment Agency
// lidar (lidar.js): the measured ground in 250 m blocks, buildings' heights and
// trees, and how wooded the banks look in the water.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { courseFromFile, pointAt, locate, widthAt } from '../reading-thames/course.js';
import { buildWorld, groundAt, bankWoods, landmarkFrame, lidarTop, CANOE, FADE } from '../reading-thames/world.js';
import { MeshBuilder } from '../reading-thames/meshes.js';
import { LIDAR } from '../reading-thames/lidar.js';
import { waterMap } from '../reading-thames/water.js';

const data = async (id) => JSON.parse(await readFile(new URL(`../reading-thames/courses/${id}.json`, import.meta.url), 'utf8'));
const { cell, block, blocks } = LIDAR.ground;
const keys = Object.keys(blocks).map((k) => k.split(',').map(Number));
// The blocks' bounds, and how far (x, z) is outside every block (0 in one).
const [x0, z0, x1, z1] = [Math.min(...keys.map((k) => k[0])) * block, Math.min(...keys.map((k) => k[1])) * block, (Math.max(...keys.map((k) => k[0])) + 1) * block, (Math.max(...keys.map((k) => k[1])) + 1) * block];
const outside = (x, z) => {
  if (x < x0 - 1000 || x > x1 + 1000 || z < z0 - 1000 || z > z1 + 1000) return Infinity;
  return Math.min(...keys.map(([i, j]) => Math.hypot(Math.max(0, i * block - x, x - (i + 1) * block), Math.max(0, j * block - z, z - (j + 1) * block))));
};
const inPatch = (x, z, margin = 0) => [[0, 0], [margin, 0], [-margin, 0], [0, margin], [0, -margin]].every(([a, b]) => outside(x + a, z + b) === 0);
// The measured bank top at a point (as world.js reads lidar.js).
const top = (x, z) => lidarTop(LIDAR, x, z).top;
// The middle of each block's side with no block beyond it, and the way out.
const edges = keys.flatMap(([i, j]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([a, b]) => !blocks[`${i + a},${j + b}`]).map(([a, b]) => [[(i + 0.5 + a / 2) * block, (j + 0.5 + b / 2) * block], [a, b]]));
// Builds the river with lidar.js moved out of the way (as if it had none).
async function without(build) {
  const kept = { ground: LIDAR.ground, buildings: LIDAR.buildings, trees: LIDAR.trees, woods: LIDAR.woods, edge: LIDAR.edge };
  Object.assign(LIDAR, { ground: { cell, block, blocks: {} }, buildings: [], trees: [], woods: undefined, edge: undefined });
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

test('lidar.js holds numbers worked out from the lidar, not the lidar itself: 5 m ground, in blocks beside the river', () => {
  assert.ok(cell >= 5, `${cell} m cells`);
  for (const [key, text] of Object.entries(blocks)) {
    const v = text.split(',').map(Number);
    assert.equal(v.length, (block / cell + 1) ** 2, key);
    assert.ok(v.every(Number.isInteger), 'whole decimetres');
  }
  assert.ok(keys.length * block * block < 8e6, `${(keys.length * block * block / 1e6).toFixed(2)} km²`);
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
  // Points well inside, away from the water.
  let checked = 0;
  for (let x = x0 + 5; x < x1; x += 35) {
    for (let z = z0 + 5; z < z1; z += 35) {
      if (!inPatch(x, z, 10)) continue;
      const y = groundAt(reading, x, z);
      if (y < 0.3 || land.shore(x, z) < 2) continue; // the river, and the bank's step up from it
      assert.ok(Math.abs(y - top(x, z)) < 0.05, `at ${x}, ${z}: ${y.toFixed(2)}, measured ${top(x, z).toFixed(2)}`);
      checked++;
    }
  }
  assert.ok(checked > 30, `${checked} points`);
  // Just outside, the blocks' edge carries on (Caversham hill doesn't stop at it).
  let edgesChecked = 0;
  for (const [[x, z], [a, b]] of edges) {
    if (land.inside(x, z) || land.shore(x, z) < 3) continue;
    assert.ok(Math.abs(groundAt(reading, x + a, z + b) - groundAt(reading, x, z)) < 0.1, `at ${x}, ${z}`);
    edgesChecked++;
  }
  assert.ok(edgesChecked >= 4, `${edgesChecked} edges`);
  // Well outside them, the made-up ground as it was.
  const lidar = river.lidar;
  const far = edges.map(([[x, z], [a, b]]) => [x + a * (FADE + 1), z + b * (FADE + 1)]).filter(([x, z]) => outside(x, z) > FADE);
  assert.ok(far.length >= 3);
  const was = far.map(([x, z]) => groundAt(reading, x, z));
  river.lidar = null;
  assert.deepEqual(far.map(([x, z]) => groundAt(reading, x, z)), was);
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
      if ([0, 9, 18].every((k) => outside(v[i + k], v[i + k + 2]) > FADE + 20)) out.push(Array.from(v.subarray(i, i + 27)).join(','));
    }
    return out;
  };
  const measured = vertices(buildWorld(courseFromFile(course), 1, 'river').vertices);
  const madeUp = await without(() => vertices(buildWorld(courseFromFile(course), 1, 'river').vertices));
  assert.ok(measured.length > 100, `${measured.length} triangles outside`);
  assert.equal(measured.length, madeUp.length);
  assert.ok(measured.every((t, k) => t === madeUp[k]), 'the same triangles, in the same order');
});

test('with one block of lidar, everything beyond its easing is as it was without: the ground, and every triangle', async () => {
  // (The real blocks now cover nearly all the river: one block, by the canoe club, leaves most of it outside.)
  const course = await data('reading');
  const kept = { ground: LIDAR.ground, buildings: LIDAR.buildings, trees: LIDAR.trees, woods: LIDAR.woods, edge: LIDAR.edge };
  const key = '-4,-3';
  const inIt = ([x, z]) => x >= -1000 && x < -750 && z >= -750 && z < -500;
  const one = (x, z) => Math.hypot(Math.max(0, -1000 - x, x + 750), Math.max(0, -750 - z, z + 500));
  const far = (v) => { const out = []; for (let i = 0; i < v.length; i += 27) if ([0, 9, 18].every((k) => one(v[i + k], v[i + k + 2]) > FADE + 20)) out.push(Array.from(v.subarray(i, i + 27)).join(',')); return out; };
  // (Its trees and buildings only; the bank's leaves and reflections are the whole river's, so left out.)
  Object.assign(LIDAR, { ground: { cell, block, blocks: { [key]: blocks[key] } }, buildings: kept.buildings.filter(inIt), trees: kept.trees.filter(inIt), woods: undefined, edge: undefined });
  let measured;
  try { measured = far(buildWorld(courseFromFile(course), 1, 'river').vertices); } finally { Object.assign(LIDAR, kept); }
  const madeUp = await without(() => far(buildWorld(courseFromFile(course), 1, 'river').vertices));
  assert.ok(measured.length > 150_000, `${measured.length} triangles beyond it`);
  assert.equal(measured.length, madeUp.length);
  assert.ok(measured.every((t, k) => t === madeUp[k]), 'the same triangles, in the same order');
});

test('beyond the blocks the edges blend: at an inside corner the ground runs on smoothly between two blocks', () => {
  // An L of three 250 m blocks, two at 10 m and one at 20 m; the fourth square empty.
  const flat = (dm) => Array.from({ length: (block / cell + 1) ** 2 }, (_, k) => (k % (block / cell + 1) === 0 ? dm : 0)).join(',');
  const L = { ground: { cell, block, blocks: { '0,0': flat(100), '1,0': flat(200), '0,1': flat(100) } } };
  assert.equal(lidarTop(L, 100, 100).top, 10, 'in a block, its own');
  assert.equal(lidarTop(L, 250, 100).top, 20, 'on a shared edge, the block it falls in');
  // Round the empty square's corner (250, 250), 30 m out: no jump between one metre and the next.
  let last = null;
  for (let a = 0; a <= 90; a += 0.5) {
    const r = (a * Math.PI) / 180;
    const t = lidarTop(L, 250 + Math.cos(r) * 30, 250 + Math.sin(r) * 30);
    assert.ok(Math.abs(t.out - 30) < 1e-6 || t.out < 30, 'out is the distance to the nearest block');
    if (last !== null) assert.ok(Math.abs(t.top - last) < 0.2, `${(t.top - last).toFixed(2)} m at ${a}°`);
    last = t.top;
  }
  assert.equal(lidarTop(L, 250 + FADE + 1, 250 + FADE + 1), null, 'nothing beyond FADE');
});

test("every block's rim is ground above the water (a corner once came out 0 m)", () => {
  const n = block / cell + 1;
  for (const [key, text] of Object.entries(blocks)) {
    const v = text.split(',').map(Number);
    for (let r = 0; r < n; r++) for (let c = 1; c < n; c++) v[r * n + c] += v[r * n + c - 1];
    for (let k = 0; k < n; k++) for (const i of [k, (n - 1) * n + k, k * n, k * n + n - 1]) assert.ok(v[i] > 0, `${key}: ${v[i]} dm at its rim`);
  }
});

test('no step in the ground where the measured patch meets the made-up ground', async () => {
  const reading = courseFromFile(await data('reading'));
  groundAt(reading, 0, 0);
  const land = waterMap((await data('reading')).water);
  // From beyond the easing, across it, and into the blocks (on Caversham hill 30 m up), at each open edge's middle.
  const out = FADE + 10;
  const lines = edges.flatMap(([[x, z], [a, b]]) => [-120, -60, 0, 60, 120].map((t) => [[x + a * out + b * t, z + b * out + a * t], [-a, -b]]));
  let pairs = 0;
  for (const [[sx, sz], [dx, dz]] of lines) {
    for (let k = 0; k < out + 40; k++) {
      const [a, b] = [[sx + dx * k, sz + dz * k], [sx + dx * (k + 1), sz + dz * (k + 1)]];
      if ([a, b].some(([x, z]) => land.inside(x, z) || land.shore(x, z) < 3)) continue; // (the bank's own step)
      // (Inside, and within 10 m outside, it's the real ground's own slope: The Warren is steep, and
      // just outside a block its edge carries on, an embankment by Caversham Lock with it. The blend
      // between blocks has its own test, above.)
      if ([a, b].every(([x, z]) => outside(x, z) < 10)) continue;
      // (Past where the land ends, 320 m from the water, there's no ground to see.)
      if ([a, b].some(([x, z]) => { const at = locate(reading.scenery.river, x, z); return Math.abs(at.lateral) - widthAt(reading.scenery.river, at.s).half > 320; })) continue;
      const step = Math.abs(groundAt(reading, ...a) - groundAt(reading, ...b));
      assert.ok(step < 0.35, `${step.toFixed(2)} m in a metre at ${a.map((v) => v.toFixed(0))}`);
      pairs++;
    }
  }
  assert.ok(pairs > 5000, `${pairs} metres walked`);
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
  // (And the things pointed out in the footage, which plant their own: a weeping willow, the bank of trees
  // beside the deck boathouse, the riverside villa's three.)
  const raw = await data('reading');
  const own = [...(raw.features ?? []).map(({ at }) => [...at, 25]), ...raw.buildings.filter((b) => ['riverside-villa', 'tudor-boathouse', 'spiral-boathouse', 'grey-boathouse', 'glass-house', 'victorian', 'boatyard', 'island-bar'].includes(b.style)).map((b) => [b.shape[0][0], b.shape[0][1], 40])];
  const byFeature = (x, z) => own.some(([ax, az, r]) => Math.hypot(ax - x, az - z) < r);
  const trunks = (await world()).filter(({ p, color }) => color.every((c, k) => Math.abs(c - trunk[k]) < 0.002) && p.every(([x, , z]) => inPatch(x, z)) && !p.every(([x, , z]) => club(x, z) || byFeature(x, z)));
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

// Where the patch's edge crosses the river (east of Caversham Bridge), its edge cells are the bank top filled
// in over the water, about 0.6 m: the meadow beyond eases down towards that, and lidar has it at about 1 m there.
test('land just beyond the patch never sinks to the water as it eases into the made-up ground', async () => {
  const reading = courseFromFile(await data('reading'));
  const land = waterMap((await data('reading')).water);
  const band = [];
  for (let x = x0 - FADE; x <= x1 + FADE; x += 6) {
    for (let z = z0 - FADE; z <= z1 + FADE; z += 6) {
      const out = outside(x, z);
      if (out > 0 && out < FADE && !land.inside(x, z) && land.shore(x, z) >= 3) band.push([x, z]);
    }
  }
  const madeUp = await without(() => band.map(([x, z]) => groundAt(reading, x, z)));
  let checked = 0;
  band.forEach(([x, z], k) => {
    const y = groundAt(reading, x, z);
    assert.ok(y >= Math.min(0.4, madeUp[k]) - 0.01, `${y.toFixed(2)} m at ${x}, ${z} (made up ${madeUp[k].toFixed(2)})`);
    checked++;
  });
  assert.ok(checked > 5000, `${checked} points`);
});

test("measured trees keep off a landmark's water side out to 30 m, and the big ones behind the canoe club stay", async () => {
  const reading = courseFromFile(await data('reading'));
  const f = (groundAt(reading, 0, 0), landmarkFrame(reading, 'canoe-club'));
  const frame = (x, z) => {
    const [dx, dz] = [x - f.origin[0], z - f.origin[2]];
    return [dx * f.right[0] + dz * f.right[1], dx * f.fwd[0] + dz * f.fwd[1]];
  };
  const trunk = [0.35, 0.25, 0.17];
  const planted = (await world()).filter(({ color }) => color.every((c, k) => Math.abs(c - trunk[k]) < 0.002));
  const isPlanted = ([tx, tz]) => planted.some(({ p }) => Math.hypot(p[0][0] - tx, p[0][2] - tz) < 1);
  // In front of each modelled landmark in the patch (nearer the river than it), within 30 m of its footprint:
  // lidar has trees, none planted. (At the canoe club the bank is within 8 m; the rowing club and the
  // boathouses upstream have trees further out.)
  const river = reading.scenery.river;
  const fromRiver = (x, z) => { const at = locate(river, x, z); return Math.abs(at.lateral) - widthAt(river, at.s).half; };
  const raw = await data('reading');
  const front = raw.buildings.filter((b) => ['rowing-club', 'canoe-club', 'spiral-boathouse', 'grey-boathouse'].includes(b.style)).flatMap((b) => {
    const [xs, zs] = [b.shape.map((q) => q[0]), b.shape.map((q) => q[1])];
    const d = fromRiver(xs.reduce((a, v) => a + v) / xs.length, zs.reduce((a, v) => a + v) / zs.length);
    return LIDAR.trees.filter(([x, z]) => x > Math.min(...xs) - 30 && x < Math.max(...xs) + 30 && z > Math.min(...zs) - 30 && z < Math.max(...zs) + 30 && fromRiver(x, z) < d);
  });
  assert.ok(front.length >= 6, `${front.length} measured trees in front of landmarks`);
  assert.deepEqual(front.filter(isPlanted), []);
  // Behind (up the hill), past the 8 m: at least one is planted.
  const behind = LIDAR.trees.filter(([x, z]) => { const [u, v] = frame(x, z); return u > f.along[0] && u < f.along[1] && v < f.depth[0] - 8 && v > f.depth[0] - 30; });
  assert.ok(behind.some(isPlanted), `${behind.length} behind, none planted`);
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

test("the canoe club's yard behind it is level, so the walk sees its back doors whole (on the hill the grass hid their feet)", async () => {
  const reading = courseFromFile(await data('reading'));
  groundAt(reading, 0, 0);
  const f = landmarkFrame(reading, 'canoe-club');
  const front = Math.min(f.depth[1], f.edge - 9);
  const back = Math.max(f.depth[0], front - 11);
  const [lo, hi] = [Math.max(f.along[0], -21), Math.min(f.along[1], 14)];
  const ys = [];
  for (let u = lo; u <= hi; u += 2) for (let v = back - 10; v <= back - 0.5; v += 1.5) ys.push(groundAt(reading, ...[f.at(u, 0, v)].map((p) => [p[0], p[2]])[0]));
  assert.ok(Math.max(...ys) - Math.min(...ys) < 0.02, `the yard spans ${(Math.max(...ys) - Math.min(...ys)).toFixed(2)} m`);
  // ...and it's cut into the hill: the hill behind it carries on up.
  const above = f.at(0, 0, back - 25);
  assert.ok(groundAt(reading, above[0], above[2]) - ys[0] > 0.5);
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
  assert.ok(right >= 0.9, `Caversham bank ${right}`);
  assert.ok(left <= 0.25, `rowing club bank ${left}`);
});

test('the game credits the Environment Agency for the lidar, as its licence asks, for the reach lidar.js covers', async () => {
  const page = await readFile(new URL('../reading-thames/index.html', import.meta.url), 'utf8');
  const header = await readFile(new URL('../reading-thames/lidar.js', import.meta.url), 'utf8');
  const reach = header.replace(/\n\/\/ /g, ' ').match(/trees (from [A-Z][\w ]+? to [A-Z][\w ]+?),/)[1];
  assert.ok(page.includes(`heights ${reach} &copy;`), reach);
  assert.match(page, /&copy; Environment Agency copyright and\/or database right/);
  assert.match(page, /Open Government Licence/);
});

test("the leaves at the water's edge: a crown where the vegetation model has them, kept off water, buildings and landmarks, drawing nothing else differently", async () => {
  const course = await data('reading');
  const reading = courseFromFile(course);
  const river = reading.scenery.river;
  const land = waterMap(course.water);
  const tris = (v) => { const out = []; for (let i = 0; i < v.length; i += 27) out.push(Array.from(v.subarray(i, i + 27)).join(',')); return out; };
  const withEdge = tris(buildWorld(courseFromFile(course), 1, 'river').vertices);
  const keptEdge = LIDAR.edge;
  LIDAR.edge = undefined;
  let bare;
  try { bare = tris(buildWorld(courseFromFile(course), 1, 'river').vertices); } finally { LIDAR.edge = keptEdge; }
  // Everything else is the same, in the same order: the crowns took no one else's draws.
  const inBare = new Set(bare);
  const extra = withEdge.filter((t) => !inBare.has(t));
  assert.deepEqual(withEdge.filter((t) => inBare.has(t)), bare);
  assert.equal(extra.length % 24, 0, 'whole crowns');
  // Each crown's middle: on land, over the bank's first few metres, where the model has leaves.
  const middles = [];
  const radii = [];
  for (let k = 0; k < extra.length; k += 24) {
    const tri = extra.slice(k, k + 24).map((t) => t.split(',').map(Number));
    const v = tri.flatMap((n) => [0, 9, 18].map((o) => [n[o], n[o + 2]]));
    middles.push([v.reduce((a, p) => a + p[0], 0) / v.length, v.reduce((a, p) => a + p[1], 0) / v.length]);
    const ys = tri.flatMap((n) => [n[1], n[10], n[19]]);
    radii.push((Math.max(...ys) - Math.min(...ys)) / 2);
  }
  const planted = keptEdge.sides.flat().filter((h) => h !== null).length;
  assert.ok(middles.length > planted * 0.6 && middles.length <= planted, `${middles.length} crowns of ${planted} heights`);
  const boxes = course.buildings.map((b) => { const xs = b.shape.map((p) => p[0]); const zs = b.shape.map((p) => p[1]); return [Math.min(...xs) - 1, Math.min(...zs) - 1, Math.max(...xs) + 1, Math.max(...zs) + 1]; });
  const club = clubBox(reading, 'canoe-club', 8);
  // None reaches more than 1.5 m out over the water (the boat stops at the mapped shore).
  for (const t of extra) {
    const n = t.split(',').map(Number);
    for (const o of [0, 9, 18]) if (land.inside(n[o], n[o + 2])) assert.ok(land.shore(n[o], n[o + 2]) < 1.6, `leaves ${land.shore(n[o], n[o + 2]).toFixed(1)} m out over the water at ${n[o].toFixed(0)}, ${n[o + 2].toFixed(0)}`);
  }
  let hedges = 0;
  for (const [k, [x, z]] of middles.entries()) {
    // In front of a house (within 15 m inland), only garden shrubs: the house shows from the water.
    const at0 = locate(river, x, z);
    const inland = at0.lateral < 0 ? [at0.tz, -at0.tx] : [-at0.tz, at0.tx];
    const house = [5, 10, 15].some((d) => boxes.some((b) => { const [px, pz] = [x + inland[0] * d, z + inland[1] * d]; return px > b[0] && px < b[2] && pz > b[1] && pz < b[3]; }));
    if (house) { hedges++; assert.ok(radii[k] < 1.9, `a ${radii[k].toFixed(1)} m crown in front of a house at ${x.toFixed(0)}, ${z.toFixed(0)}`); }
    assert.ok(!land.inside(x, z), `a crown on the water at ${x.toFixed(0)}, ${z.toFixed(0)}`);
    assert.ok(!boxes.some((b) => x > b[0] && x < b[2] && z > b[1] && z < b[3]), `a crown in a building at ${x.toFixed(0)}, ${z.toFixed(0)}`);
    assert.ok(!club(x, z), `a crown by the canoe club at ${x.toFixed(0)}, ${z.toFixed(0)}`);
    const at = locate(river, x, z);
    const out = Math.abs(at.lateral) - widthAt(river, at.s).half;
    assert.ok(out > 1 && out < 9, `${out.toFixed(1)} m from the water`);
    // (On a bend a crown's middle locates a step either way of where it was planted.)
    const row = keptEdge.sides[at.lateral < 0 ? 0 : 1];
    const i = Math.round(at.s / keptEdge.step);
    assert.ok([i - 1, i, i + 1].some((j) => row[j] !== null && row[j] !== undefined), `a crown where the model has no leaves, at ${at.s.toFixed(0)}`);
  }
  assert.ok(hedges >= 1, `${hedges} hedges in front of houses`);
});
