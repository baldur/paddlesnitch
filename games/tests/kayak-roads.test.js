// Roads and paved areas from OpenStreetMap (roads.js): laid on the ground the
// game draws, kept off the water and the houses, in the riverside's data
// (riverside-roads.js, drawn by world.js) and the surroundings' (surroundings/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MeshBuilder } from '../reading-thames/meshes.js';
import { LIFT, decodeRoads, layRoad, roadQuads, drawRoad, triangulate, layArea, groundOf, cellsUnder, onRoads, edges } from '../reading-thames/roads.js';
import { RIVERSIDE_ROADS } from '../reading-thames/riverside-roads.js';
import { courseFromFile } from '../reading-thames/course.js';
import { buildWorld, shoreDistance, riversideKeepOut } from '../reading-thames/world.js';
import { decodeBlock, blockMesh, drawnHeight } from '../reading-thames/surroundings.js';
import { NEAR_PLANE, droneNear } from '../reading-thames/outing.js';

// The ribbon's height across and along it, from its quads: [x, y, z] corners.
const quadsOf = (m) => {
  const v = m.build().vertices;
  const tris = [];
  for (let k = 0; k < v.length; k += 27) tris.push([0, 9, 18].map((o) => [v[k + o], v[k + o + 1], v[k + o + 2]]));
  return tris;
};
// The height of the triangles over (x, z), the highest, or null.
const lookups = new WeakMap();
const over = (tris, x, z) => {
  if (!lookups.has(tris)) lookups.set(tris, groundOf(new Float32Array(tris.flatMap((t) => t.flatMap((p) => [...p, 0, 0, 0, 0, 0, 0]))), 0, tris.length * 3, () => true));
  return lookups.get(tris)(x, z);
};

test('a road over a ridge is split where the ground bends, and never dips into it', () => {
  const ridge = (x) => Math.max(0, 3 - Math.abs(x - 50) * 0.2); // a 3 m ridge at x = 50
  const sections = layRoad({ line: [[0, 0], [100, 0]], width: 6, bridge: false }, (x) => ridge(x));
  assert.ok(sections.length > 4, `${sections.length} sections`);
  const m = new MeshBuilder();
  roadQuads(m, sections, { look: 0, width: 6, bridge: false });
  const tris = quadsOf(m);
  for (let x = 0.5; x < 100; x += 0.5) for (const z of [-2.9, 0, 2.9]) {
    const y = over(tris, x, z);
    assert.ok(y - ridge(x) >= LIFT[0] - 0.045 && y - ridge(x) <= LIFT[0] + 0.2, `at ${x}, ${z}: ${(y - ridge(x)).toFixed(3)} m over the ground`);
  }
});

test('on flat ground a straight road is one quad per 24 m, its ends square across it', () => {
  const sections = layRoad({ line: [[0, 0], [48, 0]], width: 4, bridge: false }, () => 1);
  assert.equal(sections.length, 3);
  const [l, r] = edges([[0, 0], [48, 0]], 0, 4);
  assert.deepEqual([l, r], [[0, 2], [0, -2]]);
  // A bend keeps its width: the corner's edge is a mitre, 2 m from both legs.
  const [cl] = edges([[0, 0], [10, 0], [10, 10]], 1, 4);
  assert.ok(Math.abs(cl[0] - 8) < 1e-9 && Math.abs(cl[1] - 2) < 1e-9, JSON.stringify(cl));
});

test('a bridge is laid straight from end to end over a valley, never into it, with sides under its deck', () => {
  const valley = (x) => (x > 20 && x < 80 ? -8 : 2);
  const sections = layRoad({ line: [[0, 0], [100, 0]], width: 5, bridge: true }, (x) => valley(x));
  for (const s of sections) assert.ok(Math.abs(s.yl - 2) < 1e-9 && Math.abs(s.yr - 2) < 1e-9, JSON.stringify(s));
  const m = new MeshBuilder();
  roadQuads(m, sections, { look: 0, width: 5, bridge: true });
  assert.equal(m.count / 3, (sections.length - 1) * 6); // its deck and two sides a section
  // Rising over a hump between its ends, the deck stays over the ground.
  const hump = layRoad({ line: [[0, 0], [100, 0]], width: 5, bridge: true }, (x) => (Math.abs(x - 50) < 5 ? 6 : 0));
  assert.ok(hump.every((s) => s.yl >= (Math.abs(s.x - 50) < 5 ? 6 : 0) - 1e-9));
});

