import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { raceRiver, practiceRiver, courseFromFile, pointAt, widthAt, locate } from '../reading-thames/course.js';
import { TRAFFIC, createTraffic, moveTraffic, trafficHits, trafficWash, trafficWarnings } from '../reading-thames/traffic.js';
import { createBoat } from '../reading-thames/sim.js';

const fromFile = async (name) => courseFromFile(JSON.parse(await readFile(new URL(`../reading-thames/courses/${name}.json`, import.meta.url), 'utf8')));
const reach = (b) => Math.max(TRAFFIC[b.kind].hull, TRAFFIC[b.kind].oars?.[2] ?? 0);

test('the same race has the same traffic (every copy of a live race), another race other traffic', () => {
  const course = raceRiver();
  assert.deepEqual(createTraffic(course, 7).boats, createTraffic(course, 7).boats);
  assert.notDeepEqual(createTraffic(course, 7).boats, createTraffic(course, 8).boats);
});

test('traffic is infrequent and varies a lot from race to race', () => {
  const counts = Array.from({ length: 300 }, (_, seed) => createTraffic(raceRiver(), seed).boats.length);
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  assert.ok(mean > 1.5 && mean < 4.5, `${mean.toFixed(1)} boats a race`);
  assert.ok(counts.filter((n) => n <= 1).length > 20, 'some races are quiet');
  assert.ok(Math.max(...counts) >= 6, 'and some are busy');
  const kinds = new Set(Array.from({ length: 300 }, (_, seed) => createTraffic(raceRiver(), seed).boats.map((b) => b.kind)).flat());
  // (Narrowboats only where a course file's stretches put them: not on this made-up river.)
  assert.deepEqual([...kinds].sort(), Object.keys(TRAFFIC).filter((k) => k !== 'narrowboat').sort());
});

test('scullers, cruisers and motorboats only come towards the race; an eight now and then from behind, faster than the pack', async () => {
  let behind = 0;
  for (const course of [raceRiver(), await fromFile('loop'), await fromFile('reading')]) {
    for (let seed = 0; seed < 100; seed++) {
      const traffic = createTraffic(course, seed);
      for (const b of traffic.boats) {
        // The race's way along the river where they meet.
        const p = pointAt(course, course.start + 3.6 * traffic.k * b.at);
        const r = pointAt(traffic.river, b.meet);
        const along = Math.sign(p.tx * r.tx + p.tz * r.tz);
        if (b.behind) {
          behind++;
          assert.equal(b.kind, 'eight');
          assert.equal(b.dir, along);
          assert.ok(TRAFFIC.eight.speed > 3.6);
        } else assert.equal(b.dir, -along, `${b.kind} comes towards the race`);
      }
    }
  }
  assert.ok(behind > 5, `${behind} eights from behind`);
  // Never on the narrow made-up race river: there's no room to get by a pack.
  for (let seed = 0; seed < 100; seed++) assert.ok(!createTraffic(raceRiver(), seed).boats.some((b) => b.behind));
});

test('every boat keeps to its right, on the water, clear of the banks and moored boats', async () => {
  for (const course of [raceRiver(), practiceRiver(), await fromFile('reading')]) {
    for (let seed = 0; seed < 40; seed++) {
      const traffic = createTraffic(course, seed);
      for (let t = 0; t < 600; t += 2) {
        moveTraffic(traffic, t);
        for (const b of traffic.boats.filter((x) => x.on)) {
          assert.ok(b.lateral * b.dir >= 0, `${b.kind} on its right`);
          const w = widthAt(traffic.river, b.s);
          const open = b.dir > 0 ? w.right : w.left;
          assert.ok(Math.abs(b.lateral) + reach(b) <= open + 1e-6, `${b.kind} at ${b.s.toFixed(0)}: ${Math.abs(b.lateral).toFixed(1)} + ${reach(b)} in ${open.toFixed(1)} m`);
        }
      }
    }
  }
});

