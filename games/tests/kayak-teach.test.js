// Teaching as you go (teach.js): each lesson once, the first time it matters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LESSONS, nextLesson, loadTaught, saveTaught, howTo, TAUGHT_KEY } from '../reading-thames/teach.js';

const calm = { angle: 0, rhythm: 0.2, draft: 0, racing: true, time: 5, rate: 70, stamina: 1, sprinting: false, assist: false, scull: false, outing: false };
const keys = howTo(false);

test('nothing to teach on calm water at the start', () => {
  assert.equal(nextLesson(calm, new Set(), keys), null);
});

test('each lesson comes when its moment does, and names the right controls', () => {
  assert.equal(nextLesson({ ...calm, angle: -40 }, new Set(), keys).key, 'lean');
  assert.equal(nextLesson({ ...calm, angle: 20 }, new Set(), keys), null); // a little wobble is nothing
  assert.equal(nextLesson({ ...calm, angle: 30 }, new Set(), keys).now, true); // tipping: up at once
  assert.equal(nextLesson({ ...calm, draft: 0.5 }, new Set(), keys).now, false);
  assert.match(nextLesson({ ...calm, angle: 40 }, new Set(), keys).text, /A and D/);
  assert.match(nextLesson({ ...calm, angle: 40 }, new Set(), howTo(true)).text, /turn the phone/);
  assert.equal(nextLesson({ ...calm, draft: 0.5 }, new Set(), keys).key, 'wash');
  assert.equal(nextLesson({ ...calm, rhythm: 0.95 }, new Set(), keys).key, 'rhythm');
  assert.equal(nextLesson({ ...calm, time: 25 }, new Set(), keys).key, 'sprint');
});

test('a lesson already taught is never given again', () => {
  const taught = new Set(LESSONS.map((l) => l.key));
  for (const m of [{ angle: 40 }, { draft: 0.5 }, { rhythm: 0.95 }, { time: 25 }]) assert.equal(nextLesson({ ...calm, ...m }, taught, keys), null);
  // Taught to lean, a wobble with a wash teaches the wash.
  assert.equal(nextLesson({ ...calm, angle: 40, draft: 0.5 }, new Set(['lean']), keys).key, 'wash');
});

test('no lean lesson with the balance assist on, none in a scull, none on an outing', () => {
  assert.equal(nextLesson({ ...calm, angle: 40, assist: true }, new Set(), keys), null);
  assert.equal(nextLesson({ ...calm, angle: 40, scull: true }, new Set(), keys), null);
  assert.equal(nextLesson({ ...calm, angle: 40, draft: 0.5, outing: true }, new Set(), keys), null);
});

test('no lesson at all in a scull: rowing has none of these', () => {
  for (const m of [{ angle: 40 }, { draft: 0.5 }, { rhythm: 0.95 }, { time: 25 }]) assert.equal(nextLesson({ ...calm, ...m, scull: true }, new Set(), keys), null, JSON.stringify(m));
});

test('no sprint lesson while sprinting, tired, stopped or before 20 s', () => {
  for (const m of [{ sprinting: true }, { stamina: 0.5 }, { rate: 0 }, { time: 10 }, { racing: false }]) {
    assert.equal(nextLesson({ ...calm, time: 25, ...m }, new Set(), keys), null, JSON.stringify(m));
  }
});

test('what has been taught is kept, and bad storage just teaches again', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  saveTaught(storage, new Set(['lean', 'wash']));
  assert.deepEqual([...loadTaught(storage)].sort(), ['lean', 'wash']);
  store.set(TAUGHT_KEY, '{not json');
  assert.equal(loadTaught(storage).size, 0);
  store.set(TAUGHT_KEY, '{"lean":true}');
  assert.equal(loadTaught(storage).size, 0);
  assert.equal(loadTaught({ getItem: () => { throw new Error('blocked'); } }).size, 0);
  saveTaught({ setItem: () => { throw new Error('full'); } }, new Set(['lean'])); // doesn't throw
});

test("the wash isn't taught on the start line, where boats drift up beside you", () => {
  assert.equal(nextLesson({ ...calm, racing: false, draft: 0.5 }, new Set(['lean']), keys), null);
});
