// The Reading river's scenery: the places the owner pointed out, modelled from
// the footage (world.js FEATURES and LANDMARKS), and the bridge over Piper's
// Island laid along its real road.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { courseFromFile, pointAt, widthAt } from '../reading-thames/course.js';
import { waterMap } from '../reading-thames/water.js';
import { buildWorld, FEATURE_STYLES, LANDMARK_STYLES, mirrorFacades, nearFacades, landmarkFrame, FACADE } from '../reading-thames/world.js';

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
  const lines = (src) => src.split('\n').map((l) => l.trim()).filter((l) => /^(let|var|float|vec[234]) ((fill|lit|still|tl|fa|sky|calm|r|dx|dz) =|c = mix\(frame\.water)|^c \+= vec3f?\(1\.0, 0\.9/.test(l))
    .map((l) => l.replace(/^(let|var|float|vec[234]) /, '').replace(/vec([23])f/g, 'vec$1').replace(/in\.color/g, 'C').replace(/vColor/g, 'C').replace(/in\.woods|vWoods/g, 'W'));
  const [gpu, gl] = [lines(await read('shaders.js')), lines(await read('shaders-gl.js'))];
  for (const n of ['fill', 'calm', 'dx', 'dz', 'r', 'still', 'tl', 'fa', 'sky', 'c', 'c +']) assert.ok(gpu.some((l) => l.startsWith(`${n} =`) || l.startsWith(`${n}=`)), `WebGPU has its ${n} line`);
  // The sun's glint is kept off where a bridge or a building is mirrored.
  assert.ok(gpu.some((l) => l.startsWith('c +=') && l.endsWith('* (1.0 - fa.a);')), 'no glint under a bridge');
  // The facades' texture is premultiplied (clear texels are black): added as it is, not mixed by its alpha again
  // (a plain mix drew a dark rim round every reflection).
  assert.ok(gpu.some((l) => /^sky = .* \* \(1\.0 - fa\.a\) \+ fa\.rgb;/.test(l)), 'premultiplied');
  // Calm water mirrors a building as it mirrors trees, looking down into it too.
  assert.ok(gpu.some((l) => l.startsWith('c = mix(frame.water') && l.includes('max(tl.x, fa.a)')), 'calm water mirrors the facades');
  for (const f of ['shaders.js', 'shaders-gl.js']) {
    // Each picture's ends fade out (a hard end read as a picture pasted on the water).
    assert.match(await read(f), /\* smoothstep\(0\.0, 0\.04, min\(best\.x, 1\.0 - best\.x\)\);/, `${f}: faded ends`);
  }
  assert.deepEqual(gl, gpu);
});