test("on the Loop the boats keep to the main channel: none ever goes through St Mary's gap", async () => {
  const course = await fromFile('loop');
  const river = course.scenery.river;
  // The route's own water, where it leaves the main channel (the gap behind the island).
  const side = course.samples.filter((p) => {
    const at = locate(river, p.x, p.z);
    return Math.abs(at.lateral) > widthAt(river, at.s).half + 5;
  });
  assert.ok(side.length > 20, `${side.length} samples of the route off the main channel`);
  let seen = 0;
  for (let seed = 0; seed < 60; seed++) {
    const traffic = createTraffic(course, seed);
    for (let t = 0; t < 1500; t += 3) {
      moveTraffic(traffic, t);
      for (const b of traffic.boats.filter((x) => x.on)) {
        seen++;
        const near = Math.min(...side.map((p) => Math.hypot(p.x - b.x, p.z - b.z)));
        assert.ok(near > 8, `${b.kind} ${near.toFixed(1)} m from the side channel`);
      }
    }
  }
  assert.ok(seen > 100);
});

// A single boat of a kind, on the course's river at race time 0.
function one(kind, { behind = false } = {}) {
  const course = raceRiver();
  const traffic = { river: course, k: 1, boats: [{ kind, behind, dir: behind ? 1 : -1, meet: 600, at: 0, warned: false, phase: 0, hit: [] }] };
  moveTraffic(traffic, 0);
  return { course, traffic, b: traffic.boats[0] };
}
const racer = (x, z, heading) => ({ boat: { ...createBoat({ x, z, heading }), speed: 3 }, remote: false });

test("a kayak that hits a boat, or a sculler's oars, is in; one that keeps clear isn't", () => {
  const { traffic, b } = one('sculler');
  const f = [Math.sin(b.heading), -Math.cos(b.heading)];
  const right = [-f[1], f[0]];
  const at = (out) => racer(b.x + right[0] * out, b.z + right[1] * out, b.heading + Math.PI);
  assert.equal(trafficHits(traffic, [at(0)]).length, 1, 'into the hull');
  assert.equal(trafficHits(traffic, [at(2.5)]).length, 1, 'into the oars');
  assert.equal(trafficHits(traffic, [at(3.6)]).length, 0, 'past the oar tips');
  const swimming = at(0);
  swimming.boat.swim = 2;
  assert.equal(trafficHits(traffic, [swimming]).length, 0, 'already in');
});

test("a motorboat's wash rocks you behind it, not in front", () => {
  const { traffic, b } = one('motorboat');
  const f = [Math.sin(b.heading), -Math.cos(b.heading)];
  const right = [-f[1], f[0]];
  // On the arm of its wake: about 20 degrees out from its stern, 9 m back.
  const back = (d, out) => trafficWash(traffic, { x: b.x - f[0] * (3 + d) + right[0] * out, z: b.z - f[1] * (3 + d) + right[1] * out });
  assert.ok(back(9, 1.2 + (9 + 6) * 0.36) > 0.4);
  assert.ok(back(9, 0) < 0.1, 'calm in the middle of the V');
  assert.equal(trafficWash(traffic, { x: b.x + f[0] * 12, z: b.z + f[1] * 12 }), 0);
});

test('an eight coming up behind is called once, in time, with the side it is coming up on', () => {
  const { course, traffic, b } = one('eight', { behind: true });
  // You, paddling the same way at a racing pace, a little left of its line.
  const calls = [];
  let bowReached = null;
  for (let t = -40; t < 40; t += 0.1) {
    moveTraffic(traffic, t);
    const s = 600 + 3.6 * t + 40;
    const c = pointAt(course, s);
    const lateral = b.lateral - 2;
    const me = racer(c.x - c.tz * lateral, c.z + c.tx * lateral, Math.atan2(c.tx, -c.tz));
    for (const w of trafficWarnings(traffic, me)) calls.push({ t, ...w });
    if (bowReached === null && b.s + TRAFFIC.eight.length / 2 > s - 1.9) bowReached = t;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].side, 'right');
  assert.ok(bowReached - calls[0].t > 6, `called ${(bowReached - calls[0].t).toFixed(1)} s before it reaches you`);
});

