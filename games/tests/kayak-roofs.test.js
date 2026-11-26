// Roofs shaped by the lidar (roofs.js, lidar.js `roofs`): the surface a record
// stands for, its triangles, and the river's buildings drawn on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { courseFromFile } from '../reading-thames/course.js';
import { buildWorld, groundAt } from '../reading-thames/world.js';
import { MeshBuilder } from '../reading-thames/meshes.js';
import { LIDAR } from '../reading-thames/lidar.js';
import { fitted, roofHeight, roofMesh, triangulate } from '../reading-thames/roofs.js';

const data = async (id) => JSON.parse(await readFile(new URL(`../reading-thames/courses/${id}.json`, import.meta.url), 'utf8'));
const ringOf = (shape) => (shape[0][0] === shape.at(-1)[0] && shape[0][1] === shape.at(-1)[1] ? shape.slice(0, -1) : shape);
const middle = (ring) => [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length];

// Triangles as { p: [[x, y, z] x 3], color } (the mesh's 9 floats a vertex).
const trianglesOf = (vertices) => {
  const out = [];
  for (let i = 0; i < vertices.length; i += 27) out.push({ p: [0, 9, 18].map((k) => [vertices[i + k], vertices[i + k + 1], vertices[i + k + 2]]), color: [vertices[i + 6], vertices[i + 7], vertices[i + 8]] });
  return out;
};
// The highest drawn surface over (x, z), seen from above, or null.
const heightIn = (tris, x, z) => {
  let best = null;
  for (const { p: [a, b, c] } of tris) {
    const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(d) < 1e-9) continue;
    const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
    const l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
    const y = l1 * a[1] + l2 * b[1] + l3 * c[1];
    if (best === null || y > best) best = y;
  }
  return best;
};

test('a gable record is two slopes to a ridge along its frame, a gable end of wall under each end', () => {
  const ring = [[-6, -4], [6, -4], [6, 4], [-6, 4]];
  const rec = [0, 0, 0, [], ['gable', 0, 5, 8, 0.5]];
  assert.equal(roofHeight(ring, rec, 0, 0), 8);
  assert.equal(roofHeight(ring, rec, 3, 4), 5);
  assert.equal(roofHeight(ring, rec, -5, -2), 6.5);
  const m = new MeshBuilder();
  roofMesh(m, ring, rec, 1, 0, [1, 1, 1], [0.3, 0.2, 0.2]);
  const tris = trianglesOf(m.data);
  for (const [x, z] of [[0, 0], [2, 2], [-4, -3.5], [5.9, 0.1]]) assert.ok(Math.abs(heightIn(tris, x, z) - (1 + roofHeight(ring, rec, x, z))) < 1e-6, `at ${x}, ${z}`);
  // The gable ends' walls go up to the ridge; the long walls stop at the eaves.
  const top = (x0, x1, z0, z1) => Math.max(...tris.flatMap(({ p }) => p).filter(([x, , z]) => x >= x0 && x <= x1 && z >= z0 && z <= z1).map((q) => q[1]));
  assert.equal(top(5.99, 6.01, -4, 4), 9);
  assert.equal(top(-6, 6, 3.99, 4.01), 6);
});

test("a hip record's ends slope back to a shorter ridge, a shed's one slope rises along +v", () => {
  const ring = [[-7, -4.5], [7, -4.5], [7, 4.5], [-7, 4.5]];
  const hip = [0, 0, 0, [], ['hip', 0, 5, 8, 0.5, 4.5]];
  assert.equal(roofHeight(ring, hip, 0, 0), 8);
  assert.equal(roofHeight(ring, hip, -7, 0), 5);
  assert.ok(Math.abs(roofHeight(ring, hip, -4.75, 0) - 6.5) < 1e-9);
  const shed = [0, 0, 90, [], ['shed', 1, 3, 4.5]];
  // (Turned 180°: +v of the part points to -z, so it rises towards -z.)
  assert.ok(Math.abs(roofHeight(ring, shed, 0, -4.5) - 4.5) < 1e-9 && Math.abs(roofHeight(ring, shed, 0, 4.5) - 3) < 1e-9);
});

test('a record in parts steps between them along its cut, and the step is walled', () => {
  const ring = [[-12, -4], [12, -4], [12, 4], [-12, 4]];
  const rec = [0, 0, 0, [0], ['gable', 0, 6, 9, 0.5], ['flat', 4]];
  assert.equal(roofHeight(ring, rec, -1, 0), 9);
  assert.equal(roofHeight(ring, rec, 1, 0), 4);
  const m = new MeshBuilder();
  roofMesh(m, ring, rec, 0, 0, [1, 1, 1], [0.3, 0.2, 0.2]);
  const tris = trianglesOf(m.data);
  const step = tris.filter(({ p }) => p.every(([x]) => Math.abs(x) < 1e-6));
  assert.ok(step.length >= 2, `${step.length} triangles in the step`);
  assert.ok(Math.min(...step.flatMap(({ p }) => p.map((q) => q[1]))) >= 4 - 1e-6, 'the step stands on the lower roof');
  assert.equal(Math.max(...step.flatMap(({ p }) => p.map((q) => q[1]))), 9);
});