test("both renderers' per-frame block has the same fields, the size main.js fills, and the shader sources load (a backtick in a shader comment ended its string)", async () => {
  const read = async (f) => readFile(new URL(`../reading-thames/${f}`, import.meta.url), 'utf8');
  const gpu = await import('../reading-thames/shaders.js');
  const gl = await import('../reading-thames/shaders-gl.js');
  assert.ok(gpu.WATER.includes('fn woodAt(') && gl.WATER.vs.includes('float woodAt('), 'the water shaders load whole');
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
  assert.ok(main.includes(`frameData.set(nearFacades(facadesShown, eye[0], eye[2]), ${at.facades});`), `facades at ${at.facades}`);
  assert.equal(nearFacades(null, 0, 0).length, wgsl.find(([n]) => n === 'facades')[1] * 4, 'nearFacades fills the facades field');
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

test('the boatyard stands on land on its quay, and the timber boathouse at the downstream end of the riverside villa\'s quay', async () => {
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
  // The timber boathouse: pale weathered boarding near its spot, all on land.
  const { DECK } = await import('../reading-thames/world.js');
  const spot = reading.features.find((f) => f.style === 'deck-boathouse');
  const grey = tris.filter(is(DECK.wall)).filter((t) => Math.hypot(mid(t)[0] - spot.at[0], mid(t)[1] - spot.at[1]) < 12);
  assert.ok(grey.length >= 12, `its boarding: ${grey.length}`);
  assert.ok(grey.every((t) => !land.inside(...mid(t))), 'on land, not in the river');
  // Where the footage and the lidar put it: at the water in front of the
  // villa's footprint (the lidar's 4 m roof there), the quay running upstream
  // from it (+x, on your left from the water), its shrubs downstream.
  const { VILLA } = await import('../reading-thames/world.js');
  const villa = landmarkFrame(course, 'riverside-villa');
  const [sx, sz] = inFrame(villa, [spot.at[0], 0, spot.at[1]]);
  assert.ok(Math.abs(sx) < 4 && sz > villa.depth[1] - 1 && sz < villa.edge + 1, `the boathouse at (${sx.toFixed(1)}, ${sz.toFixed(1)}) in the villa's frame`);
  const posts = tris.filter(is(VILLA.post)).filter((t) => Math.hypot(mid(t)[0] - villa.origin[0], mid(t)[1] - villa.origin[2]) < 50);
  assert.ok(posts.length > 50, `the quay's posts: ${posts.length}`);
  assert.ok(posts.every(({ p }) => inFrame(villa, p[0])[0] > sx + 2), 'the quay runs upstream from the boathouse');
});

// A point's place in a landmark's frame: [x along the bank (+ on your left
// from the water), z towards the water], and its height over the water.
function inFrame(f, [x, y, z]) {
  const [dx, dz] = [x - f.origin[0], z - f.origin[2]];
  return [dx * f.right[0] + dz * f.right[1], dx * f.fwd[0] + dz * f.fwd[1], y];
}
// A landmark's triangles of one colour within r of it, as points in its frame.
// (`shaded`: any shade of it, as a cone's sides are drawn.)
async function landmarkParts(style, rgb, r = 40, shaded = false) {
  const { landmarkFrame } = await import('../reading-thames/world.js');
  const f = landmarkFrame(courseFromFile(await data('reading')), style);
  const same = (color) => (shaded ? color.every((v, i) => Math.abs(v / rgb[i] - color[0] / rgb[0]) < 1e-3) && color[0] / rgb[0] > 0.8 && color[0] / rgb[0] < 1.2 : color.every((v, i) => Math.abs(v - rgb[i]) < 1e-3));
  const pts = (await world()).filter(({ color, p }) => same(color) && Math.hypot(p[0][0] - f.origin[0], p[0][2] - f.origin[2]) < r)
    .flatMap(({ p }) => p.map((q) => inFrame(f, q)));
  const span = (i) => pts.length ? Math.max(...pts.map((q) => q[i])) - Math.min(...pts.map((q) => q[i])) : 0;
  return { f, pts, top: Math.max(...pts.map((q) => q[2])), width: span(0), xs: pts.map((q) => q[0]), zs: pts.map((q) => q[1]) };
}

test('the riverside villa as the footage shows it: no house at the water, a timber quay with posts, lamps and parasols, big trees with a copper beech, the white house 25 m back', async () => {
  const { VILLA } = await import('../reading-thames/world.js');
  const house = await landmarkParts('riverside-villa', VILLA.render, 60);
  assert.ok(house.pts.length > 0, 'the house is built');
  assert.ok(Math.max(...house.zs) < house.f.edge - 25, `the house is ${(house.f.edge - Math.max(...house.zs)).toFixed(1)} m back from the water`);
  assert.ok((await landmarkParts('riverside-villa', VILLA.chimney, 60)).top > 9, 'its brick chimney over its roof');
  const lamps = await landmarkParts('riverside-villa', VILLA.lamp, 60);
  const parasols = await landmarkParts('riverside-villa', VILLA.parasol, 60);
  assert.ok(lamps.pts.length && parasols.pts.length, 'lamp posts and parasols on the quay');
  assert.ok((await landmarkParts('riverside-villa', VILLA.beech[0], 60)).pts.length, 'the copper beech');
  // Nothing of the old villa: no clapboard, no white tower at the water.
  assert.ok(!(await landmarkParts('riverside-villa', [0.56, 0.63, 0.7], 60)).pts.length, 'no blue clapboard villa');
});

test('the glass house as the footage and lidar show it: black on both floors, the upper set back under a glass rail, 6-7 m to its roof, behind a lawn and a pale quay', async () => {
  const { GLASS } = await import('../reading-thames/world.js');
  const clad = await landmarkParts('glass-house', GLASS.clad);
  const upper = await landmarkParts('glass-house', GLASS.upper);
  const roof = await landmarkParts('glass-house', GLASS.fascia);
  assert.ok(clad.pts.length && upper.pts.length, 'both floors built');
  assert.ok([GLASS.clad, GLASS.upper].every((c) => Math.max(...c) < 0.3), 'both dark');
  assert.ok(clad.top < upper.top, 'one over the other');
  assert.ok((await landmarkParts('glass-house', GLASS.rail)).top > roof.top, 'a glass rail round the roof');
  assert.ok(Math.max(...upper.zs) < Math.max(...clad.zs) - 1, 'the upper floor set back');
  const tall = roof.top - roof.f.origin[1];
  assert.ok(tall > 5.5 && tall < 7.5, `roof ${tall.toFixed(1)} m over its ground (lidar: 5.7 m median, 8.9 m at most)`);
  assert.ok(clad.f.edge - Math.max(...clad.zs) > 14, 'set back from the water');
  assert.ok((await landmarkParts('glass-house', GLASS.quay)).pts.length && Math.min(...GLASS.quay) > 0.6, 'the pale quay');
});

test('the canoe club as the footage shows it: one band of big windows by the gable, a tree at its upstream end, the narrow steps past it, a brick ramp wall with a white rail coming down upstream', async () => {
  const { CANOE } = await import('../reading-thames/world.js');
  const { f, pts } = await landmarkParts('canoe-club', CANOE.glass);
  const [lo, hi] = [Math.max(f.along[0], -21), Math.min(f.along[1], 14)];
  const b = hi - 17;
  const third = (b - lo) / 3;
  // The glass: the glazed corner room downstream, the face by the gable, and the door; none on the middle of the bow.
  assert.ok(pts.every(([x]) => x < lo + 3.1 || x > lo + 2 * third - 0.1), 'no band of windows across the whole bowed wing');
  // The upstream tree's trunk at the club's upstream end.
  const trunks = await landmarkParts('canoe-club', [0.35, 0.25, 0.17], 40);
  assert.ok(trunks.pts.some(([x, z]) => Math.abs(x - (hi + 2.5)) < 1 && z > f.edge - 6), 'a big tree at the upstream end');
  // The ramp wall's white rail upstream, higher by the club than further up.
  const rail = (await landmarkParts('canoe-club', CANOE.rail, 50)).pts.filter(([x]) => x > hi + 0.5);
  assert.ok(rail.length > 20, 'the rail upstream of the club');
  const near = Math.max(...rail.filter(([x]) => x < hi + 4).map((q) => q[2]));
  const far = Math.max(...rail.filter(([x]) => x > hi + 17).map((q) => q[2]));
  assert.ok(near > far + 2, `the ramp comes down: ${near.toFixed(1)} m by the club, ${far.toFixed(1)} m upstream`);
});

test('the spiral-stair boathouse to the lidar: 11.5 m to its ridge over the water, 11 m wide, a dock on the water, two glass balconies, the gable dark timber', async () => {
  const { SPIRAL } = await import('../reading-thames/world.js');
  const roof = await landmarkParts('spiral-boathouse', SPIRAL.roof, 20);
  assert.ok(roof.top > 11 && roof.top < 12, `ridge ${roof.top.toFixed(1)} m over the water`);
  const brick = await landmarkParts('spiral-boathouse', SPIRAL.brick, 20);
  assert.ok(brick.width > 9 && brick.width < 11.5, `${brick.width.toFixed(1)} m wide`);
  const glass = await landmarkParts('spiral-boathouse', SPIRAL.glass, 20);
  const levels = new Set(glass.pts.map((q) => Math.round(q[2] / 3)));
  assert.ok(levels.size >= 2, 'a glass balcony on each floor');
  assert.ok((await landmarkParts('spiral-boathouse', SPIRAL.timber, 20)).top > 10, 'the dark timber gable');
  assert.ok(Math.max(...brick.zs) > brick.f.edge - 0.5, 'its dock at the water');
});

test('the Tudor boathouse to the footage and lidar: a narrow gable end in the river, 7.6 m across and 7.8 m to its ridge, grey boat doors, black-and-white timbering', async () => {
  const { TUDOR } = await import('../reading-thames/world.js');
  const walls = await landmarkParts('tudor-boathouse', TUDOR.render, 15);
  assert.ok(walls.width > 7 && walls.width < 8.8, `${walls.width.toFixed(1)} m across`);
  const roof = await landmarkParts('tudor-boathouse', TUDOR.roof, 15);
  assert.ok(roof.top > 7.3 && roof.top < 8.3, `ridge ${roof.top.toFixed(1)} m over the water`);
  const doors = await landmarkParts('tudor-boathouse', TUDOR.doors, 15);
  assert.ok(doors.pts.length && Math.min(...doors.zs) > doors.f.edge - 0.5, 'the boat doors on the water');
  assert.ok(Math.min(...doors.pts.map((q) => q[2])) < 0.5, 'down to the water');
  assert.ok((await landmarkParts('tudor-boathouse', TUDOR.timber, 15)).top > 6, 'timbers up the gable');
  assert.ok((await landmarkParts('tudor-boathouse', TUDOR.purple[0], 30)).pts.length, 'the purple-leaved tree behind');
});

test('the Victorian house is the one the footage shows (the lidar\'s 13 m roof, not the tree), with its tower upstream, a balcony over the dock, and the striped awning', async () => {
  const { VICTORIAN } = await import('../reading-thames/world.js');
  const reading = await data('reading');
  const b = reading.buildings.find((x) => x.style === 'victorian');
  const c = [0, 1].map((i) => b.shape.reduce((t, p) => t + p[i], 0) / b.shape.length);
  assert.ok(Math.hypot(c[0] + 1587.1, c[1] + 828.1) < 3, `its footprint at (${c.map((v) => v.toFixed(1))})`);
  const roof = await landmarkParts('victorian', VICTORIAN.tiles, 25);
  assert.ok(roof.top > 12.5 && roof.top < 13.5, `ridge ${roof.top.toFixed(1)} m over the water`);
  const dome = await landmarkParts('victorian', VICTORIAN.dome, 25, true);
  assert.ok(dome.xs.every((x) => x > 4), 'the tower on its upstream side (your left from the water)');
  assert.ok(dome.top > roof.top, 'its dome over the roof');
  assert.ok((await landmarkParts('victorian', VICTORIAN.awning, 25)).pts.length, 'the striped awning');
  const balcony = await landmarkParts('victorian', VICTORIAN.pier, 25);
  assert.ok(balcony.width > 11, 'the balcony along its front');
});

test('the boatyard to the footage and lidar: low and dark, the two-storey brick end downstream, a long low building upstream with flagpoles, 9 m at most over the water', async () => {
  const { BOATYARD } = await import('../reading-thames/world.js');
  const roof = await landmarkParts('boatyard', BOATYARD.roof, 40);
  assert.ok(roof.top < 9.5 && roof.top > 7, `highest roof ${roof.top.toFixed(1)} m over the water (lidar 7-9 m)`);
  const brick = await landmarkParts('boatyard', BOATYARD.brick, 40);
  const low = await landmarkParts('boatyard', BOATYARD.low, 40);
  assert.ok(Math.max(...brick.xs) < Math.min(...low.xs), 'brick end downstream (your right), the low building upstream');
  assert.ok(low.top < brick.top - 1, 'the upstream building is the low one');
  assert.ok((await landmarkParts('boatyard', BOATYARD.sign, 40)).pts.length, 'its sign boards');
  assert.ok((await landmarkParts('boatyard', BOATYARD.flags[1], 40)).pts.length, 'its flags');
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
      .map((l) => unselect(l.replace(/\b(var|int) /g, '').replace(/\bf32\(/g, 'float(').replace(/^(let|float|vec[234]) /, '').replace(/vec([234])f/g, 'vec$1').replace(/[{};]/g, '').replace(/^if (.*) return/, 'if $1 return')))
      .map((l) => l.replace(/[()\s]/g, ''));
  };
  const gpu = body(await read('shaders.js'), 'fn treeline(');
  const gl = body(await read('shaders-gl.js'), 'vec2 treeline(');
  assert.ok(gpu.length >= 10, `${gpu.length} lines`);
  assert.deepEqual(gl, gpu);
  // And woodAt(), which reads the woods strip.
  const i32 = (lines) => lines.map((l) => l.replace(/i32/g, 'int'));
  const [gpuWood, glWood] = [i32(body(await read('shaders.js'), 'fn woodAt(')), i32(body(await read('shaders-gl.js'), 'float woodAt('))];
  assert.equal(gpuWood.length, 2);
  assert.deepEqual(glWood, gpuWood);
  // And the vertex shader's woodsHere() and alongTo(), which find where each ray meets the banks.
  // And the reflected landmarks and bridges: facadeHit() and facades().
  const tex = (lines) => lines.map((l) => l.replace('textureSampleLevelfacadeTex,facadeSampler,', 'textureLodfacadeTex,'));
  for (const [wg, gl] of [['fn woodsHere(', 'vec2 woodsHere('], ['fn alongTo(', 'float alongTo('], ['fn facadeHit(', 'vec4 facadeHit('], ['fn facades(', 'vec4 facades(']]) {
    const [a, b] = [tex(body(await read('shaders.js'), wg)), tex(body(await read('shaders-gl.js'), gl))];
    assert.ok(a.length >= 1, wg);
    assert.deepEqual(b, a, wg);
  }
  // facadeHit() as the JS port in these tests (seen) has it: a face only from its front, ahead of the ray,
  // nearer than the best so far, inside its rectangle, sampled inside its own row.
  const hit = tex(body(await read('shaders.js'), 'fn facadeHit('));
  for (const line of ['ifdn>-0.000001returnbest', 'ift<=0.0||t>=best.wreturnbest', 'ifu<0.0||u>1.0||v<0.0||v>1.0returnbest', 'returnvec4u,a.w+clampv,0.02,0.98*b.w,0.0,t']) {
    assert.ok(hit.includes(line), `facadeHit has ${line}`);
  }
  // facades() looks at all six slots (nearFacades fills six).
  const all = body(await read('shaders.js'), 'fn facades(').join('\n');
  for (let k = 0; k < 6; k++) assert.ok(all.includes(`facadeHito,d,frame.facades[${k * 3}],frame.facades[${k * 3 + 1}],frame.facades[${k * 3 + 2}],best`), `slot ${k}`);
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
    // The left bank from the block's first four vec4s, the right from the next four.
    assert.match(src, /woodAt\(alongTo\(p, refl, -frame\.banks\.x\), (frame\.woods|w)\[0\], \1\[1\], \1\[2\], \1\[3\]\)/, `${f}: the left bank`);
    assert.match(src, /woodAt\(alongTo\(p, refl, frame\.banks\.y\), (frame\.woods|w)\[4\], \1\[5\], \1\[6\], \1\[7\]\)/, `${f}: the right bank`);
  }
  // The shaders' woodAt (tent weights over four vec4s), in JS, over each bank's 16 values.
  const woodAt = (a, w) => { const f = Math.min(n - 1, Math.max(0, a / step + (n - 1) / 2)); return w.reduce((t, v, i) => t + v * Math.max(0, 1 - Math.abs(f - i)), 0); };
  const lerp = (a, w) => { const f = Math.min(n - 1, Math.max(0, a / step + (n - 1) / 2)); const i = Math.min(Math.floor(f), n - 2); return w[i] + (w[i + 1] - w[i]) * (f - i); };
  for (let k = 0; k < n; k++) {
    assert.ok(Math.abs(woodAt((k - (n - 1) / 2) * step, left) - left[k]) < 1e-6, `left ${k}`);
    assert.ok(Math.abs(woodAt((k - (n - 1) / 2) * step, right) - right[k]) < 1e-6, `right ${k}`);
  }
  // Between samples it's straight between the two nearest, and past the ends it holds the end's value.
  for (let a = -200; a <= 200; a += 7.3) assert.ok(Math.abs(woodAt(a, left) - lerp(a, left)) < 1e-6, `at ${a}`);
  assert.ok(Math.abs(woodAt(-1000, left) - left[0]) < 1e-6);
  assert.ok(Math.abs(woodAt(1000, right) - right[n - 1]) < 1e-6);
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

test("a building the footage saw is drawn in its material (materials.js): brick, render or timber in a measured shade, a roof only where two views agreed; one it didn't see keeps its random pick", async () => {
  const { MATERIALS } = await import('../reading-thames/materials.js');
  const { buildingMaterial } = await import('../reading-thames/world.js');
  const reading = courseFromFile(await data('reading'));
  const tris = await world();
  const same = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-3);
  const centre = (b) => {
    const ring = b.shape[0][0] === b.shape.at(-1)[0] && b.shape[0][1] === b.shape.at(-1)[1] ? b.shape.slice(0, -1) : b.shape;
    return [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length, ring];
  };
  // Walls standing on the footprint's edges (in that colour, or any).
  const wallsOf = (ring, color) => tris.filter((t) => (!color || same(t.color, color)) && t.p.every((q) => ring.some(([x, z], i) => {
    const [bx, bz] = ring[(i + 1) % ring.length];
    const len = Math.hypot(bx - x, bz - z) || 1;
    const along = ((q[0] - x) * (bx - x) + (q[2] - z) * (bz - z)) / (len * len);
    return along > -0.01 && along < 1.01 && Math.abs((q[0] - x) * (bz - z) - (q[2] - z) * (bx - x)) / len < 0.05;
  })));
  let checked = 0;
  let matched = 0;
  for (const b of reading.scenery.buildings) {
    if (b.style) continue;
    const [cx, cz, ring] = centre(b);
    const seen = buildingMaterial(cx, cz);
    if (!seen?.wall) continue;
    matched++;
    // Not drawn where the map has water (an island, a pontoon): no wall over 2 m on its edges (fences and paths can line them).
    if (wallsOf(ring, null).filter((t) => Math.max(...t.p.map((q) => q[1])) - Math.min(...t.p.map((q) => q[1])) > 2).length < 2) continue;
    assert.ok(wallsOf(ring, seen.wall).length >= 2, `the building at ${cx.toFixed(1)}, ${cz.toFixed(1)} has walls in its material's colour`);
    checked++;
  }
  // Every row is a plain building in the file (a row that matches none would be dropped silently), and most are drawn.
  assert.ok(matched >= MATERIALS.length - 2, `${matched} of ${MATERIALS.length} rows match a building`);
  assert.ok(checked >= 0.8 * MATERIALS.length, `${checked} of ${MATERIALS.length} rows drawn in their material`);
  // Brick the model saw as brown or red is red brick; as sand or tan, buff (the flats below
  // Christchurch Bridge, which a light-red shade turned salmon: design review).
  const wallOf = (hex, kind) => { const r = MATERIALS.find((x) => x[2] === hex && x[3] === kind); assert.ok(r, `a ${kind} row with ${hex}`); return buildingMaterial(r[0], r[1]).wall; };
  const red = wallOf('#8b4513', 'brick');
  assert.ok(red[0] > red[2] + 0.25 && red[1] < 0.5, `red brick ${red}`);
  const buff = wallOf('#c2b280', 'brick');
  assert.ok(buff[1] > 0.62 && buff[0] - buff[2] < 0.32, `buff brick ${buff}`);
  // Rendered walls aren't one stamped white: each building a little lighter or darker, warmer or cooler.
  const whites = MATERIALS.filter((r) => r[3] === 'render').map((r) => buildingMaterial(r[0], r[1]).wall).filter((c) => c[1] > 0.8);
  assert.ok(whites.length >= 10 && new Set(whites.map((c) => c.map((v) => v.toFixed(2)).join())).size >= whites.length * 0.8, `${whites.length} whites`);
  assert.ok(whites.every((c) => c.every((v) => v > 0.8 && v <= 1)), 'still white');
  assert.equal(buildingMaterial(0.123, 0.456), null, 'a building it never saw');
  // Roofs: only the rows with an agreed roof have one.
  for (const r of MATERIALS) assert.equal(buildingMaterial(r[0], r[1]).roof === null, r[5] === null || !['tile', 'slate', 'metal'].includes(r[5]), `${r}`);
});

test("the materials change only the colours of the buildings they name: every position, normal and other colour is as without them (the random pick is still drawn)", async () => {
  const { MATERIALS } = await import('../reading-thames/materials.js');
  const { useMaterials } = await import('../reading-thames/world.js');
  const reading = await data('reading');
  const build = () => buildWorld(courseFromFile(reading), 1, 'river').vertices;
  let without;
  try { useMaterials([]); without = build(); } finally { useMaterials(MATERIALS); }
  const withThem = build();
  assert.equal(withThem.length, without.length);
  // Each named building's footprint, widened by half a metre (its walls and roof stand on it).
  const boxes = reading.buildings.filter((b) => !b.style).map((b) => {
    const ring = b.shape[0][0] === b.shape.at(-1)[0] && b.shape[0][1] === b.shape.at(-1)[1] ? b.shape.slice(0, -1) : b.shape;
    const c = [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length];
    return MATERIALS.some((r) => r[0].toFixed(1) === c[0].toFixed(1) && r[1].toFixed(1) === c[1].toFixed(1))
      ? [Math.min(...ring.map((p) => p[0])) - 0.5, Math.max(...ring.map((p) => p[0])) + 0.5, Math.min(...ring.map((p) => p[1])) - 0.5, Math.max(...ring.map((p) => p[1])) + 0.5] : null;
  }).filter(Boolean);
  let moved = 0, recoloured = 0, stray = 0;
  for (let i = 0; i < withThem.length; i += 9) {
    for (let k = 0; k < 6; k++) if (withThem[i + k] !== without[i + k]) moved++;
    if ([6, 7, 8].some((k) => withThem[i + k] !== without[i + k])) {
      recoloured++;
      const [x, z] = [withThem[i], withThem[i + 2]];
      if (!boxes.some(([x0, x1, z0, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1)) stray++;
    }
  }
  assert.equal(moved, 0, 'positions and normals');
  assert.ok(recoloured > 100, `${recoloured} vertices recoloured`);
  assert.equal(stray, 0, 'recoloured vertices off the named buildings');
});

test("each building the footage saw gets its material's light or dark shade by the model's colour, and its agreed roof on a pitched roof only", async () => {
  const { MATERIALS } = await import('../reading-thames/materials.js');
  const { buildingMaterial, MATERIAL_WALLS, MATERIAL_ROOFS } = await import('../reading-thames/world.js');
  const luma = (hex) => { const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255); return 0.3 * v[0] + 0.59 * v[1] + 0.11 * v[2]; };
  for (const r of MATERIALS) {
    const want = MATERIAL_WALLS[r[3]]?.[luma(r[2]) > 0.5 ? 0 : 1];
    const got = buildingMaterial(r[0], r[1]).wall;
    if (!want) { assert.equal(got, null, `${r}`); continue; }
    assert.ok(got.every((v, i) => Math.abs(v - want[i]) < 0.07), `${r}: ${got} against ${want}`);
  }
  assert.ok(['#ffffff', '#8b4513'].every((h) => MATERIALS.some((r) => r[2] === h)), 'the data has light and dark answers');
  // Roofs as drawn: a house's agreed roof is on it; a flat roof keeps its own.
  const reading = courseFromFile(await data('reading'));
  const tris = await world();
  const same = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-3);
  let pitchedChecked = 0, pitchedTotal = 0, flatChecked = 0;
  for (const b of reading.scenery.buildings) {
    if (b.style) continue;
    const ring = b.shape[0][0] === b.shape.at(-1)[0] && b.shape[0][1] === b.shape.at(-1)[1] ? b.shape.slice(0, -1) : b.shape;
    const [cx, cz] = [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length];
    const roof = buildingMaterial(cx, cz)?.roof;
    if (!roof) continue;
    // Its drawn roof triangles (any of the roof colours: world.js ROOFS and MATERIAL_ROOFS).
    const roofs = [[0.32, 0.2, 0.17], ...Object.values(MATERIAL_ROOFS)];
    const onIt = (color) => tris.filter((t) => (color ? same(t.color, color) : roofs.some((c) => same(t.color, c))) && (() => { const [x, z] = [(t.p[0][0] + t.p[1][0] + t.p[2][0]) / 3, (t.p[0][2] + t.p[1][2] + t.p[2][2]) / 3]; let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if ((ring[i][1] > z) !== (ring[j][1] > z) && x < ((ring[j][0] - ring[i][0]) * (z - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) inside = !inside; return inside; })());
    if (!onIt(null).length && (b.kind === 'house' || b.kind === 'boathouse')) continue; // not drawn (where the map has water)
    if (b.kind === 'house' || b.kind === 'boathouse') { pitchedTotal++; if (onIt(roof).length) pitchedChecked++; }
    else if (same(roof, MATERIAL_ROOFS.metal)) { assert.equal(onIt(roof).length, 0, `a flat roof at ${cx.toFixed(1)}, ${cz.toFixed(1)} took the seen metal roof`); flatChecked++; }
  }
  // (Every one: the random roofs include tile's and slate's colours, so some would match by chance.)
  assert.ok(pitchedTotal >= 4 && pitchedChecked === pitchedTotal, `${pitchedChecked} of ${pitchedTotal} houses with their agreed roof`);
  assert.ok(flatChecked >= 1, 'a flat roof with a seen roof row kept its own');
});

// --- what the water mirrors besides trees ---------------------------------------

const SUN = (() => { const v = [0.35, 0.42, -0.84]; const l = Math.hypot(...v); return v.map((x) => x / l); })();
const SKY_TOP = [0.3, 0.52, 0.84];
let mirrored;
async function mirror() {
  mirrored ??= (async () => {
    const course = courseFromFile(await data('reading'));
    buildWorld(course, 1, 'river');
    return { course, mirror: mirrorFacades(course, SUN, SKY_TOP) };
  })();
  return mirrored;
}
// The water shaders' facadeHit() and facades(), in JS: what a ray from o along d
// sees of the frame's facade slots, as [r, g, b, a] 0..1 from the texture's
// nearest texel, and which slot it met (or null).
function seen(o, d, slots, mirror) {
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  let best = [0, 0, 0, 1e9];
  let slot = null;
  for (let k = 0; k < slots.length / 12; k++) {
    const [a, b, c] = [0, 4, 8].map((i) => Array.from(slots.slice(k * 12 + i, k * 12 + i + 4)));
    const n = cross(b, c);
    const dn = dot(d, n);
    if (dn > -0.000001) continue;
    const t = dot(sub(a, o), n) / dn;
    if (t <= 0 || t >= best[3]) continue;
    const h = sub(o.map((v, i) => v + d[i] * t), a);
    const u = dot(h, b) / dot(b, b);
    const v = dot(h, c) / dot(c, c);
    if (u < 0 || u > 1 || v < 0 || v > 1) continue;
    best = [u, a[3] + Math.min(0.98, Math.max(0.02, v)) * b[3], 0, t];
    slot = k;
  }
  if (slot === null) return { color: [0, 0, 0, 0], slot };
  const x = Math.min(mirror.width - 1, Math.floor(best[0] * mirror.width));
  const y = Math.min(mirror.height - 1, Math.floor(best[1] * mirror.height));
  return { color: Array.from(mirror.pixels.slice((y * mirror.width + x) * 4, (y * mirror.width + x) * 4 + 4)).map((c) => c / 255), slot };
}
const unit = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };

test("the water under Caversham Bridge mirrors the bridge's dark underside, not the sky and the sun's glint", async () => {
  const { course, mirror: m } = await mirror();
  const bridge = course.bridges.find((b) => b.name === 'Caversham Bridge');
  const c = pointAt(course, bridge.s);
  const slots = nearFacades(m, c.x, c.z);
  // Looking up from the water under the deck, a little downstream and up.
  for (const along of [-0.3, 0, 0.3]) {
    const { color, slot } = seen([c.x, 0, c.z], unit([c.tx * along, 1, c.tz * along]), slots, m);
    assert.notEqual(slot, null, `along ${along}: the ray meets the bridge`);
    const f = m.facades.find((x) => x.row === Math.round(slots[slot * 12 + 3] * m.facades.length));
    assert.equal(f.name, 'Caversham Bridge underside');
    assert.equal(color[3], 1, 'solid, not clear');
    assert.ok(color[0] * 0.3 + color[1] * 0.59 + color[2] * 0.11 < 0.4, `dark (in shadow): ${color.map((x) => x.toFixed(2))}`);
  }
});

test("the water mirrors each landmark and both bridges: a landmark from its front only, its picture standing where its walls are (the Island Bar mirrored twice its width from its footprint's edge)", async () => {
  const { course, mirror: m } = await mirror();
  const landmarks = course.scenery.buildings.filter((b) => LANDMARK_STYLES.includes(b.style)).map((b) => b.style);
  for (const style of landmarks) {
    const f = m.facades.find((x) => x.name === style);
    assert.ok(f, `${style} is mirrored`);
    const fr = landmarkFrame(course, style);
    // Where the picture stands, out from the footprint's middle towards the water.
    const out = (f.p[0] - fr.origin[0]) * fr.fwd[0] + (f.p[2] - fr.origin[2]) * fr.fwd[1];
    // (Within its footprint, or out to the bank where it's built to the water: the spiral-stair boathouse's dock.)
    assert.ok(out > fr.depth[0] - 2 && out < Math.max(fr.depth[1], fr.edge) + 2, `${style}: ${out.toFixed(1)} m out, its footprint ${fr.depth.map((x) => x.toFixed(1))}, the bank ${fr.edge.toFixed(1)}`);
    // The Island Bar's glass front stands well back from its footprint's edge, which mirrored it twice its width.
    if (style === 'island-bar') assert.ok(out < fr.depth[1] - 5, `the Island Bar's picture at ${out.toFixed(1)} m`);
    // From 25 m out in front, looking back at it and up a little, the ray meets its picture; looking away it doesn't.
    const o = [fr.origin[0] + fr.fwd[0] * (fr.depth[1] + 25), 0, fr.origin[2] + fr.fwd[1] * (fr.depth[1] + 25)];
    const slots = nearFacades(m, o[0], o[2]);
    const mid = (fr.along[0] + fr.along[1]) / 2;
    const toward = unit([fr.origin[0] + fr.right[0] * mid - o[0], 0, fr.origin[2] + fr.right[1] * mid - o[2]]);
    let met = 0;
    for (let up = 0.05; up <= 0.4; up += 0.05) met += seen(o, unit([toward[0], up, toward[2]]), slots, m).color[3] > 0.5;
    assert.ok(met >= 3, `${style}: the reflection shows it (${met} of 8 rays)`);
    // From behind it (inland), a ray towards the water passes through its picture: only its front is mirrored.
    const behind = [fr.origin[0] - fr.fwd[0] * 30, 0, fr.origin[2] - fr.fwd[1] * 30];
    const only = nearFacades({ ...m, facades: [f] }, behind[0], behind[2]);
    assert.equal(seen(behind, unit([fr.fwd[0], 0.15, fr.fwd[1]]), only, m).slot, null, `${style} from behind`);
  }
  for (const part of ['side', 'underside']) assert.ok(m.facades.some((f) => f.name === `Caversham Bridge ${part}`), part);
  // Not Christchurch Bridge: its thin deck high over the water bent into a black snake in the ripples.
  assert.ok(!m.facades.some((f) => f.name.startsWith('Christchurch')), 'no Christchurch Bridge');
  assert.equal(m.facades.filter((f) => f.name === 'Caversham Bridge side').length, 2, 'both its sides');
  assert.ok(m.facades.some((f) => f.name === 'Caversham Bridge pier'), 'its piers');
  assert.equal(m.height, FACADE.h * m.facades.length);
  assert.equal(m.pixels.length, m.width * m.height * 4);
  // Premultiplied, as the shaders add it: a texel is solid or clear, and clear is black.
  for (let i = 0; i < m.pixels.length; i += 4) {
    const [r, g, b, a] = m.pixels.subarray(i, i + 4);
    assert.ok(a === 255 || (a === 0 && r === 0 && g === 0 && b === 0), `texel ${i / 4}: ${[r, g, b, a]}`);
  }
  // main.js hands the pictures to the renderer.
  assert.match(await readFile(new URL('../reading-thames/main.js', import.meta.url), 'utf8'), /renderer\.setFacades\(mirror \?\?/);
});

test("drawing the facades for the water changes nothing in the world: the river is the same, built before or after them", async () => {
  const { vertices: plain } = buildWorld(courseFromFile(await data('reading')), 1, 'river');
  const first = courseFromFile(await data('reading'));
  mirrorFacades(first, SUN, SKY_TOP);
  const { vertices: after } = buildWorld(first, 1, 'river');
  const { mirror: m, course } = await mirror();
  mirrorFacades(course, SUN, SKY_TOP);
  const { vertices: again } = buildWorld(course, 1, 'river');
  assert.equal(after.length, plain.length);
  assert.ok(after.every((v, i) => v === plain[i]), 'built after the facades');
  assert.ok(again.every((v, i) => v === plain[i]), 'built again after them');
  assert.ok(m.facades.length > 10);
});

test("each frame gets the six facades nearest the camera, nearest first, each slot pointing at its own picture row", async () => {
  const { course, mirror: m } = await mirror();
  const c = pointAt(course, course.bridges.find((b) => b.name === 'Caversham Bridge').s);
  const rows = m.facades.length;
  // From the bridge more than six are within reach (its sides, underside and piers, and the clubs upstream).
  const slots = nearFacades(m, c.x, c.z);
  const far = (f) => {
    // Distance to the rectangle's footprint, sampled finely (not the code's own formula).
    let best = Infinity;
    for (let a = 0; a <= 1; a += 0.005) for (let b = 0; b <= 1; b += f.v[1] ? 1 : 0.02) {
      best = Math.min(best, Math.hypot(f.p[0] + f.u[0] * a + f.v[0] * b - c.x, f.p[2] + f.u[2] * a + f.v[2] * b - c.z));
    }
    return best;
  };
  const ranked = m.facades.map((f) => [far(f), f.row]).sort((a, b) => a[0] - b[0]);
  assert.ok(ranked.filter(([d]) => d < 400).length > 6, 'more than six within reach');
  const got = [0, 1, 2, 3, 4, 5].map((k) => Math.round(slots[k * 12 + 3] * rows));
  assert.deepEqual(got, ranked.slice(0, 6).map(([, row]) => row));
  for (let k = 0; k < 6; k++) assert.ok(Math.abs(slots[k * 12 + 7] * rows - 1) < 1e-6, `slot ${k}: one row's share`);
  // Far up the river (5 km), none of these.
  const p = pointAt(course, 5000);
  const there = nearFacades(m, p.x, p.z);
  assert.ok([0, 1, 2, 3, 4, 5].every((k) => !m.facades[Math.round(there[k * 12 + 3] * rows)]?.name.startsWith('Caversham') || there[k * 12 + 7] === 0));
});