test('in whole races the rivals keep right of oncoming boats and let eights by: a boat rarely tips one in', async () => {
  const { createRace, stepRace, DIVISION_9 } = await import('../reading-thames/race.js');
  const DT = 1 / 120;
  let races = 0;
  let hits = 0;
  let boats = 0;
  // (Hasler 7-9 goes round the clubs' stretch, where most boats met are eights.)
  for (const [course, format] of [[raceRiver(), 'mass'], [await fromFile('reading'), 'mass'], [await fromFile('hasler79'), 'mass']]) {
    for (const seed of [2, 3, 5, 6]) {
      const race = createRace(course, { rivals: DIVISION_9, seed, format });
      // Straight off (this is about the river, not the start), at the course's speed.
      race.start.phase = 'go';
      for (const r of race.racers) r.boat.speedup = course.speedup ?? 1;
      while (race.time < 900 && race.racers.some((r) => r.ai && r.finish === null)) stepRace(race, DT, { strokes: [], lean: 0 });
      races++;
      boats += race.traffic.boats.length;
      hits += race.traffic.boats.reduce((n, b) => n + b.hit.filter((r) => r.ai).length, 0);
      assert.ok(race.racers.every((r) => !r.ai || r.finish !== null), 'everyone finished');
    }
  }
  assert.ok(boats >= 10, `${boats} boats met`);
  // The river got busier (2026-10-31: a boat every 120 s, not 150, and kayakers):
  // over 16 seeded races per river that tipped in no more rivals on the real
  // courses (9 against 12 on main) and a few more on this narrow made-up river
  // (12 against 8, nearly all eights), so the limit grew with the traffic.
  assert.ok(hits / races < 0.625, `${hits} rivals hit in ${races} races`);
});

test("a race's traffic is exactly as it was before outings could ask for a mix or packs (a change to it must be on purpose)", async () => {
  // Fingerprints of the boats' timetables, taken before packs came in: any extra random draw on a race's path changes them.
  const { createHash } = await import('node:crypto');
  const { readFile } = await import('node:fs/promises');
  const fp = (boats) => createHash('sha1').update(boats.map((b) => [b.kind, b.at.toFixed(2), b.s.toFixed(1), b.dir].join(':')).join('|')).digest('hex').slice(0, 16);
  assert.equal(fp(createTraffic(raceRiver(), 5).boats), 'b19213d67b7f2f3f');
  // And an outing's on a river without stretches (the cruise along its route, the hired boat's river), as on main.
  const river = raceRiver();
  const cruise = { at: (t) => pointAt(river, Math.min(river.length, 100 + 2.2 * t)), seconds: (river.length - 100) / 2.2 };
  assert.equal(fp(createTraffic(river, 5, { gap: 35, route: cruise }).boats), '5ed4a9a4fcfa5107');
  assert.equal(fp(createTraffic(river, 5, { gap: 4, ambient: 7200, mix: { sculler: 0.45, kayaker: 0.3, pack: 0.35, eight: 0.3, cruiser: 0.15, motorboat: 0.2 } }).boats), '2cd55d83db1b85f8');
  const loop = courseFromFile(JSON.parse(await readFile(new URL('../reading-thames/courses/loop.json', import.meta.url), 'utf8')));
  // The Loop's changed on purpose (2026-11-17): the real river's traffic now fits each stretch (the test above).
  assert.equal(fp(createTraffic(loop, 3).boats), 'b3b92f4e9ae971f5');
});

