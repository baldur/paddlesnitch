import { test } from 'node:test';
import assert from 'node:assert/strict';

// Controls listens on the window; Node has none, so stand one in. Node's
// navigator has no getGamepads, like browsers without the Gamepad API
// (Firefox on Android), which used to throw on every frame.
globalThis.addEventListener ??= () => {};
const { Controls, twistRate, stepTwist, twistRudder, TWIST_FULL, TWIST_SETTLE } = await import('../reading-thames/controls.js');
const { Input } = await import('../shared/input.js');
const target = { addEventListener() {}, setPointerCapture() {} };

test('reads controls in a browser without the Gamepad API', () => {
  assert.equal(typeof navigator.getGamepads, 'undefined');
  const c = new Controls(target);
  assert.deepEqual([...c.poll(1 / 60)], []);
  assert.deepEqual(c.take().strokes, []);
  c.rumble();
});

test('shared input works in a browser without the Gamepad API', () => {
  const input = new Input(target, { keys: {}, axis: 'y', length: 1 });
  assert.deepEqual([...input.poll()], []);
});

// The gyroscope's rates (degrees a second) about the phone's own axes, as
// browsers report them: alpha about x (across the phone held upright), beta
// about y (along it), gamma about z (out of the screen).
const gyro = (x, y, z) => ({ alpha: x, beta: y, gamma: z });
// Turning the phone about the screen's upright axis, the right side moving away
// from you, at `deg` a second, for a screen at `angle`: held upright the
// screen's up is the phone's y; in landscape it is along the phone's x.
const pushRight = (deg, angle) => {
  const a = (angle * Math.PI) / 180;
  return gyro(deg * Math.sin(a), deg * Math.cos(a), 0);
};
const hold = (rate, seconds, angle = 90) => {
  let twist = 0;
  for (let t = 0; t < seconds; t += 1 / 60) twist = stepTwist(twist, twistRate(rate, angle), 1 / 60);
  return twist;
};

test('pushing the right side of the phone forward steers left, the left side right, in either landscape', () => {
  for (const angle of [0, 90, -90, 270]) {
    const right = hold(pushRight(40, angle), 0.5, angle); // about 20 degrees
    assert.ok(twistRudder(right) < -0.9, `right side forward at ${angle}: ${twistRudder(right)}`);
    const left = hold(pushRight(-40, angle), 0.5, angle);
    assert.ok(twistRudder(left) > 0.9, `left side forward at ${angle}: ${twistRudder(left)}`);
  }
});

test('turning the phone like a wheel, or tipping it back, does not steer', () => {
  // A wheel turns about the screen's normal, the phone's z.
  for (const angle of [0, 90, -90]) assert.equal(twistRudder(hold(gyro(0, 0, 60), 0.5, angle)), 0, `wheel at ${angle}`);
  // Tipping the top back, in landscape: about the screen's across axis, the phone's long (y) axis.
  assert.equal(twistRudder(hold(gyro(0, 60, 0), 0.5, 90)), 0);
  assert.equal(twistRudder(hold(gyro(0, 60, 0), 0.5, -90)), 0);
  // Held upright, tipping back is about the phone's x.
  assert.equal(twistRudder(hold(gyro(60, 0, 0), 0.5, 0)), 0);
});

test('a small twist does nothing, more turns harder, and held still it eases back to straight', () => {
  assert.equal(twistRudder(0.03), 0, 'a couple of degrees is a dead zone');
  assert.ok(Math.abs(twistRudder(TWIST_FULL / 2)) < Math.abs(twistRudder(TWIST_FULL)));
  assert.equal(twistRudder(TWIST_FULL * 2), -1, 'no more than full rudder');
  // Held at 20 degrees, a 10-second bend still turns most of the way; a minute later it's gone.
  let twist = 0.35;
  for (let t = 0; t < 10; t += 1 / 60) twist = stepTwist(twist, 0, 1 / 60);
  assert.ok(twistRudder(twist) < -0.6, `after 10 s: ${twistRudder(twist)}`);
  for (let t = 0; t < 3 * TWIST_SETTLE; t += 1 / 60) twist = stepTwist(twist, 0, 1 / 60);
  assert.equal(twistRudder(twist), 0);
});

test("Q and E steer a kayak; in a scull they look round, and the stick or a twist still steers without them", () => {
  const listeners = {};
  const was = globalThis.addEventListener;
  globalThis.addEventListener = (t, fn) => { listeners[t] = fn; };
  const c = new Controls(target);
  globalThis.addEventListener = was;
  listeners.keydown({ code: 'KeyE', preventDefault() {} });
  assert.equal(c.take().rudder, 1, 'E: full right rudder in a kayak');
  listeners.keyup({ code: 'KeyE' });
  listeners.keydown({ code: 'KeyQ', preventDefault() {} });
  Object.defineProperty(c, 'twistRudder', { value: -0.5 }); // the phone pushed round a little too
  const input = c.take();
  assert.equal(input.rudder, -1, 'Q and the twist together: full left');
  assert.equal(input.rudderNoKeys, -0.5, "without the keys (a scull's look): the twist alone, not cancelled");
});

test('a touch anywhere on the page (the button that starts the race) turns on the balance help', () => {
  const seen = {};
  const before = globalThis.addEventListener;
  globalThis.addEventListener = (type, fn) => { (seen[type] ??= []).push(fn); };
  try {
    const c = new Controls(target);
    assert.equal(c.assist, false);
    for (const fn of seen.pointerdown ?? []) fn({ pointerType: 'mouse' });
    assert.equal(c.assist, false, 'not for a mouse');
    for (const fn of seen.pointerdown ?? []) fn({ pointerType: 'touch' });
    assert.equal(c.assist, true);
  } finally {
    globalThis.addEventListener = before;
  }
});
