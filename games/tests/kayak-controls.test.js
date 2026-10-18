import { test } from 'node:test';
import assert from 'node:assert/strict';

// Controls listens on the window; Node has none, so stand one in. Node's
// navigator has no getGamepads, like browsers without the Gamepad API
// (Firefox on Android), which used to throw on every frame.
globalThis.addEventListener ??= () => {};
const { Controls } = await import('../kayak/controls.js');
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