test('the traffic fits each stretch, as the footage shows: rowing by the clubs, motor boats and narrowboats up the open reaches, little by the islands; a race meets as many boats as before', async () => {
  const reading = await fromFile('reading');
  const stretches = reading.scenery.traffic;
  assert.equal(stretches.length, 5);
  const named = (where) => stretches.findIndex((p) => p.where.startsWith(where));
  // Every boat met, by stretch, over many races: where they're met, and what.
  const met = stretches.map(() => ({ n: 0, kinds: {} }));
  const once = stretches.map(() => 0); // on the course straight up the river, met once along it
  let races = 0;
  let boats = 0;
  for (const course of [reading, await fromFile('loop'), await fromFile('hasler79')]) {
    for (let seed = 0; seed < 300; seed++) {
      const traffic = createTraffic(course, seed);
      races++;
      for (const b of traffic.boats) {
        const i = stretches.findIndex((p) => b.meet < p.to);
        const m = met[i < 0 ? stretches.length - 1 : i];
        m.n++;
        m.kinds[b.kind] = (m.kinds[b.kind] ?? 0) + 1;
        if (course === reading) once[met.indexOf(m)]++;
        boats++;
      }
    }
  }
  const share = (i, kind) => (met[i].kinds[kind] ?? 0) / met[i].n;
  const clubs = named('the clubs');
  const islands = named('Appletree');
  const purley = named("Purley's");
  const open = named('the open reach');
  // Each stretch's kinds as its mix says (within sampling), and none it doesn't name.
  for (const [i, p] of stretches.entries()) {
    const total = Object.values(p.mix).reduce((a, w) => a + w, 0);
    for (const kind of Object.keys(TRAFFIC)) {
      const want = (p.mix[kind] ?? 0) / total;
      if (!want) assert.equal(met[i].kinds[kind] ?? 0, 0, `no ${kind} on ${p.where}`);
      else if (met[i].n > 150) assert.ok(Math.abs(share(i, kind) - want) < 0.08, `${p.where}: ${kind} ${share(i, kind).toFixed(2)} against ${want.toFixed(2)}`);
    }
  }
  assert.ok(share(clubs, 'eight') > 2 * share(open, 'eight'), 'eights by the clubs');
  assert.ok(share(purley, 'narrowboat') > 0.1 && !met[clubs].kinds.narrowboat, 'narrowboats up the open reach to Mapledurham, not by the clubs');
  // How often: boats a kilometre of river, by the islands against Purley's reach
  // (on the course that goes once up the whole river; the routes go round the lower islands more).
  const perKm = (i) => once[i] / ((stretches[i].to - (stretches[i - 1]?.to ?? 0)) / 1000);
  assert.ok(perKm(islands) < perKm(purley) / 4, `${perKm(islands).toFixed(0)} against ${perKm(purley).toFixed(0)} a km`);
  // And as many boats a race as with no stretches, course by course (the owner's
  // 120 s average, 2026-10-31); Hasler 1-6 is the one through Purley's reach.
  for (const id of ['reading', 'loop', 'hasler79', 'hasler16']) {
    const course = await fromFile(id);
    const plain = { ...course, scenery: { ...course.scenery, traffic: undefined } };
    let now = 0;
    let before = 0;
    for (let seed = 0; seed < 400; seed++) {
      now += createTraffic(course, seed).boats.length;
      before += createTraffic(plain, seed).boats.length;
    }
    assert.ok(Math.abs(now / before - 1) < 0.08, `${id}: ${(now / 400).toFixed(2)} boats a race, ${(before / 400).toFixed(2)} before`);
  }
});

test("the course file's stretches are sound: in order to the river's end, and only kinds there are boats for", async () => {
  for (const id of ['reading', 'loop', 'hasler79', 'hasler16', 'practice']) {
    const course = await fromFile(id);
    const stretches = course.scenery.traffic;
    assert.ok(stretches.length > 0, `${id} has stretches`);
    stretches.forEach((p, i) => {
      assert.ok(i === 0 || p.to > stretches[i - 1].to, `${id}: "${p.where}" after the one before`);
      assert.ok(p.busy > 0, `${id}: "${p.where}" has some traffic`);
      assert.ok(Object.keys(p.mix).length > 0, `${id}: "${p.where}" has a mix`);
      for (const kind of Object.keys(p.mix)) assert.ok(TRAFFIC[kind], `${id}: "${p.where}": a ${kind}?`);
    });
    assert.ok(stretches.at(-1).to >= course.scenery.river.length, `${id}: the stretches reach the river's end`);
  }
});