test("where there's no ground under it (off the edge of what's drawn), a road stops square", () => {
  const sections = layRoad({ line: [[0, 0], [60, 0]], width: 4, bridge: false }, (x) => (x < 30 ? 0 : null));
  const last = sections.filter(Boolean).at(-1);
  assert.ok(last.x > 28 && last.x <= 30, `last section at ${last.x}`);
  assert.equal(sections.at(-1), null);
});

test('a paved area is its ring in triangles, split until it follows the ground', () => {
  const L = [[0, 0], [30, 0], [30, 10], [10, 10], [10, 30], [0, 30]];
  const area = (t) => Math.abs((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1])) / 2;
  assert.ok(Math.abs(triangulate(L).reduce((a, t) => a + area(t), 0) - 500) < 1e-6);
  assert.ok(Math.abs(triangulate([...L].reverse()).reduce((a, t) => a + area(t), 0) - 500) < 1e-6);
  // Over a ridge along z = 15, and one across it at a slant: never more than a few centimetres into it, nor far over it.
  for (const ridge of [(x, z) => -Math.abs(z - 15) * 0.3, (x, z) => -Math.abs(x + z - 17.3) * 0.2]) {
    const tris = layArea(L, ridge);
    for (let x = 0.3; x < 30; x += 0.7) for (let z = 0.3; z < 30; z += 0.9) {
      const y = over(tris, x, z);
      if (y === null) continue;
      assert.ok(y - ridge(x, z) > -0.03 && y - ridge(x, z) < 0.15, `at ${x}, ${z}: ${(y - ridge(x, z)).toFixed(3)}`);
    }
  }
});

test("the drawn ground's lookup takes the highest triangle under a point, only where it was asked to look", () => {
  const m = new MeshBuilder();
  m.quad([0, 0, 0], [10, 0, 0], [10, 0, 10], [0, 0, 10], [0, 0, 0]);
  m.quad([0, 2, 0], [10, 2, 0], [10, 4, 10], [0, 4, 10], [0, 0, 0]);
  const g = groundOf(m.data, 0, m.count, () => true);
  assert.ok(Math.abs(g(5, 5) - 3) < 1e-9);
  assert.equal(g(20, 5), null);
  assert.equal(groundOf(m.data, 0, 6, (i) => i > 0)(5, 5), null);
  assert.ok(cellsUnder([{ line: [[0, 0], [40, 0]], width: 2 }], [])(2, 0));
  assert.ok(!cellsUnder([{ line: [[0, 0], [40, 0]], width: 2 }], [])(2, 3));
});

test('trees keep off a road (its width and a margin) and a car park', () => {
  const on = onRoads([{ line: [[0, 0], [100, 0]], width: 6 }], [{ ring: [[0, 20], [20, 20], [20, 40], [0, 40]] }]);
  assert.ok(on(50, 2.9) && on(50, 3.9, 1) && !on(50, 4.1, 1) && on(10, 30) && !on(30, 30));
});

test('the numbers in the files decode to roads: look, width, bridge and points from the corner', () => {
  const { roads, areas } = decodeRoads({ roads: [[0, 55, 1, 0, 0, 15, 0, 0, -30]], areas: [[1, 0, 0, 100, 0, 0, 100]] }, [100, 200]);
  assert.deepEqual(roads, [{ look: 0, width: 5.5, bridge: true, line: [[100, 200], [101.5, 200], [101.5, 197]] }]);
  assert.deepEqual(areas, [{ look: 1, ring: [[100, 200], [110, 200], [110, 210]] }]);
});

test("flying the drone, the near plane moves out with its height (the roads' depth), not near the ground", () => {
  assert.equal(droneNear(1), NEAR_PLANE);
  assert.equal(droneNear(50), 1);
  assert.equal(droneNear(120), 2);
});

// --- the data --------------------------------------------------------------

