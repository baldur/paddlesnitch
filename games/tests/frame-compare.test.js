import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameTimes, compare } from './frame-compare.mjs';

const MAIN = [
  '2026-11-17T06:28:56Z ✔ webkit, desktop: webgl2, 3.4 m/s, 400 ms frames',
  '2026-11-17T06:29:56Z ✔ iphone safari: webgl2, 3.4 m/s, 300 ms frames',
  '2026-11-17T06:30:56Z ✖ webkit, desktop, Hasler Div 7-9 race: webgl2, 3.1 m/s, 600 ms frames',
  '2026-11-17T06:31:56Z ✔ webkit, desktop, a leaderboard that fails: one board failed',
].join('\n');
const PR = [
  '✔ webkit, desktop: webgl2, 3.4 m/s, 440 ms frames',
  '✔ iphone safari: webgl2, 3.4 m/s, 330 ms frames',
  '✔ webkit, desktop, Hasler Div 7-9 race: webgl2, 3.1 m/s, 900 ms frames',
  '✔ a new case only the pull request has: webgl2, 3.4 m/s, 999 ms frames',
].join('\n');

test('reads frame times from passed and failed cases, and skips lines without them', () => {
  assert.deepEqual(frameTimes(MAIN), {
    'webkit, desktop': [400],
    'iphone safari': [300],
    'webkit, desktop, Hasler Div 7-9 race': [600],
  });
});

test('compares only the cases both runs have, with the median and the worst ratio', () => {
  const { rows, median, worst } = compare(frameTimes(MAIN), frameTimes(PR));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.ratio), [1.1, 1.1, 1.5]);
  assert.equal(median, 1.1);
  assert.equal(worst, 1.5);
});

test('the median of an even count is the mean of the middle two', () => {
  const { median } = compare({ a: [100], b: [100] }, { a: [100], b: [120] });
  assert.equal(median, 1.1);
});

test('nothing in common gives no rows and no median', () => {
  const { rows, median } = compare({ a: [100] }, { b: [100] });
  assert.equal(rows.length, 0);
  assert.ok(Number.isNaN(median));
});