test("the hired boat's river leans on each stretch: more rowers and kayakers, packs among them, as busy as before", async () => {
  const { HIRE_MIX } = await import('../reading-thames/outing.js');
  const course = await fromFile('reading');
  const plain = { ...course, scenery: { ...course.scenery, traffic: undefined } };
  const share = (boats, kinds) => boats.filter((b) => kinds.includes(b.kind)).length / boats.length;
  let packs = 0;
  let meetings = 0;
  let before = 0;
  for (let seed = 0; seed < 40; seed++) {
    const hire = createTraffic(course, seed, { gap: 4, ambient: 7200, mix: HIRE_MIX }).boats;
    const race = createTraffic(course, seed, { gap: 4, ambient: 7200 }).boats;
    assert.ok(share(hire, ['sculler', 'kayaker', 'eight']) > share(race, ['sculler', 'kayaker', 'eight']), 'more rowers and kayakers');
    packs += hire.filter((b) => b.pack?.lead === b).length;
    // Meetings (a pack is one): as many as without stretches.
    meetings += hire.filter((b) => !b.pack || b.pack.lead === b).length;
    before += createTraffic(plain, seed, { gap: 4, ambient: 7200, mix: HIRE_MIX }).boats.filter((b) => !b.pack || b.pack.lead === b).length;
  }
  // Fewer packs than before stretches (the footage shows few kayakers: 7-35% of a stretch's boats), but some.
  assert.ok(packs / 40 > 3, `${(packs / 40).toFixed(1)} packs an outing`);
  assert.ok(Math.abs(meetings / before - 1) < 0.08, `${meetings} meetings against ${before}`);
});

test('a narrowboat under way keeps out of line with the moored ones: off its bank by a moored beam and more, wherever the river has room', async () => {
  const course = await fromFile('hasler16');
  let seen = 0;
  for (let seed = 0; seed < 120; seed++) {
    const traffic = createTraffic(course, seed);
    if (!traffic.boats.some((b) => b.kind === 'narrowboat')) continue;
    for (let t = 0; t < 1500; t += 3) {
      moveTraffic(traffic, t);
      for (const b of traffic.boats.filter((x) => x.on && x.kind === 'narrowboat')) {
        const w = widthAt(traffic.river, b.s);
        const open = b.dir > 0 ? w.right : w.left;
        if (open < 12) continue;
        seen++;
        // Its side from the bank, against a moored narrowboat's beam (2.1 m) and 2 m of water.
        const gap = open - Math.abs(b.lateral) - TRAFFIC.narrowboat.hull;
        assert.ok(gap > 2.1 + 2, `${gap.toFixed(1)} m off its bank at ${b.s.toFixed(0)} m (half width ${open.toFixed(1)})`);
      }
    }
  }
  assert.ok(seen > 50, `${seen} narrowboat positions`);
});