const reading = async () => courseFromFile(JSON.parse(await readFile(new URL('../reading-thames/courses/reading.json', import.meta.url), 'utf8')));
const insideRing = (ring, x, z) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (ring[i][1] > z !== ring[j][1] > z && x < ((ring[j][0] - ring[i][0]) * (z - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) c = !c;
  return c;
};

test("the riverside's roads are off the water, the bank, the houses and what the footage models", async () => {
  const course = await reading();
  const { roads, areas } = decodeRoads(RIVERSIDE_ROADS);
  assert.ok(roads.length > 200, `${roads.length} roads`);
  const keepOut = riversideKeepOut(course);
  const houses = course.scenery.buildings.map((b) => b.shape);
  let [points, km] = [0, 0];
  for (const r of roads) {
    for (let i = 1; i < r.line.length; i++) {
      const [a, b] = [r.line[i - 1], r.line[i]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      km += len / 1000;
      for (let t = 0; t <= 1; t += 1 / Math.max(1, Math.ceil(len / 2))) {
        const [x, z] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        points++;
        // (Clipped to within a sixteenth of a metre: a little slack.)
        assert.ok(shoreDistance(course, x, z) >= r.width / 2 + 5.5, `a road ${shoreDistance(course, x, z).toFixed(1)} m from the water at ${x.toFixed(1)}, ${z.toFixed(1)}`);
        assert.ok(!keepOut(x, z, r.width / 2 - 0.5), `a road on what the footage models at ${x.toFixed(1)}, ${z.toFixed(1)}`);
        assert.ok(!houses.some((h) => insideRing(h, x, z)), `a road through a house at ${x.toFixed(1)}, ${z.toFixed(1)}`);
      }
    }
  }
  for (const a of areas) for (const [x, z] of a.ring) assert.ok(shoreDistance(course, x, z) >= 0.9, 'a car park in the water');
  assert.ok(km > 20, `${km.toFixed(1)} km`);
});

test("the riverside's roads lie on the land as drawn: never under it, nearly all within centimetres of their lift", async () => {
  const course = await reading();
  const built = buildWorld(course, 1, 'river');
  const land = groundOf(built.vertices, 0, built.land, () => true);
  const { roads } = decodeRoads(RIVERSIDE_ROADS);
  let [worst, n, where] = [0, 0, ''];
  const floats = [];
  for (const r of roads) {
    if (r.bridge) continue; // (a deck, laid straight between its ends)
    const m = new MeshBuilder();
    drawRoad(m, r, (x, z) => land(x, z));
    const tris = quadsOf(m);
    if (!tris.length) continue;
    const road = groundOf(m.build().vertices, 0, m.count, () => true);
    for (let i = 1; i < r.line.length; i++) {
      const [a, b] = [r.line[i - 1], r.line[i]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let d = 0.3; d < len; d += 1.7) {
        const [x, z] = [a[0] + ((b[0] - a[0]) * d) / len, a[1] + ((b[1] - a[1]) * d) / len];
        const [y, g] = [road(x, z), land(x, z)];
        if (y === null || g === null) continue;
        n++;
        // (The ground's own creases between the road's points can come within a centimetre or two.)
        assert.ok(y - g > LIFT[r.look] - 0.06, `${(y - g).toFixed(3)} m over the land at ${x.toFixed(1)}, ${z.toFixed(1)}`);
        floats.push(y - g - LIFT[r.look]);
        if (y - g - LIFT[r.look] > worst) [worst, where] = [y - g - LIFT[r.look], `${x.toFixed(1)}, ${z.toFixed(1)}`];
      }
    }
  }
  assert.ok(n > 10000, `${n} points looked at`);
  // (Over a sharp step in the ground, a wall's foot say, the strip is raised to clear it and stands off it beside.)
  floats.sort((a, b) => a - b);
  const p99 = floats[Math.floor(floats.length * 0.99)];
  assert.ok(floats[floats.length >> 1] < 0.03 && p99 < 0.25 && worst < 1, `half within ${floats[floats.length >> 1].toFixed(3)} m, 99% within ${p99.toFixed(2)} m over their lift, the most ${worst.toFixed(2)} m at ${where}`);
});

const DIR = new URL('../reading-thames/surroundings/', import.meta.url);
const json = async (name) => JSON.parse(await readFile(new URL(name, DIR), 'utf8'));

test("the surroundings' roads are off the lidar's water, on the block's ground as drawn (near and far), and the trees are off them", async () => {
  const blocks = await Promise.all((await json('index.json')).blocks.map(async ([i, j]) => decodeBlock(await json(`${i}_${j}.json`))));
  let [roads, land] = [0, 0];
  for (const b of blocks) {
    const on = onRoads([...b.roads, ...b.landRoads.map((r) => ({ width: r.width, line: r.sections.map((s) => [s.x, s.z]) }))], [...b.areas]);
    for (const [x, z] of b.trees) assert.ok(!on(x, z, 0.9), `a tree on a road at ${x}, ${z}`);
    for (const r of b.roads) {
      roads++;
      for (const [k, [x, z]] of r.line.entries()) {
        assert.ok(x >= b.x0 - 0.1 && x <= b.x0 + 500.1 && z >= b.z0 - 0.1 && z <= b.z0 + 500.1, 'a road outside its block');
        // (Half way to the next point: a road clipped at a cell's edge ends on it.)
        const [mx, mz] = k + 1 < r.line.length ? [(x + r.line[k + 1][0]) / 2, (z + r.line[k + 1][1]) / 2] : [x, z];
        if (k + 1 === r.line.length) continue;
        const c = Math.min(b.n - 2, Math.floor((mx - b.x0) / b.cell));
        const rr = Math.min(b.n - 2, Math.floor((mz - b.z0) / b.cell));
        if (!r.bridge) assert.notEqual(b.cells[rr * (b.n - 1) + c], 3, `a road in the water at ${x}, ${z}`);
      }
    }
    land += b.landRoads.length;
  }
  assert.ok(roads > 1000 && land > 100, `${roads} roads beyond the game's land, ${land} on its far part`);
  // One block in town, near and far: its roads over its ground as drawn.
  const town = blocks.reduce((a, b) => (b.roads.length > a.roads.length ? b : a));
  for (const far of [false, true]) {
    const empty = { ...town, buildings: [], trees: [], landRoads: [], landAreas: [], areas: [] };
    const ground = blockMesh({ ...empty, roads: [] }, far);
    const withRoads = blockMesh(empty, far);
    const g = groundOf(ground.vertices, 0, ground.count, () => true);
    const all = groundOf(withRoads.vertices, 0, withRoads.count, () => true);
    let looked = 0;
    for (const r of town.roads) {
      if (far && r.width < 3) continue;
      for (let i = 1; i < r.line.length; i++) {
        const [a, b] = [r.line[i - 1], r.line[i]];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let d = 0.4; d < len; d += 2.3) {
          const [x, z] = [a[0] + ((b[0] - a[0]) * d) / len, a[1] + ((b[1] - a[1]) * d) / len];
          const [y0, y] = [g(x, z), all(x, z)];
          if (y0 === null) continue;
          assert.ok(Math.abs(drawnHeight(town, x, z, far) - y0) < 1e-3, `drawnHeight ${drawnHeight(town, x, z, far)} against the mesh's ${y0}`);
          if (r.bridge) continue;
          looked++;
          assert.ok(y - y0 > LIFT[r.look] - 0.1, `${far ? 'far' : 'near'}: a road ${(y - y0).toFixed(2)} m over the ground at ${x.toFixed(1)}, ${z.toFixed(1)}`);
        }
      }
    }
    assert.ok(looked > 200, `${looked} points looked at`);
  }
});

test("the roads on the game's far land were laid on the land the game draws now (rebuild the surroundings after the land changes)", async () => {
  const course = await reading();
  const built = buildWorld(course, 1, 'river');
  const land = groundOf(built.vertices, 0, built.land, () => true);
  const blocks = await Promise.all((await json('index.json')).blocks.map(async ([i, j]) => decodeBlock(await json(`${i}_${j}.json`))));
  let n = 0;
  for (const b of blocks) for (const r of b.landRoads) for (const s of r.sections) {
    if (r.bridge || n++ % 7) continue;
    const [l] = edges(r.sections.map((q) => [q.x, q.z]), r.sections.indexOf(s), r.width);
    const g = land(...l);
    if (g === null) continue;
    assert.ok(s.yl - g > -0.04, `a section ${(s.yl - g).toFixed(2)} m off the land at ${s.x}, ${s.z}`);
  }
  assert.ok(n > 500, `${n} sections`);
});
