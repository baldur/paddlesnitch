// The Reading river's scenery: the places the owner pointed out, modelled from
// the footage (world.js FEATURES and LANDMARKS), and the bridge over Piper's
// Island laid along its real road.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
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
  for (const b of river.buildings.filter((b) => b.style)) assert.ok(LANDMARK_STYLES.includes(b.style) || ['clapboard', 'stilts', 'balcony-terrace'].includes(b.style), `${b.style}: no model`);
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

test("a club's name reads left to right from the water, not mirrored", async () => {
  const { sign } = await import('../reading-thames/world.js');
  // A front facing the water to the south (+z): you look north at it, west (-x) on your left.
  const fwd = [0, 1];
  const right = [-fwd[1], fwd[0]];
  const boxes = [];
  const f = { box: (m, [x0, x1], yr, zr, color) => boxes.push({ x: right[0] * (x0 + x1) / 2, color }) };
  sign(null, f, 'RI', 0, 0, 0, null, [1, 1, 1]);
  // R's first column (3 pixels lit, at its left edge) against I's middle stroke.
  const xs = boxes.map((b) => b.x).sort((a, b) => a - b);
  const [first, last] = [xs[0], xs.at(-1)];
  const rPixels = 10; // R is '110101110101101': 10 pixels lit
  const rXs = boxes.slice(0, rPixels).map((b) => b.x);
  const iXs = boxes.slice(rPixels).map((b) => b.x);
  assert.ok(Math.max(...rXs) < Math.min(...iXs), 'R is on your left of I');
  assert.ok(first < last);
});

test("both clubs' fronts as the footage shows them: the rowing club's green pontoon and timber balcony, the canoe club's tube pontoon and buff brick", async () => {
  const { ROWING, CANOE } = await import('../reading-thames/world.js');
  const tris = await world();
  const near = (x, z, r) => tris.filter(({ p }) => Math.hypot(p[0][0] - x, p[0][2] - z) < r);
  const has = (list, rgb) => list.some(({ color }) => color.every((c, i) => Math.abs(c - rgb[i]) < 0.01));
  const rowing = near(-686, -506, 45);
  assert.ok(has(rowing, ROWING.pontoon), 'the green pontoon');
  assert.ok(has(rowing, ROWING.float), 'its yellow floats');
  assert.ok(has(rowing, ROWING.timber), 'the timber balcony');
  assert.ok(has(rowing, ROWING.banner) && has(rowing, ROWING.navy), 'the name on its banner');
  assert.ok(!has(rowing, [0.74, 0.72, 0.67]), "no concrete hard (the old model's CLUB.hard): there is none");
  const canoe = near(-881, -690, 50);
  assert.ok(has(canoe, CANOE.tube), 'the tube pontoon');
  assert.ok(has(canoe, CANOE.buff), 'buff brick bands');
});