test("motorboats and cruisers on the river wander a little and drift: the bow swings past where they're going; a sculler keeps its line", () => {
  const course = raceRiver();
  const seen = Object.fromEntries(['motorboat', 'cruiser', 'sculler'].map((kind) => [kind, { swing: 0, bow: 0, drift: 0, n: 0 }]));
  for (let seed = 0; seed < 60; seed++) {
    const traffic = createTraffic(course, seed);
    const last = new Map();
    for (let t = 0; t < 600; t += 0.25) {
      moveTraffic(traffic, t);
      for (const b of traffic.boats) {
        const k = seen[b.kind];
        if (!k || !b.on) { last.delete(b); continue; }
        const was = last.get(b);
        last.set(b, { x: b.x, z: b.z, lat: b.lateral * b.dir });
        if (!was) continue;
        // Against the river's own line there, and against the way the boat actually moved.
        const c = pointAt(traffic.river, b.s);
        const along = Math.atan2(c.tx * b.dir, -c.tz * b.dir);
        const track = Math.atan2(b.x - was.x, -(b.z - was.z));
        const off = (a, h) => Math.atan2(Math.sin(h - a), Math.cos(h - a));
        const bow = off(along, b.heading);
        k.swing = Math.max(k.swing, Math.abs(b.lateral * b.dir - was.lat) / 0.25);
        k.bow = Math.max(k.bow, Math.abs(bow));
        // Drifting: the bow turned further than the track, the same way.
        const tr = off(along, track);
        if (Math.abs(tr) > 0.02) { k.drift += Math.sign(bow) === Math.sign(tr) && Math.abs(bow) > Math.abs(tr) ? 1 : 0; k.n++; }
      }
    }
  }
  const deg = (r) => (r * 180) / Math.PI;
  for (const kind of ['motorboat', 'cruiser']) {
    const m = seen[kind];
    assert.ok(m.swing > 0.1, `a ${kind} moves across: ${m.swing} m/s`);
    assert.ok(deg(m.bow) > 2 && deg(m.bow) < 10, `its bow off the river's line by up to ${deg(m.bow).toFixed(1)} degrees`);
    assert.ok(m.n > 50 && m.drift / m.n > 0.8, `${kind}: the bow ahead of the track ${m.drift} of ${m.n}`);
  }
  // The big, slow cruiser drifts more gently than a motorboat.
  assert.ok(seen.cruiser.bow < seen.motorboat.bow, `cruiser ${deg(seen.cruiser.bow).toFixed(1)}, motorboat ${deg(seen.motorboat.bow).toFixed(1)} degrees`);
  assert.ok(deg(seen.sculler.bow) < 0.01, 'a sculler keeps its line');
});

