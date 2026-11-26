// The land round the Reading Thames out to 1 km (surroundings.js, the files in
// surroundings/): what the drone sees past the game's own land.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { courseFromFile, locate, widthAt } from '../reading-thames/course.js';
import { buildWorld, groundAt } from '../reading-thames/world.js';
import { DRONE } from '../reading-thames/outing.js';
import { perspective, view, multiply } from '../reading-thames/mat4.js';
import { NEAR, LOAD, DRAW, decodeBlock, blockMesh, boxAround, heightIn, inView, nearest, toBlock, createSurroundings } from '../reading-thames/surroundings.js';

const DIR = new URL('../reading-thames/surroundings/', import.meta.url);
const json = async (name) => JSON.parse(await readFile(new URL(name, DIR), 'utf8'));
const reading = async () => courseFromFile(JSON.parse(await readFile(new URL('../reading-thames/courses/reading.json', import.meta.url), 'utf8')));
let all;
async function blocks() {
  all ??= await Promise.all((await json('index.json')).blocks.map(async ([i, j]) => decodeBlock(await json(`${i}_${j}.json`))));
  return all;
}
const fromEdge = (river, x, z) => {
  const at = locate(river, x, z);
  return Math.hypot(x - at.x, z - at.z) - widthAt(river, at.s).half;
};

test('the index lists every block file, and the blocks reach 1 km from the water and no further', async () => {
  const { blocks: index } = await json('index.json');
  const files = (await readdir(DIR)).filter((f) => f !== 'index.json').sort();
  assert.deepEqual(index.map(([i, j]) => `${i}_${j}.json`).sort(), files);
  const river = (await reading()).scenery.river;
  let [far, buildings, trees] = [0, 0, 0];
  for (const b of await blocks()) {
    for (const { ring } of b.buildings) far = Math.max(far, fromEdge(river, ...ring[0]));
    for (const [x, z] of b.trees) far = Math.max(far, fromEdge(river, x, z));
    buildings += b.buildings.length;
    trees += b.trees.length;
  }
  assert.ok(far > 900 && far < 1060, `the furthest thing (a footprint's corner, its middle within 1 km) is ${far.toFixed(0)} m from the water`);
  assert.ok(buildings > 5000, `${buildings} buildings`);
  assert.ok(trees > 5000, `${trees} trees`);
});

test("the drone's range is the land's: 1 km from the river line, still 120 m up at most", () => {
  assert.equal(DRONE.range, 1000);
  assert.equal(DRONE.ceiling, 120);
});

test("the surroundings' ground runs under the game's own land, never through it, and meets it at its edge", async () => {
  const course = await reading();
  const river = course.scenery.river;
  let [under, worst, seam, gap] = [0, -Infinity, 0, 0];
  for (const b of await blocks()) {
    for (let r = 0; r < b.n - 1; r += 3) for (let c = 0; c < b.n - 1; c += 3) {
      if (b.cells[r * (b.n - 1) + c] === 4) continue;
      const [x, z] = [b.x0 + (c + 0.5) * b.cell, b.z0 + (r + 0.5) * b.cell];
      const at = locate(river, x, z);
      const d = Math.abs(at.lateral) - widthAt(river, at.s).half;
      if (at.s < 5 || at.s > river.length - 5) continue;
      const y = heightIn(b, x, z);
      const g = groundAt(course, x, z);
      // Under the land's last 30 m: below it.
      if (d < 315 && d > 290) { under++; worst = Math.max(worst, y - g); }
      // Just past it: within a metre and a half of where the land ends.
      if (d > 320 && d < 330) { seam++; gap = Math.max(gap, Math.abs(y - g)); }
    }
  }
  assert.ok(under > 100 && seam > 100, `${under} points under the land, ${seam} past it`);
  assert.ok(worst < 0.3, `at most ${worst.toFixed(2)} m over the game's land`);
  assert.ok(gap < 2.5, `at most ${gap.toFixed(2)} m from it at its edge`);
});

test("no building is drawn twice: none of the surroundings' is one the course file already has", async () => {
  const data = JSON.parse(await readFile(new URL('../reading-thames/courses/reading.json', import.meta.url), 'utf8'));
  const mids = data.buildings.map((b) => [b.shape.reduce((a, p) => a + p[0], 0) / b.shape.length, b.shape.reduce((a, p) => a + p[1], 0) / b.shape.length]);
  for (const b of await blocks()) {
    for (const { ring } of b.buildings) {
      const c = [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length];
      assert.ok(!mids.some((m) => Math.hypot(m[0] - c[0], m[1] - c[1]) < 2), `a building at ${c.map((v) => v.toFixed(0))}`);
    }
  }
});

test("buildings stand on their ground to their height, roofs over them; far off, fewer triangles for the same block", async () => {
  const b = (await blocks()).reduce((p, q) => (q.buildings.length > p.buildings.length ? q : p));
  const near = blockMesh(b);
  const far = blockMesh(b, true);
  assert.ok(far.count < near.count * 0.6, `far ${far.count / 3} against near ${near.count / 3} triangles`);
  const ys = [];
  for (let k = 1; k < near.vertices.length; k += 9) ys.push(near.vertices[k]);
  const top = Math.max(...b.buildings.map((d) => d.ground + d.height));
  assert.ok(Math.max(...ys) >= top, 'the tallest building is drawn to its height');
  for (const d of b.buildings) assert.ok(d.height >= 2.5 && d.height < 80, `${d.kind} ${d.height} m`);
});