test('each club stands square to its mapped bank, its pontoon on the water', async () => {
  const { landmarkFrame } = await import('../reading-thames/world.js');
  const course = courseFromFile(await data('reading'));
  const land = waterMap((await data('reading')).water);
  for (const style of ['rowing-club', 'canoe-club']) {
    const f = landmarkFrame(course, style);
    const out = (x) => {
      let d = 0;
      while (d < 80 && !land.inside(...[0, 2].map((i) => f.at(x, 0, d)[i]))) d += 0.25;
      return d;
    };
    assert.ok(Math.abs(out(-15) - out(15)) < 1, `${style}: the bank is ${out(-15)} m out at one end, ${out(15)} m at the other`);
    assert.ok(Math.abs(out(0) - f.edge) < 0.3, `${style}: edge`);
    const p = f.at(0, 0, f.edge + 2);
    assert.ok(land.inside(p[0], p[2]), `${style}: 2 m out from the edge is water`);
  }
  // And as built: the rowing club's pontoon lies on the water all along it.
  const { ROWING } = await import('../reading-thames/world.js');
  const floats = (await world()).filter(({ color }) => color.every((c, i) => Math.abs(c - ROWING.pontoon[i]) < 1e-3));
  assert.ok(floats.length > 4, 'the pontoon is built');
  // Its top: both ends' middles are on the water, not under the bank.
  const top = floats.filter(({ p }) => Math.abs(p[0][1] - p[1][1]) < 1e-3 && Math.abs(p[0][1] - p[2][1]) < 1e-3).flatMap(({ p }) => p);
  const ymax = Math.max(...top.map((q) => q[1]));
  const corners = top.filter((q) => Math.abs(q[1] - ymax) < 1e-3);
  const [a] = corners;
  const far = corners.reduce((b, q) => (Math.hypot(q[0] - a[0], q[2] - a[2]) > Math.hypot(b[0] - a[0], b[2] - a[2]) ? q : b), a);
  const dir = [far[0] - a[0], far[2] - a[2]];
  const ends = [0, 1].map((e) => corners.filter((q) => ((q[0] - a[0]) * dir[0] + (q[2] - a[2]) * dir[1]) / Math.hypot(...dir) ** 2 > 0.5 === !!e));
  for (const end of ends) {
    const mid = [0, 2].map((i) => end.reduce((t, q) => t + q[i], 0) / end.length);
    assert.ok(land.inside(mid[0], mid[1]), `the pontoon's end at ${mid.map((v) => v.toFixed(1))} is on the water`);
  }
});

test("both renderers light the world and mirror the banks the same way (fill light, lit sum, the tree line in the water, how calm the water lies)", async () => {
  const read = async (f) => readFile(new URL(`../reading-thames/${f}`, import.meta.url), 'utf8');
  const lines = (src) => src.split('\n').map((l) => l.trim()).filter((l) => /^(let|var|float|vec[23]) ((fill|lit|still|tl|sky|calm|r|dx|dz) =|c = mix\(frame\.water)/.test(l))
    .map((l) => l.replace(/^(let|var|float|vec[23]) /, '').replace(/vec([23])f/g, 'vec$1').replace(/in\.color/g, 'C').replace(/vColor/g, 'C'));
  const [gpu, gl] = [lines(await read('shaders.js')), lines(await read('shaders-gl.js'))];
  for (const n of ['fill', 'calm', 'dx', 'dz', 'r', 'still', 'tl', 'sky', 'c']) assert.ok(gpu.some((l) => l.startsWith(`${n} =`)), `WebGPU has its ${n} line`);
  assert.deepEqual(gl, gpu);
});

test("both renderers' per-frame block has the same fields, the size main.js fills, and the shader sources load (a backtick in a shader comment ended its string)", async () => {
  const read = async (f) => readFile(new URL(`../reading-thames/${f}`, import.meta.url), 'utf8');
  const gpu = await import('../reading-thames/shaders.js');
  const gl = await import('../reading-thames/shaders-gl.js');
  assert.ok(gpu.WATER.includes('fn woodAt(') && gl.WATER.fs.includes('float woodAt('), 'the water shaders load whole');
  // Field names and sizes in vec4s, in order.
  const block = (src, open) => src.slice(src.indexOf(open), src.indexOf('}', src.indexOf(open))).split('\n').slice(1)
    .map((l) => l.trim().match(/^(?:(\w+): (\w+)(?:<vec4f, (\d+)>)?|(\w+) (\w+)(?:\[(\d+)\])?;)/)).filter(Boolean)
    .map((m) => [m[1] ?? m[5], (m[2] ?? m[4]).startsWith('mat') ? 4 : Number(m[3] ?? m[6] ?? 1)]);
  const wgsl = block(await read('shaders.js'), 'struct Frame {');
  assert.deepEqual(block(await read('shaders-gl.js'), 'uniform Frame {'), wgsl);
  const vec4s = wgsl.reduce((t, [, n]) => t + n, 0);
  assert.match(await read('main.js'), new RegExp(`const frameData = new Float32Array\\(${vec4s * 4}\\)`));
  for (const f of ['render.js', 'render-gl.js']) assert.match(await read(f), new RegExp(`FRAME_BYTES = 16 \\* 4 \\+ ${vec4s - 4} \\* 16`), f);
  // main.js writes each field where the block has it (in floats).
  const at = {};
  wgsl.reduce((o, [name, n]) => { at[name] = o; return o + n * 4; }, 0);
  const main = await read('main.js');
  assert.ok(main.includes(`frameData.set(race.course.scenery ? THAMES : WATER, ${at.water});`), `water at ${at.water}`);
  assert.ok(main.includes(`frameData.set([reflected.x, reflected.z, reflected.tx, reflected.tz], ${at.river});`), `river at ${at.river}`);
  assert.match(main, new RegExp(`\\[half \\+ 9, half \\+ 4, 7, 1\\], ${at.banks}\\);`), `banks at ${at.banks}`);
  assert.ok(main.includes(`frameData.set(spots[i] ?? [0, 0, 0, 0], ${at.spots} + i * 4);`), `spots at ${at.spots}`);
  assert.ok(main.includes(`frameData.set([...woodL, ...woodR], ${at.woods});`), `woods at ${at.woods}`);
  // The Thames lies calm (water.w), a made-up river doesn't.
  assert.match(main, /const THAMES = \[[^\]]*, 0\.[1-9]\d*\];/);
  assert.match(main, /const WATER = \[[^\]]*, 0\];/);
});

