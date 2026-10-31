// The single scull (scull.js): two oars, one per side; strokes of both, steering
// by timing, a gentler balance than the kayak's, crabs, and racing it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoat } from '../kayak/sim.js';
import { SCULL, SCULL_COLOURS, stepScull, scullRate, scullPose, split, cleanRow } from '../kayak/scull.js';
import { readFile } from 'node:fs/promises';
import { createRace, stepRace, started, DIVISION_9 } from '../kayak/race.js';
import { practiceRiver, headingAt, pointAt, locate, courseFromFile } from '../kayak/course.js';
import { wrap } from '../kayak/sim.js';

const DT = 1 / 120;
// Row for `secs` at `rate` strokes a minute: both oars (the right `late`
// seconds after the left), or one, or the two in turn.
function row(rate, { secs = 60, late = 0, first = 'left', only = null, alternate = false, lean = 0, rock = 0, boat = createBoat({ hull: SCULL }) } = {}) {
  const second = first === 'left' ? 'right' : 'left';
  const events = [];
  let next = 0;
  let secondAt = null;
  let n = 0;
  for (let t = 0; t < secs; t += DT) {
    const strokes = [];
    if (t >= next) {
      next += 60 / rate;
      if (only) strokes.push(only);
      else if (alternate) strokes.push(n++ % 2 ? 'left' : 'right');
      else {
        strokes.push(first);
        secondAt = t + late;
      }
    }
    if (secondAt !== null && t >= secondAt) {
      strokes.push(second);
      secondAt = null;
    }
    events.push(...stepScull(boat, DT, { strokes, lean, rock }));
  }
  return { boat, events };
}
const kmh = (b) => b.speed * 3.6;

test('strokes of both oars: about 11 km/h at an easy 22, 13 at 30, 16 flat out at 38, dead straight', () => {
  const easy = row(22).boat;
  const firm = row(30).boat;
  const flat = row(38).boat;
  assert.ok(kmh(easy) > 10 && kmh(easy) < 11.5, `22: ${kmh(easy)}`);
  assert.ok(kmh(firm) > 12.5 && kmh(firm) < 14, `30: ${kmh(firm)}`);
  assert.ok(kmh(flat) > 15 && kmh(flat) < 17, `38: ${kmh(flat)}`);
  for (const b of [easy, firm, flat]) assert.ok(Math.abs(b.heading) < 0.01, 'straight');
  assert.equal(scullRate(firm), 30, 'the coach reads the rate');
  assert.ok(firm.stamina > 0.99, 'a steady 30 costs nothing');
  assert.ok(flat.stamina < 0.2, 'flat out it does');
});

test('steering by timing: the oar in first pulls the longer stroke and the bow comes round from it', () => {
  const leftFirst = row(30, { late: 0.08, secs: 20 }).boat;
  assert.ok(leftFirst.heading > 0.2, `left first turns the bow right: ${leftFirst.heading}`);
  assert.ok(kmh(leftFirst) > 12, 'still going well');
  const rightFirst = row(30, { late: 0.08, secs: 20, first: 'right' }).boat;
  assert.ok(rightFirst.heading < -0.2, `right first turns it left: ${rightFirst.heading}`);
  assert.ok(Math.abs(row(30, { secs: 20 }).boat.heading) < 0.01, 'together, straight on');
});

test('one oar alone spins the boat round without a crab, slowly; the other one turns it back', () => {
  const { boat, events } = row(30, { only: 'left', secs: 10 });
  assert.ok(boat.heading > 2, `round by ${boat.heading} rad`);
  assert.ok(!events.includes('crab'));
  assert.ok(kmh(boat) < 10);
  const back = row(30, { only: 'right', secs: 10, boat }).boat;
  assert.ok(back.heading < 1, 'and back');
});

test("alternating the oars is no quicker than both together, costs all your stamina, and doesn't hold a line", () => {
  const { boat } = row(60, { alternate: true });
  const both = row(30).boat;
  assert.ok(kmh(boat) < kmh(both), `${kmh(boat)} against ${kmh(both)}`);
  assert.ok(boat.stamina < 0.1);
  assert.ok(boat.rhythm < both.rhythm);
});

test("an oar can't catch again until it's been round the recovery: 40 a minute at most", () => {
  const { boat, events } = row(80, { secs: 20 });
  assert.ok(events.includes('rush'));
  assert.ok(scullRate(boat) <= 41, `${scullRate(boat)}`);
});