test("near, a building the lidar fitted a roof to is drawn with that roof (roofs.js), up to its ridge", async () => {
  const all = await blocks();
  const gabled = (d) => Array.isArray(d.roof?.[3]) && d.roof.slice(4).every((p) => p[0] === 'gable');
  const withRoofs = all.filter((b) => b.buildings.some(gabled));
  assert.ok(withRoofs.length > 10, `${withRoofs.length} blocks with fitted gables`);
  const b = withRoofs[0];
  const d = b.buildings.find(gabled);
  const only = { ...b, buildings: [d], trees: [], cells: new Uint8Array(b.cells.length).fill(4) };
  const { vertices } = blockMesh(only);
  let top = -Infinity;
  for (let k = 1; k < vertices.length; k += 9) top = Math.max(top, vertices[k]);
  const ridge = Math.max(...d.roof.slice(4).map((p) => p[3]));
  assert.ok(Math.abs(top - (d.ground + ridge)) < 0.05, `drawn to ${top.toFixed(2)}, ridge ${(d.ground + ridge).toFixed(2)}`);
});

test("a footprint's box far off lies along its longest side and holds it", () => {
  const ring = [[0, 0], [10, 0], [10, 4], [6, 6], [0, 4]];
  const box = boxAround(ring);
  assert.equal(box.length, 4);
  const xs = box.map((p) => p[0]);
  const zs = box.map((p) => p[1]);
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)].map((v) => Math.round(v * 1e6) / 1e6), [0, 10, 0, 6]);
});

test('blocks come nearest first within a distance, and the view test keeps what the camera sees', () => {
  const index = [[0, 0], [2, 0], [5, 5], [-1, 0]];
  assert.deepEqual(nearest(index, 250, 250, 800).map((b) => [b.i, b.j]), [[0, 0], [-1, 0], [2, 0]]);
  assert.equal(toBlock(250, 250, 0, 0), 0);
  assert.equal(toBlock(1100, 250, 0, 0), 600);
  const proj = perspective(1, 1.5, 0.05, 2500);
  // Looking north (-z) from 100 m up.
  const vp = multiply(proj, view([0, 100, 0], [1, 0, 0], [0, 1, 0], [0, 0, -1]));
  assert.ok(inView(vp, [-250, 0, -800], [250, 20, -300]), 'ahead');
  assert.ok(!inView(vp, [-250, 0, 300], [250, 20, 800]), 'behind');
  assert.ok(!inView(vp, [3000, 0, -800], [3500, 20, -300]), 'far off to the side');
});

test('streamed: nothing until the index comes, then the nearest blocks, one mesh a frame, full detail near and less far off, let go when far', async () => {
  const files = { 'index.json': { block: 500, blocks: [[0, 0], [3, 0], [9, 0]] } };
  const n = 51;
  const flat = (i, j) => ({ i, j, cell: 10, ground: Array.from({ length: n * n }, (_, k) => (k % n ? 0 : 20)).join(','), cells: `0${(n - 1) ** 2}`, buildings: [], trees: [[2500, 2500, 120]] });
  files['0_0.json'] = flat(0, 0);
  files['3_0.json'] = flat(3, 0);
  files['9_0.json'] = flat(9, 0);
  const asked = [];
  const made = [];
  const gone = [];
  const renderer = { createMesh: (g) => { const m = { g }; made.push(m); return m; }, place() {}, destroyMesh: (m) => gone.push(m) };
  const s = createSurroundings(renderer, async (p) => { asked.push(p); return files[p]; });
  const vp = multiply(perspective(1, 1.5, 0.05, 2500), view([250, 100, 250], [1, 0, 0], [0, 0, -1], [0, -1, 0])); // straight down
  assert.deepEqual(s.update([250, 100, 250], vp), [], 'nothing before the index');
  await new Promise((r) => setTimeout(r, 0));
  s.update([250, 100, 250], vp);
  assert.deepEqual(asked, ['index.json', '0_0.json', '3_0.json'], `fetched within ${LOAD} m, nearest first (not 9,0: ${toBlock(250, 250, 9, 0)} m off)`);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(s.update([250, 100, 250], vp).length, 1, 'one block built and in view');
  s.update([250, 100, 250], vp);
  assert.equal(made.length, 2, 'the next frame, the next block');
  assert.ok(toBlock(250, 250, 3, 0) >= NEAR && made[1].g.count < made[0].g.count, 'the one further off with less detail');
  // Fly 4 km away: both let go.
  s.update([250 + DRAW + 2000, 100, 250], vp);
  assert.equal(gone.length, 2);
});

test("the game's first load doesn't take the surroundings: main.js imports them only once the drone flies", async () => {
  const main = await readFile(new URL('../reading-thames/main.js', import.meta.url), 'utf8');
  assert.ok(!/^import .*surroundings\.js/m.test(main), 'no static import');
  assert.ok(main.includes("import('./surroundings.js')"), 'a dynamic one');
  const index = await readFile(new URL('../reading-thames/index.html', import.meta.url), 'utf8');
  assert.ok(!index.includes('surroundings'), 'not preloaded by the page');
});

test("the real river's ends and the hills on its horizon are drawn apart, so the drone can leave them out over the real land", async () => {
  const world = buildWorld(await reading(), 1, 'river');
  assert.ok(world.beyond && world.beyond.count > 0, 'a mesh of their own');
  // Every hill is a cone peaking well clear of the water.
  const hilltops = [];
  for (let k = 0; k < world.beyond.vertices.length; k += 9) if (world.beyond.vertices[k + 1] > 15) hilltops.push(k);
  assert.ok(hilltops.length > 30, `${hilltops.length} hill vertices`);
});