test('Christchurch Bridge: its arched deck clears the water by at least 4 m all the way across', async () => {
  const course = courseFromFile(await data('reading'));
  const bridge = course.scenery.bridges.find((b) => b.style === 'cable-stayed');
  const c = pointAt(course.scenery.river, bridge.s);
  const half = widthAt(course.scenery.river, bridge.s).half;
  // The deck's steel (dark grey) within 3 m of the crossing, over the water.
  const steel = (await world()).filter(({ color, p }) => color.every((v, i) => Math.abs(v - [0.32, 0.34, 0.37][i]) < 1e-3)
    && p.every((q) => Math.abs((q[0] - c.x) * c.tx + (q[2] - c.z) * c.tz) < 3 && Math.abs((q[0] - c.x) * -c.tz + (q[2] - c.z) * c.tx) < half));
  assert.ok(steel.length > 10, 'the deck is built');
  assert.ok(Math.min(...steel.flatMap(({ p }) => p.map((q) => q[1]))) >= 4, 'clear of a kayak and a cruiser');
});

test('the riverside terraces are drawn as terraces (red balconies), and the boardwalk is built below Christchurch Bridge', async () => {
  const { TERRACE } = await import('../reading-thames/world.js');
  const tris = await world();
  const reading = await data('reading');
  const terraces = reading.buildings.filter((b) => b.style === 'balcony-terrace');
  assert.ok(terraces.length > 20);
  assert.ok(tris.filter(({ color }) => color.every((v, i) => Math.abs(v - TERRACE.red[i]) < 1e-3)).length > 50, 'red balconies');
  const walk = reading.features.find((f) => f.style === 'boardwalk');
  assert.ok(walk, 'the boardwalk is in the course');
  // Its timber in its shades (deck, piles, fence, slats), there and only there.
  const shades = [1, 0.85, 0.75, 0.6].map((k) => [0.48, 0.3, 0.22].map((v) => v * k));
  const timber = tris.filter(({ color, p }) => shades.some((c) => color.every((v, i) => Math.abs(v - c[i]) < 1e-3)) && Math.hypot(p[0][0] - walk.at[0], p[0][2] - walk.at[1]) < 25);
  assert.ok(timber.length > 200, `its deck, piles and fence: ${timber.length} triangles`);
});

test('every club and landmark sign has a glyph for each of its letters', async () => {
  // sign() throws on a missing letter; building the world draws them all.
  assert.doesNotThrow(() => buildWorld(courseFromFile(JSON.parse(readFileSync(new URL('../reading-thames/courses/reading.json', import.meta.url), 'utf8'))), 1, 'river'));
});

