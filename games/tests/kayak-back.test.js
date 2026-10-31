import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// A window and a canvas that keep their listeners, so keys and touches can be played in.
const on = (store) => (type, fn) => (store[type] ??= []).push(fn);
const win = {};
globalThis.addEventListener = on(win);
const canvas = {};
const target = { addEventListener: on(canvas), getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }) };
const fire = (store, type, e) => (store[type] ?? []).forEach((fn) => fn({ preventDefault() {}, ...e }));

const { Controls } = await import('../reading-thames/controls.js');
const { createBoat, step, strokeRate, BOAT } = await import('../reading-thames/sim.js');
const { courseFromFile, pointAt, locate } = await import('../reading-thames/course.js');
const { createRace, stepRace } = await import('../reading-thames/race.js');
const { wrap } = await import('../reading-thames/sim.js');

const DT = 1 / 120;
const balance = (b) => Math.max(-1, Math.min(1, -(b.roll * 2 + b.rollRate * 0.6)));
const run = (boat, seconds, strokesAt = () => []) => {
  for (let t = 0; t < seconds; t += DT) step(boat, DT, { strokes: strokesAt(t), lean: balance(boat) });
  return boat;
};
// A stroke every `gap` seconds, from `sides` in turn.
const every = (gap, sides) => {
  let next = 0;
  let n = 0;
  return (t) => (t >= next ? ((next += gap), [sides[n++ % sides.length]]) : []);
};

test('back strokes brake a moving boat, then take it backwards, no faster than a walk', () => {
  const boat = createBoat();
  boat.speed = 3;
  run(boat, 1.5, every(0.5, ['back-left', 'back-right']));
  assert.ok(boat.speed < 2.2, `braked to ${boat.speed}`);
  run(boat, 20, every(0.5, ['back-left', 'back-right']));
  assert.ok(boat.speed < -0.5 && boat.speed >= -BOAT.backMax, `going backwards at ${boat.speed}`);
  // Stop back-paddling and it drifts to a standstill, never forwards again.
  let lowest = boat.speed;
  for (let t = 0; t < 30; t += DT) {
    step(boat, DT, { strokes: [], lean: balance(boat) });
    assert.ok(boat.speed <= 0);
    lowest = Math.max(lowest, boat.speed);
  }
  assert.ok(boat.speed > -0.15, `still at ${boat.speed}`);
});

test('a back stroke swings the bow towards its side; alternating them backs you out straight', () => {
  const left = run(createBoat(), 4, every(0.6, ['back-left']));
  const right = run(createBoat(), 4, every(0.6, ['back-right']));
  assert.ok(wrap(left.heading) < -0.3, `left back strokes: bow to the left, ${left.heading}`);
  assert.ok(wrap(right.heading) > 0.3, `right back strokes: bow to the right, ${right.heading}`);
  const straight = run(createBoat(), 6, every(0.6, ['back-left', 'back-right']));
  assert.ok(Math.abs(wrap(straight.heading)) < 0.25, `alternating: ${straight.heading}`);
  assert.ok(straight.z > 1, 'and it went backwards (heading up -z)');
});

test('back strokes cost no stamina and do not count as strokes a minute', () => {
  const boat = createBoat();
  boat.stamina = 0.5;
  run(boat, 10, every(0.45, ['back-left', 'back-right']));
  assert.ok(boat.stamina > 0.5);
  assert.equal(strokeRate(boat), 0);
  assert.equal(boat.capsizes, 0);
});

test('going backwards, the rudder turns the boat the other way', () => {
  const boat = createBoat();
  boat.speed = -1.2;
  for (let t = 0; t < 1; t += DT) step(boat, DT, { strokes: [], rudder: 1, lean: balance(boat) });
  assert.ok(boat.heading < -0.05, `heading ${boat.heading}`);
});

test('keys: hold the down arrow and the stroke keys take back strokes; gamepad LB and RB too', () => {
  const c = new Controls(target);
  fire(win, 'keydown', { code: 'ArrowLeft' });
  fire(win, 'keyup', { code: 'ArrowLeft' });
  fire(win, 'keydown', { code: 'ArrowDown' });
  fire(win, 'keydown', { code: 'ArrowRight' });
  fire(win, 'keyup', { code: 'ArrowRight' });
  fire(win, 'keydown', { code: 'ArrowLeft' });
  fire(win, 'keyup', { code: 'ArrowDown' });
  fire(win, 'keyup', { code: 'ArrowLeft' });
  assert.deepEqual(c.take().strokes, ['left', 'back-right', 'back-left']);
});

