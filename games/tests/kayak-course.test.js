import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { practiceRiver, raceRiver, courseFromFile, locate, pointAt } from '../kayak/course.js';
import { courseMap, headingDegrees } from '../kayak/map.js';

const fromFile = async (name) => courseFromFile(JSON.parse(await readFile(new URL(`../kayak/courses/${name}.json`, import.meta.url), 'utf8')));

// Paddles a line along the course at a fixed share of the open water to one
// side, as a boat would (each position found from the last), and returns the
// furthest the game's idea of "how far along" strays from the truth.
function worstSkip(course, share) {
  let hint = 0;
  let worst = 0;
  for (let s = 0; s < course.length - 2; s += 0.5) {
    const w = course.samples[Math.round(s / 2)];
    const lateral = share < 0 ? share * (w.left - 1) : share * (w.right - 1);
    const p = pointAt(course, s);
    const l = locate(course, p.x - p.tz * lateral, p.z + p.tx * lateral, hint);
    hint = l.i;
    worst = Math.max(worst, Math.abs(l.s - s));
  }
  return worst;
}

// On the loop's turns round the islands the bend was tighter than the water was
// wide: a boat out on the inside was nearer another part of the line, so the
// game thought it had jumped up to 80 m along, and pushed it off banks that
// weren't there.
test('round a tight bend, where you are along the course never jumps', async () => {
  for (const [name, course] of [['loop', await fromFile('loop')], ['reading', await fromFile('reading')], ['race', raceRiver()], ['practice', practiceRiver()]]) {
    for (const share of [-0.95, -0.6, 0, 0.6, 0.95]) {
      const skip = worstSkip(course, share);
      assert.ok(skip < 8, `${name}, ${share} of the way to the bank: skips ${skip.toFixed(1)} m`);
    }
  }
});

test('the open water is only narrowed on the inside of tight bends', async () => {
  const course = raceRiver();
  // A gentle river keeps its full width each side.
  assert.ok(course.samples.every((p) => Math.abs(p.left - p.right) < 1e-9 || p.left < p.half || p.right < p.half));
  const loop = await fromFile('loop');
  const narrowed = loop.samples.filter((p) => p.left < 3.01 || p.right < 3.01).length;
  assert.ok(narrowed < loop.samples.length / 20, `${narrowed} of ${loop.samples.length} samples squeezed to the minimum`);
});

test('the course map fits the course, long side along the course, north up, start and finish on the line', async () => {
  const course = await fromFile('loop');
  const map = courseMap(course, { long: 160, short: 40, pad: 8 });
  const points = map.d.split(/[ML]/).filter(Boolean).map((xy) => xy.split(' ').map(Number));
  assert.ok(points.length > 50 && points.length <= 241);
  for (const [x, y] of points) assert.ok(x >= 7.9 && x <= map.width - 7.9 && y >= 7.9 && y <= map.height - 7.9, `${x},${y} inside`);
  // The loop runs east-west: a wide map, the course filling its width.
  assert.equal(map.width, 160);
  assert.ok(map.height >= 40 && map.height < 120, `height ${map.height}`);
  const span = (k) => Math.max(...points.map((p) => p[k])) - Math.min(...points.map((p) => p[k]));
  assert.ok(Math.abs(span(0) - 144) < 0.5);
  // A course running north-south gets a tall map instead.
  const tall = courseMap(raceRiver());
  assert.ok(tall.height === 160 && tall.width < 160);
  // North (-z) is up: a point further north is higher on the map.
  const p = course.samples[100];
  assert.ok(map.project(p.x, p.z - 50)[1] < map.project(p.x, p.z)[1]);
  // The loop starts and finishes in the same place.
  assert.ok(Math.hypot(map.start[0] - map.finish[0], map.start[1] - map.finish[1]) < 10);
  // Heading 0 points up the map, a quarter turn right points right.
  assert.equal(headingDegrees(0), 0);
  assert.equal(headingDegrees(Math.PI / 2), 90);
});