test('a row of styled houses (balcony-terrace) keeps the trees between them, as plain houses do', async () => {
  // The 30 m clearing round a styled building is for landmarks; given to 56
  // riverside houses it took the willows off that bank.
  const reading = await data('reading');
  const plain = { ...reading, buildings: reading.buildings.map(({ style, ...b }) => (style === 'balcony-terrace' ? b : { ...b, style })) };
  const trunks = (course) => {
    const { vertices: v } = buildWorld(courseFromFile(course), 1, 'river');
    let n = 0;
    for (let i = 0; i < v.length; i += 27) if (Math.abs(v[i + 6] - 0.35) < 1e-3 && Math.abs(v[i + 7] - 0.25) < 1e-3 && Math.abs(v[i + 8] - 0.17) < 1e-3) n++;
    return n;
  };
  assert.equal(trunks(reading), trunks(plain));
});

test('the boatyard stands on land on its quay, and the timber boathouse on its own bank clear of the riverside villa', async () => {
  const { BOATYARD, landmarkFrame } = await import('../reading-thames/world.js');
  const reading = await data('reading');
  const land = waterMap(reading.water);
  const course = courseFromFile(reading);
  const tris = await world();
  const is = (rgb) => ({ color }) => color.every((v, i) => Math.abs(v - rgb[i]) < 1e-3);
  const mid = ({ p }) => [0, 2].map((i) => (p[0][i] + p[1][i] + p[2][i]) / 3);
  // The boatyard: its walls built, and on land; its quay reaching the water.
  const yard = landmarkFrame(course, 'boatyard');
  const near = (t) => Math.hypot(mid(t)[0] - yard.origin[0], mid(t)[1] - yard.origin[2]) < 40;
  const walls = tris.filter(is(BOATYARD.wall)).filter(near);
  assert.ok(walls.length >= 12, `its walls: ${walls.length}`);
  assert.ok(walls.every((t) => !land.inside(...mid(t))), 'the building is on land');
  const quay = tris.filter(is(BOATYARD.quay)).filter(near);
  assert.ok(quay.length > 6, 'its quay');
  const edge = yard.at(0, 0, yard.edge + 0.5);
  assert.ok(land.inside(edge[0], edge[2]), 'water just off the quay');
  // The timber boathouse: grey boarding near its spot, all on land, and 8 m clear of the villa's footprint.
  const spot = reading.features.find((f) => f.style === 'deck-boathouse');
  const grey = tris.filter(is([0.5, 0.47, 0.43])).filter((t) => Math.hypot(mid(t)[0] - spot.at[0], mid(t)[1] - spot.at[1]) < 12);
  assert.ok(grey.length >= 12, `its boarding: ${grey.length}`);
  assert.ok(grey.every((t) => !land.inside(...mid(t))), 'on land, not in the river');
  const villa = reading.buildings.find((b) => b.style === 'riverside-villa').shape;
  const gap = Math.min(...villa.map(([x, z]) => Math.hypot(x - spot.at[0], z - spot.at[1])));
  assert.ok(gap > 8, `${gap.toFixed(1)} m from the villa`);
});

test('upstream of Mapledurham: the dead tree, the white river sign and the sand beach are built on their banks', async () => {
  const reading = await data('reading');
  const tris = await world();
  const is = (rgb) => ({ color }) => color.every((v, i) => Math.abs(v - rgb[i]) < 1e-3);
  const mid = ({ p }) => [0, 2].map((i) => (p[0][i] + p[1][i] + p[2][i]) / 3);
  for (const [style, rgb, min] of [['dead-tree', [0.42, 0.4, 0.37], 60], ['river-sign', [0.15, 0.2, 0.45], 6]]) {
    const at = reading.features.find((f) => f.style === style)?.at;
    assert.ok(at, `${style} is in the course`);
    const built = tris.filter(is(rgb)).filter((t) => Math.hypot(mid(t)[0] - at[0], mid(t)[1] - at[1]) < 15);
    assert.ok(built.length >= min, `${style}: ${built.length} triangles`);
  }
  assert.ok(reading.features.some((f) => f.style === 'beach' && Math.hypot(f.at[0] + 4711, f.at[1] + 2438) < 10), 'the beach at r1');
});

