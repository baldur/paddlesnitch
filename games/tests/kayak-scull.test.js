// The single scull (scull.js): two oars, one per side; strokes of both, steering
// by timing, a gentler balance than the kayak's, crabs, and racing it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoat } from '../kayak/sim.js';
import { SCULL, stepScull, scullRate, scullPose, split } from '../kayak/scull.js';
import { createRace, stepRace } from '../kayak/race.js';
import { practiceRiver, headingAt } from '../kayak/course.js';
import { wrap } from '../kayak/sim.js';

const DT = 1 / 120;
// Row for `secs` at `rate` strokes a minute: both oars (the right `late`
// seconds after the left), or one, or the two in turn.
function row(rate, { secs = 60, late = 0, only = null, alternate = false, lean = 0, rock = 0, boat = createBoat({ hull: SCULL }) } = {}) {
  const events = [];
  let next = 0;
  let second = null;
  let n = 0;
  for (let t = 0; t < secs; t += DT) {
    const strokes = [];
    if (t >= next) {
      next += 60 / rate;
      if (only) strokes.push(only);
      else if (alternate) strokes.push(n++ % 2 ? 'left' : 'right');
      else {
        strokes.push('left');
        second = t + late;
      }
    }
    if (second !== null && t >= second) {
      strokes.push('right');
      second = null;
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
  const { boat: rightFirst } = row(30, { late: -0.08, secs: 20 });
  // (a negative late: the right oar goes first, as the left one's pressed next frame)
  assert.ok(Math.abs(rightFirst.heading) < 0.05 || rightFirst.heading < 0, 'and the other way round turns it the other way, or not at all');
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

test('a wash rocks the boat; leaning against the roll keeps it up', () => {
  const rocked = row(30, { secs: 60, rock: 1 });
  const caught = rocked.events.filter((e) => e === 'crab').length;
  let leaned = createBoat({ hull: SCULL });
  let crabs = 0;
  let next = 0;
  for (let t = 0; t < 60; t += DT) {
    const strokes = t >= next ? ((next += 2), ['left', 'right']) : [];
    const lean = Math.max(-1, Math.min(1, -(leaned.roll * 3 + leaned.rollRate)));
    crabs += stepScull(leaned, DT, { strokes, rock: 1, lean }).filter((e) => e === 'crab').length;
  }
  assert.ok(crabs <= caught, `leaning: ${crabs} crabs, not: ${caught}`);
  assert.ok(Math.abs(leaned.roll) < SCULL.crabAt);
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
  assert.ok(trainer.crabAt > SCULL.crabAt && fine.crabAt < SCULL.crabAt);
  const speed = (hull) => row(30, { boat: createBoat({ hull }) }).boat.speed;
  assert.ok(speed(trainer) < speed(SCULL) && speed(SCULL) < speed(fine));
});
