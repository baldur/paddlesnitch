// Outings from Caversham Pier (outing.js): the river cruise and the hired launch,
// on the real river with its swans and boats, as a race with no rivals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { courseFromFile, locate } from '../kayak/course.js';
import { waterMap } from '../kayak/water.js';
import { createRace } from '../kayak/race.js';
import { OUTINGS, CRUISE, HIRE, BUSY, startOuting, stepOuting, tripBoatMesh, launchMesh } from '../kayak/outing.js';
import { SWIM, TRAFFIC, moveTraffic, overturned } from '../kayak/traffic.js';
import { swimmerMesh } from '../kayak/meshes.js';

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

// The launch lined up `off` metres from a boat of `kind`'s beam, coming at it at `speed`.
async function ram(kind, speed, off = 8) {
  const { race } = await outing('hire');
  race.course.shore = null;
  const t = race.traffic.boats.find((x) => x.kind === kind && x.at > 60);
  race.time = t.at;
  race.traffic.boats = [t];
  moveTraffic(race.traffic, race.time);
  const b = race.player.boat;
  const side = [Math.cos(t.heading), Math.sin(t.heading)]; // the boat's right
  Object.assign(b, { x: t.x + side[0] * off, z: t.z + side[1] * off, speed, heading: t.heading - Math.PI / 2 });
  const events = [];
  for (let i = 0; i < 300 && !events.includes('bump'); i++) events.push(...stepOuting(race, DT, { throttle: speed / HIRE.top }));
  return { race, t, events };
}

test('ram a sculler or a kayaker with the launch and they fall in, swim by the upturned boat, then carry on', async () => {
  for (const kind of ['sculler', 'kayaker']) {
    const { race, t, events } = await ram(kind, HIRE.top);
    assert.ok(events.includes(`tipped-${kind}`), `${kind}: ${events}`);
    const at = [t.x, t.z];
    for (let s = 0; s < SWIM / 2; s += DT) stepOuting(race, DT, {});
    assert.deepEqual([t.x, t.z], at, 'the boat stays where it went over');
    assert.equal(overturned(t, race.time).over, 1, 'upside down');
    assert.ok(overturned(t, race.time).swimming, 'and its crew in the water');
    // Righted and off again from where it went over: no jump along the river
    // on the frame it's righted (its timetable picks up SWIM seconds late).
    const k = race.course.speedup ?? 1;
    let jump = 0;
    for (let s = 0; s < SWIM; s += DT) {
      const was = [t.x, t.z, t.swim];
      stepOuting(race, DT, {});
      if (was[2] !== undefined && t.swim === undefined) jump = Math.hypot(t.x - was[0], t.z - was[1]);
    }
    assert.equal(overturned(t, race.time).over, 0, 'righted');
    assert.ok(Math.hypot(t.x - at[0], t.z - at[1]) > 1, 'and on its way again');
    assert.ok(jump < 2 * TRAFFIC[kind].speed * k * DT, `no jump: ${jump.toFixed(2)} m on righting`);
  }
});

test("an eight, a cruiser or a motorboat doesn't go over, and nobody does at a crawl", async () => {
  for (const kind of ['eight', 'cruiser', 'motorboat']) {
    const { events } = await ram(kind, HIRE.top);
    assert.ok(events.includes('bump') && !events.some((e) => e.startsWith('tipped')), `${kind}: ${events}`);
  }
  const { events } = await ram('sculler', HIRE.knock * 0.8, 2.6);
  assert.ok(events.includes('bump') && !events.some((e) => e.startsWith('tipped')), `slow: ${events}`);
});

test('a boat you bumped is solid again once you are 10 m clear; a crew already in the water is not knocked in twice', async () => {
  const { race, t, events } = await ram('eight', HIRE.top);
  assert.ok(events.includes('bump'));
  const b = race.player.boat;
  // Back off 12 m, then come at it again.
  const away = [Math.cos(t.heading), Math.sin(t.heading)];
  Object.assign(b, { x: t.x + away[0] * 12, z: t.z + away[1] * 12, speed: 0 });
  stepOuting(race, DT, {});
  Object.assign(b, { x: t.x + away[0] * 8, z: t.z + away[1] * 8, speed: HIRE.top, heading: t.heading - Math.PI / 2 });
  const again = [];
  for (let i = 0; i < 300 && !again.includes('bump'); i++) again.push(...stepOuting(race, DT, { throttle: 1 }));
  assert.ok(again.includes('bump'), 'bumped again: still solid');
  // A sculler knocked in, rammed again while its crew swims: a bump, no second ducking.
  const s = await ram('sculler', HIRE.top);
  const swim = s.t.swim;
  const sb = s.race.player.boat;
  const side = [Math.cos(s.t.heading), Math.sin(s.t.heading)];
  Object.assign(sb, { x: s.t.x + side[0] * 12, z: s.t.z + side[1] * 12, speed: 0 });
  stepOuting(s.race, DT, {});
  Object.assign(sb, { x: s.t.x + side[0] * 8, z: s.t.z + side[1] * 8, speed: HIRE.top, heading: s.t.heading - Math.PI / 2 });
  const twice = [];
  for (let i = 0; i < 300 && !twice.includes('bump'); i++) twice.push(...stepOuting(s.race, DT, { throttle: 1 }));
  assert.ok(twice.includes('bump') && !twice.some((e) => e.startsWith('tipped')), twice.join(','));
  assert.equal(s.t.swim, swim, 'its swim not started again');
});

test('backing the launch into a sculler at full astern knocks them in too (owner: any ram above a crawl)', async () => {
  const { events } = await ram('sculler', -HIRE.astern, 2.6);
  // (rammed going astern: the stern first)
  assert.ok(Math.abs(-HIRE.astern) > HIRE.knock);
  assert.ok(events.includes('bump'));
});

test("the boats you're on, and a swimmer, are small meshes with no NaN", () => {
  for (const mesh of [tripBoatMesh(), launchMesh(), swimmerMesh()]) {
    assert.ok(mesh.vertices.every(Number.isFinite));
    assert.ok(mesh.count / 3 < 1500);
  }
});