test('steady rowing never catches a crab on choppy water; knocked over far enough, an oar digs in and nearly stops you', () => {
  const steady = row(30, { secs: 120 });
  assert.ok(!steady.events.includes('crab'));
  assert.ok(Math.abs(steady.boat.roll) < SCULL.crabAt);
  const boat = row(30, { secs: 20 }).boat;
  const before = boat.speed;
  boat.roll = SCULL.crabAt + 0.02;
  const events = stepScull(boat, DT, { strokes: [] });
  assert.ok(events.includes('crab'));
  assert.ok(boat.speed < before * 0.5);
  // No rowing until it's sorted out, then on again.
  assert.deepEqual(stepScull(boat, DT, { strokes: ['left', 'right'] }).filter((e) => e === 'stroke'), []);
  const after = row(30, { secs: 10, boat });
  assert.ok(kmh(after.boat) > 10, 'going again');
});

test('rolled well over, leaning against it keeps the boat up; not leaning, an oar digs in', () => {
  const tipped = () => Object.assign(createBoat({ hull: SCULL }), { speed: 3, roll: SCULL.crabAt * 0.8, rollRate: 0.25 });
  const run = (lean) => {
    const boat = tipped();
    let crabs = 0;
    let peak = 0;
    for (let t = 0; t < 3; t += DT) {
      crabs += stepScull(boat, DT, { strokes: [], rock: 1, lean: lean(boat) }).filter((e) => e === 'crab').length;
      peak = Math.max(peak, Math.abs(boat.roll));
    }
    return { crabs, peak };
  };
  const loose = run(() => 0);
  const held = run((b) => Math.max(-1, Math.min(1, -(b.roll * 3 + b.rollRate))));
  assert.ok(loose.crabs > 0, 'not leaning: a crab');
  assert.equal(held.crabs, 0, 'leaning: none');
  assert.ok(held.peak < SCULL.crabAt);
});

test('a big enough knock (a swan) still tips you in, and you climb back in', () => {
  const boat = row(30, { secs: 10 }).boat;
  boat.roll = SCULL.capsize + 0.05;
  assert.ok(stepScull(boat, DT, { strokes: [] }).includes('capsize'));
  assert.equal(boat.capsizes, 1);
  const events = row(30, { secs: SCULL.swimTime + 2, boat }).events;
  assert.ok(events.includes('remount'));
});

test('how it looks: up the slide to the catch, blades buried through the drive, feathered on the recovery, sat easy at rest', () => {
  const boat = createBoat({ hull: SCULL });
  assert.ok(scullPose(boat).slide < 0.3, 'sat easy');
  stepScull(boat, DT, { strokes: ['left', 'right'] });
  const catchPose = scullPose(boat);
  assert.ok(catchPose.slide > 0.9 && catchPose.left.sweep < -0.9, 'at the catch');
  for (let t = 0; t < SCULL.drive / 2; t += DT) stepScull(boat, DT, { strokes: [] });
  const mid = scullPose(boat);
  assert.equal(mid.left.depth, 1);
  assert.equal(mid.right.depth, 1);
  assert.ok(!mid.left.feather);
  for (let t = 0; t < SCULL.drive / 2 + 0.3; t += DT) stepScull(boat, DT, { strokes: [] });
  const recovery = scullPose(boat);
  assert.equal(recovery.left.depth, 0);
  assert.ok(recovery.left.feather, 'feathered');
  assert.ok(recovery.slide < 0.5, 'hands away first');
});

test('the split: seconds a 500 m at this speed, through the world as the HUD shows it', () => {
  const boat = createBoat({ hull: SCULL });
  boat.speed = 4;
  assert.equal(split(boat), 125);
  assert.equal(split(boat, 4), 500 / 16);
  boat.speed = 0;
  assert.equal(split(boat), null);
});

