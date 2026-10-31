import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { courseFromFile, locate, pointAt, raceRiver } from '../reading-thames/course.js';
import { waterMap } from '../reading-thames/water.js';
import { createAnglers, snagLines, linesAhead, segmentGap, SNAG } from '../reading-thames/anglers.js';
import { createRace, stepRace, DIVISION_9 } from '../reading-thames/race.js';
import { buildWorld } from '../reading-thames/world.js';

const load = async (id) => courseFromFile(JSON.parse(await readFile(new URL(`../reading-thames/courses/${id}.json`, import.meta.url), 'utf8')));
const racer = (x, z, heading, speed = 4) => ({ boat: { x, z, heading, speed, swim: 0 } });

test('segments that cross are 0 apart; parallel ones their gap', () => {
  assert.equal(segmentGap({ x: -1, z: 0 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: 0, z: 1 }), 0);
  assert.equal(segmentGap({ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 0, z: 0.5 }, { x: 2, z: 0.5 }), 0.5);
});

test("anglers sit on the Promenade's bank at Reading with their lines out into the water", async () => {
  for (const id of ['reading', 'loop']) {
    const course = await load(id);
    const water = waterMap(course.scenery.water);
    const anglers = createAnglers(course);
    assert.equal(anglers.length, 3, id);
    for (const a of anglers) {
      assert.ok(!water.inside(a.seat.x, a.seat.z), `${id}: the seat is on land`);
      assert.ok(water.inside(a.float.x, a.float.z), `${id}: the float is in the water`);
      const reach = Math.hypot(a.float.x - a.bank.x, a.float.z - a.bank.z);
      assert.ok(reach > 6 && reach < 12, `${id}: the line runs ${reach.toFixed(1)} m out`);
    }
    // The same every time (live races and the drawn world must agree).
    assert.deepEqual(createAnglers(course).map((a) => a.float), anglers.map((a) => a.float));
  }
});

test('paddling across the low end of a line snags you once and pulls you up short; under the rod or outside the float does not', async () => {
  const course = await load('reading');
  const [a] = createAnglers(course);
  const p = pointAt(course.scenery.river, a.s);
  const heading = Math.atan2(p.tx, -p.tz); // along the river, so across the line
  const near = { x: (a.low.x + a.float.x) / 2, z: (a.low.z + a.float.z) / 2 };
  const caught = racer(near.x, near.z, heading);
  const under = racer((a.bank.x + a.tip.x) / 2, (a.bank.z + a.tip.z) / 2, heading); // under the rod, close in
  const clear = racer(a.float.x - a.out[0] * 3, a.float.z - a.out[1] * 3, heading);
  const hits = snagLines([a], [caught, under, clear]);
  assert.deepEqual(hits.map((h) => h.racer), [caught]);
  assert.equal(caught.boat.speed, 4 * SNAG.hold);
  assert.equal(under.boat.speed, 4);
  assert.equal(clear.boat.speed, 4);
  assert.equal(snagLines([a], [caught]).length, 0, 'once per line');
});

test('the AI sees a line as blocked water from the float in to the bank', async () => {
  const course = await load('reading');
  const [a] = createAnglers(course);
  const p = pointAt(course, a.s - 20);
  const r = { boat: { x: p.x, z: p.z }, loc: locate(course, p.x, p.z) };
  const [block] = linesAhead([a], r, course, 40);
  const f = locate(course, a.float.x, a.float.z);
  const b = locate(course, a.bank.x, a.bank.z);
  assert.ok(block.lateral - block.half <= Math.min(f.lateral, b.lateral) && block.lateral + block.half >= Math.max(f.lateral, b.lateral));
  assert.deepEqual(linesAhead([a], r, course, 5), [], 'not while far off');
});

test('rivals steer round lines that reach halfway across a narrow river', () => {
  // The made-up river is 20 m wide, so a 7 to 11 m line leaves only half of it.
  const course = raceRiver();
  course.scenery = { anglers: [{ s: 400, side: -1 }, { s: 700, side: 1 }, { s: 1000, side: -1 }, { s: 1300, side: 1 }] };
  // A time trial: the rivals go off one by one without waiting for the player.
  const race = createRace(course, { rivals: DIVISION_9, seed: 3, traffic: false, birds: false, format: 'interval' });
  const last = 1340;
  for (let t = 0; t < 900 * 120 && race.racers.some((r) => r.ai && r.loc.s < last); t++) {
    stepRace(race, 1 / 120, { strokes: [], rudder: 0, lean: 0 });
  }
  assert.ok(race.racers.filter((r) => r.ai).every((r) => r.loc.s >= last), 'the rivals got past');
  const snagged = race.anglers.flatMap((a) => [...a.snagged]).filter((r) => r.ai);
  assert.equal(snagged.length, 0);
});

test('the posts in the water off St Mary\'s Island are solid', async () => {
  for (const id of ['reading', 'loop']) {
    const course = await load(id);
    assert.equal(course.scenery.posts.length, 3);
    for (const [x, z] of course.scenery.posts) {
      assert.ok(course.shore.dry(x, z), `${id}: a post`);
      assert.ok(!course.shore.dry(x + 2, z + 2), `${id}: open water beside it`);
    }
  }
});

test('the landmarks pointed out from the footage get their own models', async () => {
  const course = await load('loop');
  const styles = [...new Set(course.scenery.buildings.map((b) => b.style).filter(Boolean))].sort();
  assert.deepEqual(styles, ['canoe-club', 'clapboard', 'glass-house', 'grey-boathouse', 'island-bar', 'riverside-villa', 'rowing-club', 'spiral-boathouse', 'stilts', 'tudor-boathouse', 'victorian']);
  assert.ok(course.scenery.moorings.some((m) => m.kind === 'tatty'));
  const { vertices, count } = buildWorld(course);
  assert.ok(count > 0);
  assert.ok(vertices.every((v) => Number.isFinite(v)), 'no NaN in the scenery');
});
