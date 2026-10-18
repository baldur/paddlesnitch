import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPacer } from '../kayak/pacing.js';

// Feeds the pacer `seconds` of frames, each `ms` long.
function run(pacer, ms, seconds) {
  for (let t = 0; t < seconds * 1000; t += ms) pacer.tick(ms);
  return pacer.scale;
}

test('keeps full resolution while frames keep up with the screen', () => {
  const p = createPacer();
  assert.equal(run(p, 1000 / 60, 20), 1);
});

test('keeps full resolution on a 120 Hz screen', () => {
  const p = createPacer();
  assert.equal(run(p, 1000 / 120, 20), 1);
});

test('drops resolution when frames come at 30 fps', () => {
  const p = createPacer();
  run(p, 1000 / 60, 2);
  const scale = run(p, 1000 / 30, 10);
  assert.ok(scale < 1, `scale ${scale}`);
});

test('never goes below half resolution', () => {
  const p = createPacer();
  run(p, 1000 / 60, 2);
  assert.equal(run(p, 100, 120), 0.5);
});

test('creeps back up once there is room again', () => {
  const p = createPacer();
  run(p, 1000 / 60, 2);
  const low = run(p, 1000 / 30, 10);
  const back = run(p, 1000 / 60, 60);
  assert.ok(back > low, `${low} -> ${back}`);
  assert.equal(back, 1);
});

test('stops raising when a raise makes frames slow again', () => {
  const p = createPacer();
  run(p, 1000 / 60, 2);
  // A GPU that keeps up at 60 % of the pixels and no more.
  let changes = 0;
  let last = p.scale;
  for (let t = 0; t < 120_000; t += 16) {
    const ms = p.scale > 0.6 ? 1000 / 30 : 1000 / 60;
    p.tick(ms);
    if (p.scale !== last) changes++;
    last = p.scale;
  }
  assert.ok(changes < 20, `${changes} changes in two minutes`);
  assert.ok(p.scale <= 0.6, `ends at ${p.scale}`);
});

test('keeps full resolution at 60 fps with uneven frame timing', () => {
  // Real browsers deliver some frames early and some late (it read the odd
  // 8 ms frame as the screen's rate and halved the resolution at a smooth 60).
  const p = createPacer();
  for (let t = 0; t < 30_000; t += 33.4) { p.tick(8.4); p.tick(25); }
  assert.equal(p.scale, 1);
});

test('ignores the gap after a hidden tab or a stall', () => {
  const p = createPacer();
  run(p, 1000 / 60, 2);
  p.tick(5000);
  assert.equal(run(p, 1000 / 60, 2), 1);
});
