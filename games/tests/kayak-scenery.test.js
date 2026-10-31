// The Reading river's scenery: the places the owner pointed out, modelled from
// the footage (world.js FEATURES and LANDMARKS), and the bridge over Piper's
// Island laid along its real road.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { courseFromFile, pointAt, widthAt } from '../reading-thames/course.js';
import { waterMap } from '../reading-thames/water.js';
import { buildWorld, FEATURE_STYLES, LANDMARK_STYLES } from '../reading-thames/world.js';

const data = async (id) => JSON.parse(await readFile(new URL(`../reading-thames/courses/${id}.json`, import.meta.url), 'utf8'));

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
  for (const b of river.buildings.filter((b) => b.style)) assert.ok(LANDMARK_STYLES.includes(b.style) || ['clapboard', 'stilts'].includes(b.style), `${b.style}: no model`);
  assert.ok((await world()).every((t) => t.p.flat().every(Number.isFinite)));
});

test('Div 1-6 land on the beach for the portage and put in again on a little beach, clear of the sandbag wall', async () => {
  const course = courseFromFile(await data('hasler16'));
  const [p] = course.portages;
  const near = (style, s) => {
    const f = course.scenery.features.find((x) => x.style === style);
    const q = pointAt(course, s);
    return Math.hypot(f.at[0] - q.x, f.at[1] - q.z);
  };
  assert.ok(near('beach', p.from) < 25, `${near('beach', p.from)} m from the beach`);
  assert.ok(near('landing', p.to) < 8, `${near('landing', p.to)} m from the landing beach`);
  // The sandbag wall stands just below it, not in the way (the owner: it blocked the old put-in).
  assert.ok(near('sandbags', p.to) > 10, `${near('sandbags', p.to)} m from the sandbag wall`);
  // Afloat at the put-in, open water all round the boat.
  const q = pointAt(course, p.to + 1);
  for (let a = 0; a < 8; a++) {
    const [x, z] = [q.x + Math.cos((a * Math.PI) / 4) * 3, q.z + Math.sin((a * Math.PI) / 4) * 3];
    assert.ok(!course.shore.dry(x, z), 'bank within 3 m of the put-in');
  }
});

test('nothing grows on either beach', async () => {
  const river = await data('reading');
  const trunk = [0.35, 0.25, 0.17];
  for (const [style, r] of [['beach', 15], ['landing', 6]]) {
    const [bx, bz] = river.features.find((f) => f.style === style).at;
    const trunks = (await world()).filter((t) => t.color.every((v, i) => Math.abs(v - trunk[i]) < 0.005) && t.p.some(([x, , z]) => Math.hypot(x - bx, z - bz) < r));
    assert.equal(trunks.length, 0, style);
  }
});

test("the Lara Croft boat is moored on the left going up, and solid: you can't paddle through it", async () => {
  const course = courseFromFile(await data('reading'));
  const boat = course.scenery.moorings.find((m) => m.crew === 'statues');
  assert.equal(boat.side, -1, 'on the left going up (owner, 2026-10-31)');
  assert.equal(boat.paint, 'maroon');
  const c = pointAt(course, boat.s);
  const w = widthAt(course, boat.s).half - 1;
  assert.ok(course.shore.dry(c.x - c.tz * w * boat.side, c.z + c.tx * w * boat.side), 'a boat bumps into it');
});

test('no two moored boats lie in each other', async () => {
  const course = courseFromFile(await data('reading'));
  const river = course.scenery.river;
  // Each boat as a box along the bank (or along its own heading, moored at a point).
  const boxes = course.scenery.moorings.map((m) => {
    if (m.at) return { m, x: m.at[0], z: m.at[1], u: m.dir, half: m.length / 2, beam: 2 };
    const c = pointAt(river, m.s);
    const w = widthAt(river, m.s).half - 1;
    return { m, x: c.x - c.tz * m.side * w, z: c.z + c.tx * m.side * w, u: [c.tx, c.tz], half: m.length / 2, beam: 2 };
  });
  const clash = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      const along = Math.abs((b.x - a.x) * a.u[0] + (b.z - a.z) * a.u[1]);
      const across = Math.abs((b.x - a.x) * -a.u[1] + (b.z - a.z) * a.u[0]);
      if (along < a.half + b.half - 0.5 && across < (a.beam + b.beam) / 2) clash.push(`${a.m.kind} at ${a.m.s} and ${b.m.kind} at ${b.m.s}`);
    }
  }
  assert.deepEqual(clash, []);
});

test('the boats found in the footage are moored where they were: the trip boat in the north channel, a houseboat by the railway wall', async () => {
  const course = courseFromFile(await data('reading'));
  const trip = course.scenery.moorings.find((m) => m.kind === 'trip-boat' && m.at);
  assert.ok(trip, 'the trip boat moored at its own point');
  assert.ok(course.shore.dry(trip.at[0], trip.at[1]), 'solid: boats bump into it');
  assert.ok(course.scenery.moorings.some((m) => m.kind === 'houseboat'));
  const styles = new Set(course.scenery.buildings.map((b) => b.style));
  for (const s of ['stilts', 'tudor-boathouse']) assert.ok(styles.has(s), s);
});

test("no bank lies over the water like a sheet: down Fry's Island's back channel, 90 m off the river line", async () => {
  const h79 = courseFromFile(await data('hasler79'));
  const tris = await world();
  const land = waterMap((await data('reading')).water);
  // A bank drawn across a channel: a triangle from under the water to well above it, over open water on the route.
  const cliffs = [];
  for (let s = 6900; s <= 7600; s += 20) {
    const p = pointAt(h79, s);
    if (!land.inside(p.x, p.z)) continue;
    for (const t of tris) {
      const ys = t.p.map((q) => q[1]);
      if (Math.min(...ys) >= 0 || Math.max(...ys) < 1.5) continue;
      if (t.p.some((q) => Math.hypot(q[0] - p.x, q[2] - p.z) > 40)) continue;
      if (under(t.p, p.x, p.z)) cliffs.push(s);
    }
  }
  assert.deepEqual([...new Set(cliffs)], []);
});
