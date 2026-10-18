import { test } from 'node:test';
import assert from 'node:assert/strict';

// audio.js starts its AudioContext on the first input. On phones only the end
// of a touch counts as a user gesture (pointerup/touchend, not pointerdown),
// and iOS leaves the context 'interrupted' after a call or a trip to another app.
const handlers = {};
globalThis.addEventListener = (type, fn) => { (handlers[type] ??= []).push(fn); };
let ctx = null;
let created = 0;
globalThis.AudioContext = class {
  state = 'suspended';
  resumes = 0;
  constructor() { created++; ctx = this; }
  resume() { this.resumes++; this.state = 'running'; return Promise.resolve(); }
};
await import('../shared/audio.js');
const fire = (type) => handlers[type]?.forEach((fn) => fn());

test('the end of a touch starts the sound', () => {
  assert.ok(handlers.pointerup && handlers.touchend, 'listens for the end of a touch');
  fire('touchend');
  assert.equal(created, 1);
  assert.equal(ctx.resumes, 1);
  assert.equal(ctx.state, 'running');
});

test('a later tap restarts sound that iOS interrupted', () => {
  ctx.state = 'interrupted';
  fire('pointerup');
  assert.equal(ctx.state, 'running');
  assert.equal(created, 1, 'one context, reused');
});