test('touch: a tap is a forward stroke on its side, a swipe down a back stroke, a slide steers at once', () => {
  const c = new Controls(target);
  const touch = (id, x, y) => fire(canvas, 'pointerdown', { pointerId: id, pointerType: 'touch', clientX: x, clientY: y });
  // A tap on the right: nothing until the finger lifts, then a forward stroke.
  touch(1, 600, 200);
  assert.deepEqual(c.take().strokes, []);
  fire(canvas, 'pointerup', { pointerId: 1 });
  assert.deepEqual(c.take().strokes, ['right']);
  // A swipe down on the left: a back stroke on the left, and nothing when it lifts.
  touch(2, 150, 150);
  fire(canvas, 'pointermove', { pointerId: 2, clientX: 152, clientY: 190 });
  fire(canvas, 'pointerup', { pointerId: 2 });
  assert.deepEqual(c.take().strokes, ['back-left']);
  // A thumb slid sideways to steer: the stroke goes at once, and the slide steers.
  touch(3, 600, 200);
  fire(canvas, 'pointermove', { pointerId: 3, clientX: 640, clientY: 202 });
  const slid = c.take();
  assert.deepEqual(slid.strokes, ['right']);
  assert.ok(slid.rudder > 0.2);
  fire(canvas, 'pointerup', { pointerId: 3 });
  assert.deepEqual(c.take().strokes, []);
});

test('touch: a thumb held still is a forward stroke after a moment, not a swipe', async () => {
  const c = new Controls(target);
  fire(canvas, 'pointerdown', { pointerId: 4, pointerType: 'touch', clientX: 100, clientY: 200 });
  await new Promise((r) => setTimeout(r, 180));
  assert.deepEqual(c.take().strokes, ['left']);
  fire(canvas, 'pointermove', { pointerId: 4, clientX: 100, clientY: 260 });
  fire(canvas, 'pointerup', { pointerId: 4 });
  assert.deepEqual(c.take().strokes, [], 'already taken: no back stroke after it');
});

const loop = async () => courseFromFile(JSON.parse(await readFile(new URL('../reading-thames/courses/loop.json', import.meta.url), 'utf8')));

// A paddler at St Mary's Island steering at a point 15 m up the course, 8 m
// right of it: past the island's end that point is on land, and they grind
// along the bank there. This is how one got stuck in a real race.
function stuckAtStMarys(course) {
  const race = createRace(course, { rivals: [], seed: 1, birds: false, traffic: false, format: 'interval' });
  const r = race.player;
  Object.assign(r, { release: -1, crossed: 0 });
  r.gate = race.gates.findIndex((g) => g.s >= 1480);
  const from = 1480;
  const p = pointAt(course, from);
  Object.assign(r.boat, { x: p.x - p.tz * 8, z: p.z + p.tx * 8, heading: Math.atan2(p.tx, -p.tz), speed: 3, speedup: course.speedup });
  r.boat.hull = { ...r.boat.hull, capsize: 10 };
  r.loc = locate(course, r.boat.x, r.boat.z, course.samples.findIndex((q) => q.s >= from));
  let next = 0;
  const events = [];
  const paddle = (seconds, offset, sides = null) => {
    for (let t = 0; t < seconds; t += DT) {
      const aim = pointAt(course, r.loc.s + 15);
      const err = wrap(Math.atan2(aim.x - aim.tz * offset - r.boat.x, -(aim.z + aim.tx * offset - r.boat.z)) - r.boat.heading);
      let strokes = [];
      if (r.boat.time >= next) {
        strokes = sides ? [sides[Math.floor(r.boat.time / 0.6) % sides.length]] : [r.boat.lastSide === 'left' ? 'right' : 'left'];
        next = r.boat.time + (sides ? 0.6 : 0.7);
      }
      events.push(...stepRace(race, DT, { strokes, rudder: sides ? 0 : Math.max(-1, Math.min(1, err * 3 - r.boat.yawRate * 0.5)), lean: 0 }).events);
    }
  };
  return { race, r, paddle, events };
}

test("stuck against the bank at St Mary's Island, a few back strokes get you out", async () => {
  const course = await loop();
  const { r, paddle } = stuckAtStMarys(course);
  paddle(40, 8);
  const at = r.loc.s;
  assert.ok(at < 1700, `stuck at ${at.toFixed(0)} m`);
  // Back off the bank (more on the right, swinging the bow right, out into the channel), then on along the line.
  paddle(3, 0, ['back-right', 'back-left', 'back-right']);
  paddle(30, 0);
  assert.ok(r.loc.s > 1800, `out and on to ${r.loc.s.toFixed(0)} m`);
});