// Under Caversham Bridge (#981): the river line's width runs on over Piper's
// Island, so boats on their lane went through its pier, and with the arches
// curving down to their piers (#980) the tallest could touch an arch near one.
// Every kind, both ways, at ten points of its drift, and a pack of kayakers of
// each shape, all the way through: every part of each boat under the deck (its
// hull, its oars or paddle out to their reach) is under an arch, and the arch
// is over its top; no boat moves sideways faster than it could steer (a step
// in the room under the bridge moved boats up to 12 m in a frame); and a pack's
// boats stay apart.
test("every boat under Caversham Bridge goes through an arch with the arch over its top, never through a pier, coming over smoothly", async () => {
  const { buildWorld, bridgeFrame, bridgeArches, archUnder, BRIDGE } = await import('../reading-thames/world.js');
  const { scullerMesh, kayakerMesh, eightMesh, cruiserMesh, motorboatMesh } = await import('../reading-thames/meshes.js');
  const { narrowboatMesh } = await import('../reading-thames/outing.js');
  const { PACKS } = await import('../reading-thames/traffic.js');
  // Each kind's height is its model's.
  const top = (mesh) => { const v = mesh.build ? mesh.build().vertices : mesh.vertices; let h = 0; for (let i = 1; i < v.length; i += 9) h = Math.max(h, v[i]); return h; };
  const MODELS = { sculler: scullerMesh(), kayaker: kayakerMesh(), eight: eightMesh(), cruiser: cruiserMesh(), motorboat: motorboatMesh(), narrowboat: narrowboatMesh({ steerer: true }) };
  for (const [kind, mesh] of Object.entries(MODELS)) assert.ok(TRAFFIC[kind].height >= top(mesh) - 0.01, `${kind}: ${TRAFFIC[kind].height} m, its model ${top(mesh).toFixed(2)} m`);

  const course = courseFromFile(JSON.parse(await readFile(new URL('../reading-thames/courses/loop.json', import.meta.url), 'utf8')));
  buildWorld(course, 1, 'river');
  const river = course.scenery.river;
  const bridge = river.bridges.find((b) => b.name === 'Caversham Bridge');
  const { origin, right, fwd } = bridgeFrame(river, bridge);
  const { arches } = bridgeArches(river, bridge);
  const k = course.speedup ?? 1;
  const DT = 1 / 60;
  let checked = 0;
  // A boat's parts as points: its hull, and its oars (or paddle) out to their reach, with how high each is.
  const points = (b) => {
    const T = TRAFFIC[b.kind];
    const f = [Math.sin(b.heading), -Math.cos(b.heading)];
    const at = (a, c) => [b.x + f[0] * a - f[1] * c, b.z + f[1] * a + f[0] * c];
    const out = [];
    for (let a = -T.length / 2; a <= T.length / 2; a += 0.5) for (const c of [-T.hull, 0, T.hull]) out.push([...at(a, c), T.height]);
    if (T.oars) for (let a = T.oars[0] * T.length; a <= T.oars[1] * T.length; a += 0.5) for (const c of [-T.oars[2], T.oars[2]]) out.push([...at(a - T.length / 2, c), 0.5]);
    return out;
  };
  const check = (b, what) => {
    for (const [x, z, h] of points(b)) {
      const [dx, dz] = [x - origin[0], z - origin[2]];
      if (Math.abs(dx * fwd[0] + dz * fwd[1]) > BRIDGE.width / 2) continue;
      checked++;
      const along = dx * right[0] + dz * right[1];
      const arch = arches.find(([a0, b0]) => along > a0 - 1 && along < b0 + 1);
      assert.ok(arch, `${what} through a pier, ${along.toFixed(1)} m along the road`);
      const over = archUnder(arch[0] - 1, arch[1] + 1, along);
      assert.ok(over >= h, `${what}: ${h} m tall under the arch at ${over.toFixed(2)} m, ${along.toFixed(1)} m along the road`);
    }
  };
  // Sideways no faster than it could steer: a quarter of its speed (14 degrees off its
  // course). (Where the river line's width steps, boats jump on main too, along the
  // whole river: a matter of its own, so not checked here.)
  // (A pack's boats keep to their lead's lane: where its width steps.)
  const side = (b) => { const l = b.pack?.lead ?? b; const w = widthAt(river, l.s); return l.dir > 0 ? w.right : w.left; };
  const steady = (b, prev, what) => {
    if (prev === null || Math.abs(side(b) - prev.side) > 0.01) return;
    const step = Math.abs(b.lateral - prev.lateral);
    assert.ok(step <= TRAFFIC[b.kind].speed * k * DT * 0.25 + 0.01, `${what} moved ${step.toFixed(2)} m sideways in a frame at ${(b.s - bridge.s).toFixed(0)} m from the bridge`);
  };
  const boat = (kind, dir, phase) => ({ kind, behind: false, dir, meet: bridge.s, at: 0, x: 0, z: 0, heading: 0, s: bridge.s, lateral: 0, on: false, warned: false, phase, hit: [] });
  const through = (boats, T, what) => {
    const prev = boats.map(() => null);
    // Met at the bridge at t = 0, coming from 120 m off.
    for (let t = -120 / (T.speed * k); t <= 120 / (T.speed * k); t += DT) {
      moveTraffic({ river, boats, k }, t);
      boats.forEach((b, i) => {
        if (!b.on) return void (prev[i] = null);
        check(b, what(b));
        steady(b, prev[i], what(b));
        prev[i] = { lateral: b.lateral, side: side(b) };
      });
      // A pack's boats alongside each other keep their slots' 1.8 m apart (clamped into the room, two were drawn one inside the other).
      for (let i = 0; i < boats.length; i++) for (let j = i + 1; j < boats.length; j++) {
        const [a, c] = [boats[i], boats[j]];
        if (a.on && c.on && Math.abs(a.s - c.s) < T.length) assert.ok(Math.abs(a.lateral - c.lateral) > 1.75, `${what(a)}: two of the pack ${Math.abs(a.lateral - c.lateral).toFixed(2)} m apart at ${(a.s - bridge.s).toFixed(0)} m from the bridge`);
      }
    }
  };
  for (const [kind, T] of Object.entries(TRAFFIC)) {
    for (const dir of [-1, 1]) {
      for (let phase = 0; phase < 10; phase++) through([boat(kind, dir, phase)], T, () => `a ${kind} going ${dir > 0 ? 'up' : 'down'} (drift ${phase})`);
    }
  }
  for (const [shape, slots] of Object.entries(PACKS)) {
    for (const dir of [-1, 1]) {
      const lead = boat('kayaker', dir, 0);
      lead.pack = { lead, slot: slots[0] };
      const pack = [lead, ...slots.slice(1).map((slot) => ({ ...boat('kayaker', dir, 0), pack: { lead, slot } }))];
      through(pack, TRAFFIC.kayaker, (b) => `a ${shape} pack's kayaker (slot ${b.pack.slot}) going ${dir > 0 ? 'up' : 'down'}`);
    }
  }
  assert.ok(checked > 10000, `${checked} points under the deck`);
});