test('a race takes a scull: you row the course to the finish', () => {
  const course = practiceRiver();
  const race = createRace(course, { rivals: [], you: { hull: SCULL }, birds: false, traffic: false, format: 'interval' });
  assert.equal(race.player.boat.hull, SCULL);
  let next = 0;
  for (let t = 0; t < 900 && race.player.finish === null; t += DT) {
    const strokes = race.time >= next ? ((next = race.time + 2), ['left', 'right']) : [];
    // Keep to the middle: the rudder (a slid finger or a twisted phone).
    const off = race.player.loc?.lateral ?? 0;
    const along = headingAt(course, race.player.loc?.s ?? course.start);
    const rudder = Math.max(-1, Math.min(1, -off * 0.3 - wrap(race.player.boat.heading - along) * 4));
    stepRace(race, DT, { strokes, rudder, lean: 0 });
  }
  assert.ok(race.player.finish !== null, `finished: at ${race.player.loc.s.toFixed(0)} of ${course.finish}`);
});

test('three sculls on the rack: the trainer forgives a roll the fine boat crabs on, and is slower', async () => {
  const { SCULLS, scullById } = await import('../kayak/scull.js');
  assert.deepEqual(SCULLS.map((s) => s.id), ['trainer', 'club', 'fine']);
  assert.equal(scullById('nope'), SCULLS[1]);
  const [trainer, , fine] = SCULLS.map((s) => s.hull);
  const crabsAt = (hull) => stepScull(Object.assign(createBoat({ hull }), { roll: 0.3 }), DT, { strokes: [] }).includes('crab');
  assert.ok(crabsAt(fine), 'the fine boat crabs at 0.3 rad over');
  assert.ok(!crabsAt(trainer), 'the trainer forgives it');
  const speed = (hull) => row(30, { boat: createBoat({ hull }) }).boat.speed;
  assert.ok(speed(trainer) < speed(SCULL) && speed(SCULL) < speed(fine));
});

test('backing down: both oars push the boat astern, straight; one backs it round the other way to pulling it', () => {
  const backs = (strokes, secs = 10) => {
    const boat = createBoat({ hull: SCULL });
    let next = 0;
    for (let t = 0; t < secs; t += DT) stepScull(boat, DT, { strokes: t >= next ? ((next += 2), strokes) : [] });
    return boat;
  };
  const both = backs(['back-left', 'back-right']);
  assert.ok(both.speed < -0.5 && both.speed > -2, `astern at ${both.speed}`);
  assert.ok(Math.abs(both.heading) < 0.01, 'straight');
  assert.ok(backs(['back-left'], 6).heading < -0.2, 'backing the left oar swings the bow left');
  assert.ok(row(30, { only: 'left', secs: 6 }).boat.heading > 0.2, 'pulling it swings it right');
  // Pull one, back the other: round on the spot, quicker than one oar alone.
  const spin = backs(['left', 'back-right'], 6);
  assert.ok(spin.heading > row(30, { only: 'left', secs: 6 }).boat.heading, `spun ${spin.heading}`);
});

test("stamina: a sprint spends it, easing off brings it back, and with none left a quick stroke pulls no harder", () => {
  const boat = row(38).boat;
  assert.ok(boat.stamina < 0.2);
  row(18, { secs: 20, boat });
  assert.ok(boat.stamina > 0.6, `back to ${boat.stamina}`);
  const gain = (stamina) => {
    const b = row(40, { secs: 10 }).boat;
    b.stamina = stamina;
    const before = b.speed;
    for (let t = 0; t < 1.5; t += DT) stepScull(b, DT, { strokes: t === 0 ? ['left', 'right'] : [] });
    // (wait out the recovery first, at 40 a minute)
    return b.speed - before;
  };
  assert.ok(gain(1) >= gain(0), 'fresh, no weaker');
});

test('the rudder (a slid finger, a twisted phone) nudges the boat round only while it moves', () => {
  const still = createBoat({ hull: SCULL });
  for (let t = 0; t < 3; t += DT) stepScull(still, DT, { strokes: [], rudder: 1 });
  assert.equal(still.heading, 0);
  const moving = Object.assign(createBoat({ hull: SCULL }), { speed: 3.5 });
  for (let t = 0; t < 3; t += DT) stepScull(moving, DT, { strokes: [], rudder: 1 });
  assert.ok(moving.heading > 0.05);
});