test('an L-shaped footprint is triangulated without covering its missing corner', () => {
  const ring = [[0, 0], [10, 0], [10, 10], [5, 10], [5, 5], [0, 5]];
  const tris = triangulate(ring);
  assert.equal(tris.length, 4);
  const area = tris.reduce((a, [p, q, r]) => a + Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])) / 2, 0);
  assert.ok(Math.abs(area - 75) < 1e-9, `${area} m²`);
});

test('lidar.js says for every plain building in it whether its roof was fitted, and why not where not', async () => {
  const reading = await data('reading');
  const plain = new Map(reading.buildings.filter((b) => !b.style).map((b) => { const [cx, cz] = middle(ringOf(b.shape)); return [`${Math.round(cx * 10) / 10},${Math.round(cz * 10) / 10}`, b]; }));
  assert.ok(LIDAR.roofs.length > 400, `${LIDAR.roofs.length} records`);
  const forms = {};
  for (const rec of LIDAR.roofs) {
    assert.ok(plain.has(`${rec[0]},${rec[1]}`), `${rec[0]}, ${rec[1]} is one of the map's plain buildings`);
    if (!fitted(rec)) { assert.ok(['few', 'noisy', 'tall'].includes(rec[2]), rec[2]); forms[rec[2]] = (forms[rec[2]] ?? 0) + 1; continue; }
    // (A few numbers each: the parts' shapes, not the lidar.)
    assert.ok(JSON.stringify(rec).length < 200, JSON.stringify(rec));
    for (const p of rec.slice(4)) {
      assert.ok(['flat', 'shed', 'gable', 'hip'].includes(p[0]), p[0]);
      const [e, r] = p[0] === 'flat' ? [p[1], p[1]] : [p[2], p[3]];
      assert.ok(e >= 1.2 && r >= e && r < 40, JSON.stringify(rec));
    }
    const key = rec.length > 5 ? 'parts' : rec[4][0];
    forms[key] = (forms[key] ?? 0) + 1;
  }
  // Most are fitted, and the pitched forms are most of those (Reading is houses).
  const fit = (forms.flat ?? 0) + (forms.shed ?? 0) + (forms.gable ?? 0) + (forms.hip ?? 0) + (forms.parts ?? 0);
  assert.ok(fit > LIDAR.roofs.length * 0.6, JSON.stringify(forms));
  assert.ok((forms.gable ?? 0) + (forms.hip ?? 0) > fit * 0.5, JSON.stringify(forms));
});

test("the river's buildings are drawn on their fitted roofs: the top seen from above is the record's surface", async () => {
  const reading = await data('reading');
  const course = courseFromFile(reading);
  const tris = trianglesOf(buildWorld(course, 1, 'river').vertices);
  const byKey = new Map(LIDAR.roofs.filter(fitted).map((r) => [`${r[0]},${r[1]}`, r]));
  let checked = 0;
  for (const b of reading.buildings) {
    if (b.style) continue;
    const ring = ringOf(b.shape);
    const [cx, cz] = middle(ring);
    const rec = byKey.get(`${Math.round(cx * 10) / 10},${Math.round(cz * 10) / 10}`);
    if (!rec || checked >= 40) continue;
    const xs = ring.map((p) => p[0]);
    const zs = ring.map((p) => p[1]);
    const mine = tris.filter(({ p }) => p.every(([x, , z]) => x >= Math.min(...xs) - 0.01 && x <= Math.max(...xs) + 0.01 && z >= Math.min(...zs) - 0.01 && z <= Math.max(...zs) + 0.01));
    const g = groundAt(course, cx, cz);
    // A point a third of the way in from each corner (clear of a tree over it, mostly).
    let ok = 0;
    for (const [x, z] of ring.map(([x, z]) => [cx + (x - cx) * 0.66, cz + (z - cz) * 0.66])) {
      const y = heightIn(mine, x, z);
      if (y === null) continue;
      const want = g + roofHeight(ring, rec, x, z);
      if (Math.abs(y - want) < 0.05) ok++;
      else if (y < want - 0.05) assert.fail(`${cx.toFixed(1)}, ${cz.toFixed(1)}: drawn at ${y.toFixed(2)} under its roof's ${want.toFixed(2)}`);
    }
    if (ok) checked++;
  }
  assert.ok(checked >= 40, `${checked} buildings`);
});
