import { test } from 'node:test';
import assert from 'node:assert/strict';

// Controls listens on the window; Node has none, so stand one in. Node's
// navigator has no getGamepads, like browsers without the Gamepad API
// (Firefox on Android), which used to throw on every frame.
globalThis.addEventListener ??= () => {};
const { Controls, twistRate, stepTwist, twistRudder, TWIST_FULL, TWIST_SETTLE } = await import('../kayak/controls.js');
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

// The gyroscope's rates (degrees a second) for turning the phone about the
// screen's upright axis, the right side moving away from you, at `deg` a second,
// for a screen at `angle`: in landscape the screen's up is along the phone's x.
const pushRight = (deg, angle) => {
  const a = (angle * Math.PI) / 180;
  return { alpha: 0, beta: deg * Math.sin(a), gamma: deg * Math.cos(a) };
};
const hold = (rate, seconds, angle = 90) => {
  let twist = 0;
  for (let t = 0; t < seconds; t += 1 / 60) twist = stepTwist(twist, twistRate(rate, angle), 1 / 60);
  return twist;
};

test('pushing the right side of the phone forward steers left, the left side right, in either landscape', () => {
  for (const angle of [90, -90, 270]) {
    const right = hold(pushRight(40, angle), 0.5, angle); // about 20 degrees
    assert.ok(twistRudder(right) < -0.9, `right side forward at ${angle}: ${twistRudder(right)}`);
    const left = hold(pushRight(-40, angle), 0.5, angle);
    assert.ok(twistRudder(left) > 0.9, `left side forward at ${angle}: ${twistRudder(left)}`);
  }
});

test('turning the phone like a wheel, or tipping it back, does not steer', () => {
  const wheel = hold({ alpha: 60, beta: 0, gamma: 0 }, 0.5);
  assert.equal(twistRudder(wheel), 0);
  // Tipping the top back, in landscape: about the screen's across axis, which is the phone's long (y) axis.
  const tip = hold({ alpha: 0, beta: 0, gamma: 60 }, 0.5);
  assert.equal(twistRudder(tip), 0);
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