test("a lone oar's catch rolls the boat towards its side; both together hardly at all", () => {
  const lone = createBoat({ hull: SCULL });
  stepScull(lone, DT, { strokes: ['left'] });
  for (let t = 0; t < 0.2; t += DT) stepScull(lone, DT, { strokes: [] });
  const both = createBoat({ hull: SCULL });
  stepScull(both, DT, { strokes: ['left', 'right'] });
  for (let t = 0; t < 0.2; t += DT) stepScull(both, DT, { strokes: [] });
  assert.ok(lone.rollRate < -0.1, `the left oar rolls it left: ${lone.rollRate}`);
  assert.ok(Math.abs(both.rollRate) < Math.abs(lone.rollRate) / 5);
});

test('in the water after a capsize, strokes do nothing', () => {
  const boat = Object.assign(createBoat({ hull: SCULL }), { speed: 3, roll: SCULL.capsize + 0.05 });
  stepScull(boat, DT, { strokes: [] });
  const events = [];
  for (let t = 0; t < 1; t += DT) events.push(...stepScull(boat, DT, { strokes: ['left', 'right'] }));
  assert.ok(!events.includes('stroke'));
  assert.ok(boat.speed < 1);
});

// Row a race: both oars every 2 s, leading with one to steer for a point 30 m
// ahead (a long boat: nearer, it cuts the island ends), one oar alone to turn hard.
function rowRace(race, secs) {
  const events = [];
  let next = 0;
  let pending = null;
  for (let t = 0; t < secs && race.player.finish === null; t += DT) {
    const strokes = [];
    const { boat, loc } = race.player;
    const aim = pointAt(race.course, loc.s + 30);
    const err = wrap(Math.atan2(aim.x - boat.x, -(aim.z - boat.z)) - boat.heading);
    if (started(race) && race.time >= next) {
      next = race.time + 2;
      const lead = err > 0 ? 'left' : 'right'; // the left oar first brings the bow right
      strokes.push(lead);
      if (Math.abs(err) < 0.4) pending = { side: lead === 'left' ? 'right' : 'left', at: race.time + Math.min(0.18, Math.abs(err) * 0.5) };
      else next = race.time + 1.6;
    }
    if (pending && race.time >= pending.at) {
      strokes.push(pending.side);
      pending = null;
    }
    const lean = Math.max(-1, Math.min(1, -(boat.roll * 3 + boat.rollRate)));
    events.push(...stepRace(race, DT, { strokes, rudder: Math.max(-1, Math.min(1, err * 3)), lean }).events);
  }
  return events;
}

test("the Head of the River: rowed round the Loop's islands against scullers sent off 30 s apart, and finished", async () => {
  const course = courseFromFile(JSON.parse(await readFile(new URL('../kayak/courses/loop.json', import.meta.url), 'utf8')));
  const race = createRace(course, { you: { hull: SCULL }, rivals: DIVISION_9.slice(0, 5), format: 'interval', birds: false, traffic: false, seed: 3 });
  rowRace(race, 2400);
  assert.ok(race.player.finish !== null, `finished: at ${race.player.loc.s.toFixed(0)} of ${course.finish}`);
  // Then sit easy while the rest come in.
  for (let t = 0; t < 600 && race.racers.some((r) => r.finish === null); t += DT) stepRace(race, DT, { strokes: [], lean: 0 });
  assert.ok(race.racers.filter((r) => r.finish !== null).length >= 4, 'and the rivals too, near enough');
});

test("a swan in a scull's way tips the rower in, who climbs back in", () => {
  const course = practiceRiver();
  const race = createRace(course, { you: { hull: SCULL }, birds: false, traffic: false, format: 'interval' });
  const c = pointAt(course, course.start + 40);
  race.birds = [{ kind: 'swan', x: c.x, z: c.z, heading: headingAt(course, course.start + 40), speed: 0, phase: 0, loc: locate(course, c.x, c.z), fly: 0, gone: false }];
  const events = rowRace(race, 40);
  assert.ok(events.includes('swan') && events.includes('capsize'), events.filter((e) => e !== 'stroke').join(','));
  assert.ok(events.includes('remount'));
});

test("rowing choices read back from the device: an unknown scull or colour falls back", () => {
  assert.deepEqual(cleanRow(null), { scull: 'club', colour: SCULL_COLOURS[0] });
  assert.deepEqual(cleanRow({ scull: 'fine', colour: SCULL_COLOURS[2] }), { scull: 'fine', colour: SCULL_COLOURS[2] });
  assert.deepEqual(cleanRow({ scull: 'canoe', colour: '#00ff00' }), { scull: 'club', colour: SCULL_COLOURS[0] });
});