test('both renderers mirror the banks with the same treeline(), line for line', async () => {
  const read = async (f) => readFile(new URL(`../reading-thames/${f}`, import.meta.url), 'utf8');
  // WGSL's select(f, t, c) as GLSL's c ? t : f, then without types, brackets or spaces.
  const args = (inner) => {
    const out = [];
    let depth = 0, start = 0;
    for (let i = 0; i < inner.length; i++) {
      if ('(['.includes(inner[i])) depth++;
      else if (')]'.includes(inner[i])) depth--;
      else if (inner[i] === ',' && depth === 0) { out.push(inner.slice(start, i)); start = i + 1; }
    }
    return [...out, inner.slice(start)].map((a) => a.trim());
  };
  const unselect = (line) => {
    const at = line.indexOf('select(');
    if (at < 0) return line;
    let depth = 0, end = at + 6;
    for (; end < line.length; end++) {
      if (line[end] === '(') depth++;
      else if (line[end] === ')' && --depth === 0) break;
    }
    const [f, t, c] = args(line.slice(at + 7, end));
    return unselect(`${line.slice(0, at)}${c} ? ${t} : ${f}${line.slice(end + 1)}`);
  };
  const body = (src, head) => {
    const from = src.indexOf(head);
    return src.slice(from, src.indexOf('\n}', from)).split('\n').slice(1)
      .map((l) => l.trim()).filter((l) => l && !l.startsWith('//'))
      .map((l) => unselect(l.replace(/\b(var|int) /g, '').replace(/\bf32\(/g, 'float(').replace(/^(let|float|vec[23]) /, '').replace(/vec([23])f/g, 'vec$1').replace(/[{};]/g, '').replace(/^if (.*) return/, 'if $1 return')))
      .map((l) => l.replace(/[()\s]/g, ''));
  };
  const gpu = body(await read('shaders.js'), 'fn treeline(');
  const gl = body(await read('shaders-gl.js'), 'vec2 treeline(');
  assert.ok(gpu.length >= 10, `${gpu.length} lines`);
  assert.deepEqual(gl, gpu);
  // And woodAt(), which reads the woods strip.
  const i32 = (lines) => lines.map((l) => l.replace(/i32/g, 'int'));
  const [gpuWood, glWood] = [i32(body(await read('shaders.js'), 'fn woodAt(')), i32(body(await read('shaders-gl.js'), 'float woodAt('))];
  assert.equal(gpuWood.length, 4);
  assert.deepEqual(glWood, gpuWood);
});

test("the dead tree, the river sign and the beach stand on their banks, not out in the river", async () => {
  const reading = await data('reading');
  const land = waterMap(reading.water);
  for (const style of ['dead-tree', 'river-sign', 'beach']) {
    const near = reading.features.filter((f) => f.style === style && f.at[1] < -2000);
    assert.ok(near.length, `${style} upstream of Mapledurham`);
    for (const { at } of near) {
      const dry = Array.from({ length: 16 }, (_, k) => [at[0] + 3 * Math.cos(k * 0.39), at[1] + 3 * Math.sin(k * 0.39)]).some(([x, z]) => !land.inside(x, z));
      assert.ok(dry, `${style} at ${at}: the bank is within 3 m`);
    }
  }
});

test("the water mirrors trees only where a bank is wooded (the lidar's canopy): the town front by Christchurch Bridge open, the reach at 3 km wooded both sides", async () => {
  const { bankWoods } = await import('../reading-thames/world.js');
  const { pointAt: at } = await import('../reading-thames/course.js');
  const reading = courseFromFile(await data('reading'));
  const woods = (s) => { const p = at(reading.scenery.river, s); return bankWoods(reading, p.x, p.z, p.tx, p.tz); };
  // Above Christchurch Bridge the north bank's trees (the footage shows them mirrored; the
  // vegetation model has them over a fifth of the first 14 m, 0.4 counted as half covers full)
  // against the open town front opposite.
  const [town, trees] = woods(150);
  assert.ok(town < 0.2 && trees >= 0.4, `above Christchurch Bridge ${town}, ${trees}`);
  assert.deepEqual(woods(3000), [1, 1], 'the wooded reach');
  // Facing the other way, left and right swap.
  const p = at(reading.scenery.river, 300);
  assert.deepEqual(bankWoods(reading, p.x, p.z, -p.tx, -p.tz), [...woods(300)].reverse());
});

test("the water reads the woods where each reflection meets the bank, not only beside you: a strip along each bank, which changes where the town front by Christchurch Bridge begins", async () => {
  const { bankWoods, bankWoodsAlong } = await import('../reading-thames/world.js');
  const { pointAt: at } = await import('../reading-thames/course.js');
  const reading = courseFromFile(await data('reading'));
  const { river } = reading.scenery;
  const strip = (s, sign = 1) => { const p = at(river, s); return bankWoodsAlong(reading, p.x, p.z, sign * p.tx, sign * p.tz); };
  const woods = (s) => { const p = at(river, s); return bankWoods(reading, p.x, p.z, p.tx, p.tz); };
  // Every 20 m from 150 m behind to 150 m ahead: sample k is at s + (k - 7.5) * 20.
  const [left, right] = strip(3000);
  assert.equal(left.length, 16);
  assert.equal(left[0], woods(2850)[0]);
  assert.equal(right[15], woods(3150)[1]);
  // It changes along the strip where the bank does (the town front by Christchurch Bridge, s 150, is open on the left).
  const [townSide] = strip(300);
  assert.ok(Math.min(...townSide) < 0.2 && Math.max(...townSide) > Math.min(...townSide), `left bank along s 150–450: ${townSide}`);
  // Facing the other way, the sides swap and the strip runs backwards.
  const [backL, backR] = strip(300, -1);
  assert.deepEqual([backL, backR], [[...strip(300)[1]].reverse(), [...townSide].reverse()]);
  // Past either end of the river it holds the end's value; a made-up river is all woods.
  const [startL] = strip(0);
  assert.ok(startL.slice(0, 8).every((v) => v === woods(0)[0]), `${startL}`);
  const [, endR] = strip(river.length);
  assert.ok(endR.slice(8).every((v) => v === woods(river.length)[1]), `${endR}`);
  assert.deepEqual(bankWoodsAlong({}, 0, 0, 1, 0), [Array(16).fill(1), Array(16).fill(1)]);
});

test("the water shaders read the woods strip where main.js puts it: 16 a bank, 20 m apart, centred on the reflections' river point", async () => {
  const { bankWoodsAlong } = await import('../reading-thames/world.js');
  const read = async (f) => readFile(new URL(`../reading-thames/${f}`, import.meta.url), 'utf8');
  const reading = courseFromFile(await data('reading'));
  const p = pointAt(reading.scenery.river, 3000);
  const [left, right] = bankWoodsAlong(reading, p.x, p.z, p.tx, p.tz);
  const n = left.length;
  const step = 20; // bankWoodsAlong's default spacing: k sits (k - (n - 1) / 2) * step along
  for (const f of ['shaders.js', 'shaders-gl.js']) {
    const src = await read(f);
    assert.ok(src.includes(`clamp(a / ${step}.0 + ${(n - 1) / 2}, 0.0, ${n - 1}.0)`), `${f}: its spacing and centre`);
    assert.ok(src.includes(`k * ${n} + i`) && src.includes(`, ${n - 2});`), `${f}: ${n} a bank`);
  }
  // The shaders' woodAt, in JS, over the flat strip main.js writes.
  const flat = [...left, ...right];
  const woodAt = (k, a) => { const f = Math.min(n - 1, Math.max(0, a / step + (n - 1) / 2)); const i = Math.min(Math.floor(f), n - 2); const j = k * n + i; return flat[j] + (flat[j + 1] - flat[j]) * (f - i); };
  for (let k = 0; k < n; k++) {
    assert.ok(Math.abs(woodAt(0, (k - (n - 1) / 2) * step) - left[k]) < 1e-6, `left ${k}`);
    assert.ok(Math.abs(woodAt(1, (k - (n - 1) / 2) * step) - right[k]) < 1e-6, `right ${k}`);
  }
  assert.equal(woodAt(0, -1000), left[0]);
  assert.equal(woodAt(0, 1000), left[n - 1]);
  assert.equal(woodAt(1, 1000), right[n - 1]);
});

test("a camera held still off the Loop's route mirrors the river where it stands, not the Loop's nearest point", async () => {
  const { mirrorLine, locate } = await import('../reading-thames/course.js');
  const loop = courseFromFile(await data('loop'));
  const river = loop.scenery.river;
  const eye = pointAt(river, 3100); // 3.1 km up, off the Loop
  const held = locate(mirrorLine(loop, true), eye.x, eye.z);
  assert.ok(Math.abs(held.lateral) < 5, `held camera: ${held.lateral.toFixed(1)} m off its line`);
  assert.ok(Math.abs(locate(loop, eye.x, eye.z).lateral) > 100, "the Loop's own line is far off there");
  assert.equal(mirrorLine(loop, false), loop);
});

test("the rowing club's car park is flat (the bank rises behind the club), and the walk's camera stands on it", async () => {
  const { rowingEnd, groundAt } = await import('../reading-thames/world.js');
  const reading = courseFromFile(await data('reading'));
  const park = rowingEnd(reading);
  const level = park.at(0, 0, 0)[1];
  // Across the whole tarmac, out from the end wall and across its width.
  for (let x = 1; x <= park.long; x += 3) {
    for (let z = -park.half - 6; z <= park.half; z += 2) {
      const p = park.at(x, 0, z);
      assert.ok(Math.abs(groundAt(reading, p[0], p[2]) - level) < 0.01, `ground ${groundAt(reading, p[0], p[2]).toFixed(2)} at ${x}, ${z}: not the car park's ${level.toFixed(2)}`);
    }
  }
  // Without the car park the made-up ground rose 2.5 m across it: the end wall
  // stood in a bank of grass. The measured ground (lidar) is within a metre of it.
  const river = reading.scenery.river;
  const [pads, lidar] = [river.pads, river.lidar];
  river.pads = [];
  const across = () => [-park.half, park.half].map((z) => { const p = park.at(10, 0, z); return groundAt(reading, p[0], p[2]); });
  const measured = across();
  river.lidar = null;
  const madeUp = across();
  [river.pads, river.lidar] = [pads, lidar];
  assert.ok(Math.abs(madeUp[0] - madeUp[1]) > 1.5, 'the test would fail without it');
  for (const h of measured) assert.ok(Math.abs(h - level) < 1, `measured ground ${h.toFixed(2)}, the car park ${level.toFixed(2)}`);
});

test("the rowing club stands at the same height, and its car park at the same place, whether or not the river was built first", async () => {
  const { rowingEnd, landmarkFrame, buildWorld } = await import('../reading-thames/world.js');
  const fresh = courseFromFile(await data('reading'));
  const before = { end: rowingEnd(fresh).at(0, 0, 0), origin: landmarkFrame(fresh, 'rowing-club').origin };
  buildWorld(fresh, 1, 'river');
  assert.deepEqual(rowingEnd(fresh).at(0, 0, 0), before.end, "the car park where the walk's camera stands");
  assert.deepEqual(landmarkFrame(fresh, 'rowing-club').origin, before.origin, 'the club where it is drawn');
});
