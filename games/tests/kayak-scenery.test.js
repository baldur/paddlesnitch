// The Reading river's scenery: the places the owner pointed out, modelled from
// the footage (world.js FEATURES and LANDMARKS), and the bridge over Piper's
// Island laid along its real road.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { courseFromFile, pointAt, widthAt } from '../kayak/course.js';
import { waterMap } from '../kayak/water.js';
import { buildWorld, FEATURE_STYLES, LANDMARK_STYLES } from '../kayak/world.js';

const data = async (id) => JSON.parse(await readFile(new URL(`../kayak/courses/${id}.json`, import.meta.url), 'utf8'));

// The world's triangles, as [[x, y, z] x 3, colour].
let triangles;
async function world() {
  if (triangles) return triangles;
  const { vertices } = buildWorld(courseFromFile(await data('reading')), 1, 'river');
  triangles = [];
  for (let i = 0; i < vertices.length; i += 27) {
    const p = [0, 9, 18].map((k) => [vertices[i + k], vertices[i + k + 1], vertices[i + k + 2]]);
    triangles.push({ p, color: [vertices[i + 6], vertices[i + 7], vertices[i + 8]] });
  }
  return triangles;
}
// Whether (x, z) is under a triangle, seen from above.
function under([a, b, c], x, z) {
  const s = (p, q) => (q[0] - p[0]) * (z - p[2]) - (q[2] - p[2]) * (x - p[0]);
  const [d1, d2, d3] = [s(a, b), s(b, c), s(c, a)];
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

test("Caversham Bridge crosses at a slant along its road, so its deck is over the north channel at Piper's Island too", async () => {
  const river = await data('reading');
  const bridge = river.bridges.find((b) => b.name === 'Caversham Bridge');
  assert.ok(bridge.ends, 'the road over it, from the map');
  const [a, b] = bridge.ends;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const land = waterMap(river.water);
  const decks = (await world()).filter((t) => t.p.every(([, y]) => y > 6.3 && y < 7.7));
  // Every wet metre along the road, both channels, has deck over it.
  let wet = 0;
  for (let t = 0; t <= len; t += 1) {
    const [x, z] = [a[0] + u[0] * t, a[1] + u[1] * t];
    if (!land.inside(x, z)) continue;
    wet++;
    assert.ok(decks.some((d) => under(d.p, x, z)), `no deck over the water ${t.toFixed(0)} m along the road`);
  }
  assert.ok(wet > 50, `${wet} m of water under it`);
});

test('every feature and styled building on the river has a model of its own, and the scenery has no NaN', async () => {
  const river = await data('reading');
  assert.ok(river.features.length >= 10);
  for (const f of river.features) assert.ok(FEATURE_STYLES.includes(f.style), `${f.style}: no model`);
  for (const b of river.buildings.filter((b) => b.style)) assert.ok(LANDMARK_STYLES.includes(b.style) || b.style === 'clapboard', `${b.style}: no model`);
  assert.ok((await world()).every((t) => t.p.flat().every(Number.isFinite)));
});

test('Div 1-6 land on the beach for the portage and put in again at the sandbags', async () => {
  const course = courseFromFile(await data('hasler16'));
  const [p] = course.portages;
  const near = (style, s) => {
    const f = course.scenery.features.find((x) => x.style === style);
    const q = pointAt(course, s);
    return Math.hypot(f.at[0] - q.x, f.at[1] - q.z);
  };
  assert.ok(near('beach', p.from) < 25, `${near('beach', p.from)} m from the beach`);
  assert.ok(near('sandbags', p.to) < 25, `${near('sandbags', p.to)} m from the sandbags`);
});

test('nothing grows on the beach', async () => {
  const river = await data('reading');
  const [bx, bz] = river.features.find((f) => f.style === 'beach').at;
  const trunk = [0.35, 0.25, 0.17];
  const trunks = (await world()).filter((t) => t.color.every((v, i) => Math.abs(v - trunk[i]) < 0.005) && t.p.some(([x, , z]) => Math.hypot(x - bx, z - bz) < 15));
  assert.equal(trunks.length, 0);
});

test("the Lara Croft boat is moored on the right going up, and solid: you can't paddle through it", async () => {
  const course = courseFromFile(await data('reading'));
  const boat = course.scenery.moorings.find((m) => m.crew === 'statues');
  assert.equal(boat.side, 1);
  assert.equal(boat.paint, 'maroon');
  const c = pointAt(course, boat.s);
  const w = widthAt(course, boat.s).half - 1;
  assert.ok(course.shore.dry(c.x - c.tz * w, c.z + c.tx * w), 'a boat bumps into it');
});