// The river line's width steps from one 2 m sample to the next (by 7 m where a
// moored boat or a bank's bend narrows it), and a boat's lane jumped sideways
// with it (#984). Every kind, both ways, along the whole river at two points of
// its drift, and a pack: it never moves sideways faster than it could steer, and
// stays on the water, ends and oars and all (it didn't, before: an eight's oars
// 12 m over a bank).
test("river traffic comes over smoothly where the river narrows or widens, all along the river", async () => {
  const course = courseFromFile(JSON.parse(await readFile(new URL('../reading-thames/courses/loop.json', import.meta.url), 'utf8')));
  createTraffic(course, 1); // (as a race does: the water map, and the room under Caversham Bridge)
  const river = course.scenery.river;
  const k = course.speedup ?? 1;
  const DT = 1 / 30;
  const { PACKS } = await import('../reading-thames/traffic.js');
  const boat = (kind, dir, phase, meet) => ({ kind, behind: true, dir, meet, at: 0, x: 0, z: 0, heading: 0, s: meet, lateral: 0, on: false, warned: false, phase, hit: [] });
  // Each kind on its own, and a diamond of kayakers.
  const runs = [];
  for (const [kind, T] of Object.entries(TRAFFIC)) for (const dir of [-1, 1]) for (const phase of [0, 5]) runs.push({ kind, dir, what: `a ${kind} going ${dir > 0 ? 'up' : 'down'} (drift ${phase})`, make: (meet) => [boat(kind, dir, phase, meet)] });
  for (const dir of [-1, 1]) runs.push({ kind: 'kayaker', dir, what: `a diamond of kayakers going ${dir > 0 ? 'up' : 'down'}`, make: (meet) => {
    const lead = boat('kayaker', dir, 0, meet);
    lead.pack = { lead, slot: PACKS.diamond[0] };
    return [lead, ...PACKS.diamond.slice(1).map((slot) => ({ ...boat('kayaker', dir, 0, meet), pack: { lead, slot } }))];
  } });
  for (const { kind, dir, what, make } of runs) {
    const T = TRAFFIC[kind];
    const reach = Math.max(T.hull, T.oars?.[2] ?? 0);
    // From one end of the river to the other: met at the far end at t = 0; one
    // "from behind" is on the water all the way there.
    const boats = make(dir > 0 ? river.length - T.length - 10 : T.length + 10);
    const prev = boats.map(() => null);
    let worst = { step: 0 };
    for (let t = -(river.length - 2 * T.length - 20) / (T.speed * k); t <= 0; t += DT) {
      moveTraffic({ river, boats, k }, t);
      boats.forEach((b, i) => {
        if (!b.on) return void (prev[i] = null);
        if (prev[i] !== null && Math.abs(b.lateral - prev[i]) > worst.step) worst = { step: Math.abs(b.lateral - prev[i]), s: b.s };
        prev[i] = b.lateral;
        // On the water, ends and all: its side (and oars) inside the river's width wherever it lies.
        for (const a of [-T.length / 2, 0, T.length / 2]) {
          const w = widthAt(river, b.s + a);
          const side = b.lateral >= 0 ? w.right : w.left;
          assert.ok(Math.abs(b.lateral) + reach <= side + 0.01, `${what}: ${(Math.abs(b.lateral) + reach - side).toFixed(2)} m over the bank at ${(b.s + a).toFixed(0)} m`);
        }
      });
    }
    assert.ok(worst.step <= T.speed * k * DT * 0.25 + 0.01, `${what} moved ${worst.step.toFixed(2)} m sideways in a frame at ${worst.s?.toFixed(0)} m`);
  }
});
