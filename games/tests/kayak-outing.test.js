// Outings from Caversham Pier (outing.js): the river cruise and the hired launch,
// on the real river with its swans and boats, as a race with no rivals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { courseFromFile, locate } from '../reading-thames/course.js';
import { waterMap } from '../reading-thames/water.js';
import { createRace } from '../reading-thames/race.js';
import { OUTINGS, CRUISE, HIRE, HIRE_BOATS, HIRE_MIX, SINK, BUSY, startOuting, stepOuting, tripBoatMesh, launchMesh, speedboatMesh, narrowboatMesh } from '../reading-thames/outing.js';
import { SWIM, TRAFFIC, PACKS, createTraffic, moveTraffic, overturned } from '../reading-thames/traffic.js';
import { swimmerMesh } from '../reading-thames/meshes.js';

const data = async (id) => JSON.parse(await readFile(new URL(`../reading-thames/courses/${id}.json`, import.meta.url), 'utf8'));
const DT = 1 / 60;

async function outing(kind, boat = 'launch') {
  const course = courseFromFile(await data('hasler16'));
  const race = createRace(course, { rivals: [], seed: 4 });
  const pier = course.scenery.bridges.find((b) => b.name === 'Caversham Bridge').s + 30;
  startOuting(race, kind, pier, 1, { boat });
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
  // A boat on its own of that kind, or a pack of kayakers (rammed at its lead, the whole pack kept).
  const t = race.traffic.boats.find((x) => x.at > 60 && (kind === 'pack' ? x.pack?.lead === x : x.kind === kind && !x.pack));
  race.time = t.at;
  race.traffic.boats = kind === 'pack' ? race.traffic.boats.filter((x) => x.pack?.lead === t) : [t];
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

test("a cruiser or a motorboat doesn't go over, and nobody does at a crawl", async () => {
  for (const kind of ['cruiser', 'motorboat']) {
    const { events } = await ram(kind, HIRE.top);
    assert.ok(events.includes('bump') && !events.some((e) => e.startsWith('tipped')), `${kind}: ${events}`);
  }
  const { events } = await ram('sculler', HIRE.knock * 0.8, 2.6);
  assert.ok(events.includes('bump') && !events.some((e) => e.startsWith('tipped')), `slow: ${events}`);
});

test('a boat you bumped is solid again once you are 10 m clear; a crew already in the water is not knocked in twice', async () => {
  const { race, t, events } = await ram('cruiser', HIRE.top); // (an eight now sinks you: see below)
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
  for (const mesh of [tripBoatMesh(), launchMesh(), speedboatMesh(), narrowboatMesh(), swimmerMesh()]) {
    assert.ok(mesh.vertices.every(Number.isFinite));
    assert.ok(mesh.count / 3 < 1500);
  }
});

test('three boats for hire: the speedboat very quick and nimble, the launch steady, the narrowboat slow and slow to turn', async () => {
  const drive = async (boat) => {
    const { race } = await outing('hire', boat);
    race.course.shore = null;
    const b = race.player.boat;
    for (let t = 0; t < 30; t += DT) stepOuting(race, DT, { throttle: 1 });
    const top = b.speed;
    const h0 = b.heading;
    for (let t = 0; t < 2; t += DT) stepOuting(race, DT, { throttle: 1, turn: 1 });
    return { top, turned: b.heading - h0, shape: b.shape };
  };
  const [fast, steady, slow] = await Promise.all(['speedboat', 'launch', 'narrowboat'].map(drive));
  assert.ok(Math.abs(fast.top - HIRE_BOATS.speedboat.top) < 0.1, `speedboat ${fast.top * 3.6} km/h`);
  assert.ok(fast.top * 3.6 > 45 && steady.top * 3.6 < 21 && slow.top * 3.6 < 8);
  assert.ok(fast.turned > steady.turned && steady.turned > slow.turned, 'nimble, steady, slow to turn');
  assert.equal(slow.shape.bow + slow.shape.stern, 18, 'the narrowboat is 18 m long, for knocks and banks');
});

test('ram an eight or a pack of kayakers and the boat sinks under you, then it\'s back to the pier', async () => {
  for (const kind of ['eight', 'pack']) {
    const { race, events } = await ram(kind, HIRE.top);
    assert.ok(events.includes(kind === 'pack' ? 'sinking-pack' : 'sinking-eight'), `${kind}: ${events}`);
    assert.ok(!events.some((e) => e.startsWith('tipped')), 'they hold; you go down');
    const after = [];
    for (let t = 0; t < SINK + 0.5; t += DT) after.push(...stepOuting(race, DT, { throttle: 1 }));
    assert.ok(after.includes('sunk'), `${kind}: sunk after ${SINK} s`);
    assert.ok(race.player.boat.speed < 0.5, 'and stopped');
  }
});

test('kayakers out together hold a triangle of three or a diamond of four, the lead first and the rest in their slots behind', async () => {
  const course = courseFromFile(await data('hasler16'));
  const traffic = createTraffic(course, 9, { gap: 5, ambient: 4000, mix: HIRE_MIX });
  const leads = traffic.boats.filter((b) => b.pack?.lead === b);
  assert.ok(leads.length > 5, `${leads.length} packs`);
  const sizes = new Set(leads.map((l) => traffic.boats.filter((b) => b.pack?.lead === l).length));
  assert.deepEqual([...sizes].sort(), [3, 4], 'triangles and diamonds');
  // On the water: each in its slot, as far from the lead as its slot says, all heading the same way.
  const lead = leads.find((l) => l.at > 100);
  moveTraffic(traffic, lead.at);
  for (const b of traffic.boats.filter((x) => x.pack?.lead === lead && x !== lead)) {
    const [back, right] = b.pack.slot;
    const d = Math.hypot(b.x - lead.x, b.z - lead.z);
    assert.ok(Math.abs(d - Math.hypot(back, right)) < 0.6, `${d.toFixed(2)} m from the lead, slot ${b.pack.slot}`);
    assert.ok(Math.abs(b.heading - lead.heading) < 0.1);
    assert.equal(b.kind, 'kayaker');
  }
  assert.deepEqual(PACKS.diamond.length, 4);
});

test("the hired boat's river has more rowers and kayakers than a race's, packs among them; a race has no packs", async () => {
  const course = courseFromFile(await data('hasler16'));
  const share = (boats) => boats.filter((b) => b.kind === 'sculler' || b.kind === 'kayaker' || b.kind === 'eight').length / boats.length;
  const hire = createTraffic(course, 3, { gap: 4, ambient: 7200, mix: HIRE_MIX }).boats;
  const plain = createTraffic(course, 3, { gap: 4, ambient: 7200 }).boats;
  assert.ok(share(hire) > share(plain) + 0.1, `${share(hire).toFixed(2)} against ${share(plain).toFixed(2)}`);
  for (const seed of [1, 2, 3]) assert.ok(!createTraffic(course, seed).boats.some((b) => b.pack), 'no packs in a race');
});
