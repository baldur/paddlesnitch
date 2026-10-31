// Outings from Caversham Pier (outing.js): the river cruise and the hired launch,
// on the real river with its swans and boats, as a race with no rivals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { courseFromFile, locate } from '../kayak/course.js';
import { waterMap } from '../kayak/water.js';
import { createRace } from '../kayak/race.js';
import { OUTINGS, CRUISE, HIRE, BUSY, startOuting, stepOuting, tripBoatMesh, launchMesh } from '../kayak/outing.js';

const data = async (id) => JSON.parse(await readFile(new URL(`../kayak/courses/${id}.json`, import.meta.url), 'utf8'));
const DT = 1 / 60;

async function outing(kind) {
  const course = courseFromFile(await data('hasler16'));
  const race = createRace(course, { rivals: [], seed: 4 });
  const pier = course.scenery.bridges.find((b) => b.name === 'Caversham Bridge').s + 30;
  startOuting(race, kind, pier);
  return { race, pier, land: waterMap((await data('reading')).water) };
}

test('both outings start at Caversham Pier, on the water, on the right of the river going up', async () => {
  for (const kind of Object.keys(OUTINGS)) {
    const { race, pier, land } = await outing(kind);
    const b = race.player.boat;
    assert.ok(land.inside(b.x, b.z), `${kind}: afloat`);
    const at = locate(race.course.scenery.river, b.x, b.z);
    assert.ok(Math.abs(at.s - pier) < 3, `${kind}: at the pier`);
    assert.ok(at.lateral > 0, `${kind}: on the right going upstream`);
  }
});

test('the cruise goes up the river at 8 km/h, keeps to the water, and ends at Mapledurham', async () => {
  const { race, pier, land } = await outing('cruise');
  const river = race.course.scenery.river;
  const k = race.course.speedup;
  let events = [];
  for (let t = 0; t < 60; t += DT) events.push(...stepOuting(race, DT, {}));
  assert.ok(Math.abs(race.outing.s - (pier + CRUISE.speed * k * 60)) < 1, 'a minute at its speed');
  for (let t = 0; t < 900 && !events.includes('end'); t += DT) {
    events.push(...stepOuting(race, DT, {}));
    const b = race.player.boat;
    if (Math.round(t / DT) % 60 === 0) assert.ok(land.inside(b.x, b.z), `afloat ${race.outing.s.toFixed(0)} m up`);
  }
  assert.ok(events.includes('end'), 'reached the end');
  assert.ok(race.outing.s > river.length - 60);
  assert.equal(race.player.boat.swim, 0, 'nobody falls in');
});

test('on the cruise the arrows look about, and the view comes back when let go', async () => {
  const { race } = await outing('cruise');
  for (let t = 0; t < 2; t += DT) stepOuting(race, DT, { turn: -1 });
  assert.ok(Math.abs(race.outing.look + CRUISE.look) < 1e-6, 'looking left');
  for (let t = 0; t < 2; t += DT) stepOuting(race, DT, {});
  assert.ok(Math.abs(race.outing.look) < 1e-6, 'and ahead again');
});

test('the launch: the throttle sets the speed (up to 20 km/h), it steers only under way, and backs astern', async () => {
  const { race } = await outing('hire');
  race.course.shore = null; // open water: this is about the throttle and the wheel, not the banks
  const b = race.player.boat;
  const h0 = b.heading;
  for (let t = 0; t < 2; t += DT) stepOuting(race, DT, { turn: 1, throttle: 0 });
  assert.equal(b.heading, h0, "stopped, the wheel doesn't turn it");
  for (let t = 0; t < 10; t += DT) stepOuting(race, DT, { throttle: 1 });
  assert.ok(Math.abs(b.speed - HIRE.top) < 0.01, `full ahead: ${b.speed}`);
  for (let t = 0; t < 1; t += DT) stepOuting(race, DT, { throttle: 1, turn: 1 });
  assert.ok(b.heading > h0 + 0.2, 'turns right');
  for (let t = 0; t < 10; t += DT) stepOuting(race, DT, { throttle: -1 });
  assert.ok(Math.abs(b.speed + HIRE.astern) < 0.01, 'full astern');
});

test('driving the launch into the bank bumps it and keeps it on the water', async () => {
  const { race, land } = await outing('hire');
  const b = race.player.boat;
  b.heading += Math.PI / 2; // straight at the bank on the right
  let bumps = 0;
  for (let t = 0; t < 40; t += DT) {
    bumps += stepOuting(race, DT, { throttle: 1 }).filter((e) => e === 'bump').length;
    assert.ok(!race.course.shore.dry(b.x, b.z), 'never up on the bank');
  }
  assert.ok(bumps > 0);
  assert.ok(land.inside(b.x, b.z));
});

test('outings are busier than a race: the cruise meets a boat about every half minute, and the launch has boats all over the river', async () => {
  const { race } = await outing('cruise');
  const met = new Set();
  for (let t = 0; t < 300; t += DT) {
    stepOuting(race, DT, {});
    const me = race.player.boat;
    for (const b of race.traffic.boats) if (b.on && Math.hypot(b.x - me.x, b.z - me.z) < 40) met.add(b);
  }
  assert.ok(met.size >= 300 / BUSY.gap / 2, `${met.size} boats passed in 5 minutes`);
  const { race: hire } = await outing('hire');
  stepOuting(hire, DT, {});
  const on = hire.traffic.boats.filter((b) => b.on);
  assert.ok(on.length >= 10, `${on.length} boats on the river at the start`);
  assert.ok(new Set(on.map((b) => b.kind)).size >= 3, 'of different kinds');
  assert.ok(on.some((b) => b.kind === 'kayaker') || hire.traffic.boats.some((b) => b.kind === 'kayaker'), 'kayakers among them');
});

test("the boats you're on are small meshes with no NaN", () => {
  for (const mesh of [tripBoatMesh(), launchMesh()]) {
    assert.ok(mesh.vertices.every(Number.isFinite));
    assert.ok(mesh.count / 3 < 1500);
  }
});
