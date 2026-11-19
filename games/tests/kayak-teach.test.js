// Teaching as you go (teach.js): each lesson once, the first time it matters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LESSONS, nextLesson, loadTaught, saveTaught, howTo, TAUGHT_KEY, waitTurn, WAITING, nextTurn, STALE, waits, READ } from '../reading-thames/teach.js';

test("a hint doesn't go up over an instruction the frame it came up, so it's seen: it waits its turn", () => {
  // (The race's sprint hint covered "Second instruction" the frame it came off the queue: games in webkit, 7d000bad.)
  const second = { text: 'Second instruction', hold: 1.2 };
  const wash = { text: 'Paddle quicker than 90 a minute to sprint onto their wash', hold: 2.5 };
  const up = (hint, t) => ({ ...hint, left: hint.hold - t, up: t });
  assert.equal(waits(wash, up(second, 0)), true, 'just up: the wash waits');
  assert.equal(waits(wash, up(second, READ - 0.01)), true);
  assert.equal(waits(wash, up(second, READ)), false, 'read: a longer hint goes up, as before');
  assert.equal(waits({ ...wash, now: true }, up(second, 0)), false, 'a `now` (a boat bearing down) still goes straight up');
  assert.equal(waits(wash, up({ text: 'Weak stroke', hold: 0.5 }, 0)), false, "a moment's note isn't kept up");
  assert.equal(waits(wash, up({ text: 'Your start in 10', hold: 1 }, 0)), true, 'a hint of 1 s is an instruction too');
  assert.equal(waits(second, up(wash, 2)), false, 'nothing longer up: it goes up');
  assert.equal(waits(second, up(wash, 0.5)), true, 'a shorter one waits behind a longer, as before');
  assert.equal(waits(wash, up(wash, 0.1)), false, 'the same words again start it over');
  assert.equal(waits(wash, null), false, 'a clear lane');
  assert.equal(waits(wash, { ...second, left: 0, up: 0.1 }), false, 'its time up');
});

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

test("an instruction waiting its turn isn't dropped when another comes: they wait in order, each once, a few at most", () => {
  const first = { text: 'Second instruction', hold: 1.2 };
  const wash = { text: 'Paddle quicker than 90 a minute to sprint onto their wash', hold: 2.5 };
  // (With one slot, the wash hint arriving under "Stuck?" dropped the test's waiting instruction on a slow CI runner.)
  let q = waitTurn([], first);
  q = waitTurn(q, wash);
  assert.deepEqual(q.map((h) => h.text), [first.text, wash.text]);
  assert.equal(waitTurn(q, { ...wash }).length, 2, 'the same words wait once');
  for (let i = 0; i < 5; i++) q = waitTurn(q, { text: `note ${i}`, hold: 1 });
  assert.equal(q.length, WAITING);
  // (Full, the newest is the one left out: an instruction not yet seen matters
  // more than a hint that will come again. The oldest went first, and a fourth
  // pushed the second instruction out unseen: games in webkit, f500b91e.)
  assert.deepEqual(q.map((h) => h.text), [first.text, wash.text, 'note 0'], 'the first to come keep their places; the newest is left out');
});

test("a hint that waited too long for its moment is skipped, and the rest still come in turn", () => {
  const start = { text: 'Your start in 10', hold: 1.5, at: 0 };
  const swan = { text: "The swan won't move", hold: 1.5, at: 4 };
  const q = [start, swan];
  assert.deepEqual(nextTurn(q, 3), { next: start, rest: [swan] }, 'the oldest first while fresh');
  const late = nextTurn(q, STALE + 1);
  assert.equal(late.next, swan, `"${start.text}" ${STALE + 1} s late isn't shown`);
  assert.deepEqual(late.rest, []);
  assert.deepEqual(nextTurn(q, STALE + 5), { next: null, rest: [] }, 'nothing left to show');
});
