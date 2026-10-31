import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { raceRiver, practiceRiver, courseFromFile, pointAt, widthAt, locate } from '../kayak/course.js';
import { TRAFFIC, createTraffic, moveTraffic, trafficHits, trafficWash, trafficWarnings } from '../kayak/traffic.js';
import { createBoat } from '../kayak/sim.js';

const fromFile = async (name) => courseFromFile(JSON.parse(await readFile(new URL(`../kayak/courses/${name}.json`, import.meta.url), 'utf8')));
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
  assert.deepEqual([...kinds].sort(), Object.keys(TRAFFIC).sort());
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
  const { createRace, stepRace, DIVISION_9 } = await import('../kayak/race.js');
  const DT = 1 / 120;
  let races = 0;
  let hits = 0;
  let boats = 0;
  for (const [course, format] of [[raceRiver(), 'mass'], [await fromFile('reading'), 'mass']]) {
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
