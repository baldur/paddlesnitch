import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCourse, practiceRiver, raceRiver, pointAt, locate, headingAt } from '../reading-thames/course.js';
import { createRace, stepRace, started, DIVISION_9 } from '../reading-thames/race.js';
import { wrap } from '../reading-thames/sim.js';

const DT = 1 / 120;
const balance = (b) => Math.max(-1, Math.min(1, -(b.roll * 2 + b.rollRate * 0.6)));

// A bird of `kind` on the course's centreline at `s` (or `lateral` off it), facing up the river.
function bird(course, kind, s, lateral = 0) {
  const c = pointAt(course, s);
  const x = c.x - c.tz * lateral;
  const z = c.z + c.tx * lateral;
  return { kind, x, z, heading: headingAt(course, s), speed: 0, phase: 0, loc: locate(course, x, z), fly: 0, gone: false };
}

// The player paddles up the middle (or `lateral` off it) at a racing beat for `seconds`.
function paddleOn(race, seconds, lateral = 0) {
  const events = [];
  let next = 0;
  for (let t = 0; t < seconds; t += DT) {
    const strokes = [];
    if (started(race) && race.time >= next) {
      strokes.push(race.player.boat.lastSide === 'left' ? 'right' : 'left');
      next = race.time + 0.7;
    }
    const { boat, loc } = race.player;
    const aim = pointAt(race.course, loc.s + 12);
    const err = wrap(Math.atan2(aim.x - aim.tz * lateral - boat.x, -(aim.z + aim.tx * lateral - boat.z)) - boat.heading);
    const rudder = Math.max(-1, Math.min(1, err * 3 - boat.yawRate * 0.5));
    events.push(...stepRace(race, DT, { strokes, rudder, lean: balance(boat) }).events);
  }
  return events;
}

test('paddling into a swan tips you in; swans hardly move out of the way', () => {
  const course = practiceRiver();
  const race = createRace(course, { birds: false });
  race.birds = [bird(course, 'swan', course.start + 40)];
  const events = paddleOn(race, 40);
  assert.ok(events.includes('swan'), 'hit the swan');
  assert.ok(events.includes('capsize'));
});

test('steer round a swan and you stay upright', () => {
  const course = practiceRiver();
  const race = createRace(course, { birds: false });
  race.birds = [bird(course, 'swan', course.start + 40)];
  const events = paddleOn(race, 40, 4);
  assert.ok(!events.includes('swan'));
  assert.equal(race.player.boat.capsizes, 0);
});

test('ducks paddle off and take flight as you come', () => {
  const course = practiceRiver();
  const race = createRace(course, { birds: false });
  race.birds = [bird(course, 'duck', course.start + 40), bird(course, 'duck', course.start + 41, 0.5)];
  const events = paddleOn(race, 40);
  assert.ok(race.birds.every((b) => b.fly > 0), 'they flew');
  assert.ok(race.birds.every((b) => b.gone), 'and left');
  assert.ok(!events.includes('capsize'));
});

test('rivals steer round swans in their way', () => {
  const course = raceRiver();
  const race = createRace(course, { rivals: DIVISION_9.slice(0, 6), seed: 4, birds: false });
  race.birds = [300, 450, 620].flatMap((s, k) => [bird(course, 'swan', s, k - 1), bird(course, 'swan', s + 3, k + 0.5)]);
  // The player sits on the line and the horn waits for them: put them there.
  const p = race.player;
  const c = pointAt(course, race.start.line - 4);
  Object.assign(p.boat, { x: c.x, z: c.z });
  for (let t = 0; !started(race); t += DT) {
    assert.ok(t < 60, 'the start never came');
    stepRace(race, DT, { strokes: [], lean: balance(p.boat) });
  }
  while (race.time < 280) stepRace(race, DT, { strokes: [], lean: balance(p.boat) });
  const rivals = race.racers.filter((r) => r.ai);
  assert.ok(rivals.every((r) => r.loc.s > 700), 'everyone got past them');
  assert.deepEqual(rivals.filter((r) => r.boat.capsizes).map((r) => r.name), []);
});

test('every course has a few birds about, and none on a dead straight test river is in the way at the start', () => {
  const course = createCourse([[0, 0], [0, -2000]], { width: 30, start: 60, finish: 1800 });
  const race = createRace(course, { seed: 9 });
  assert.ok(race.birds.length >= 2, `${race.birds.length} birds`);
  assert.ok(race.birds.every((b) => b.loc.s > course.start + 100));
  assert.ok(race.birds.every((b) => Math.abs(b.loc.lateral) < 15));
});
