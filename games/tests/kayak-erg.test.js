// The rowing club's ergs (erg.js): a 500 m piece, power from the strokes,
// pace from power the way rowing machines work it out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERG, createErg, stepErg, monitor, paceOf, speedOf, ergPose, ergResult } from '../reading-thames/erg.js';

const DT = 1 / 60;
function piece(rate, { pace = null, max = 400 } = {}) {
  const erg = createErg({ pace });
  const events = [];
  let next = 0;
  for (let t = 0; t < max && erg.done === null; t += DT) {
    const strokes = t >= next ? ((next += 60 / rate), ['left', 'right']) : [];
    events.push(...stepErg(erg, DT, { strokes }));
  }
  return { erg, events };
}

test('the pace from power, as on a real monitor: 2:00 a 500 m is about 203 watts', () => {
  assert.ok(Math.abs(paceOf(203) - 120) < 0.5);
  assert.ok(Math.abs(speedOf(203) - 500 / 120) < 0.02);
  assert.equal(paceOf(0), null);
});

test('a 500 m: about 2:28 at an easy 20, 2:03 at 30, and quicker still rating up', () => {
  const easy = piece(20).erg;
  const firm = piece(30).erg;
  const flat = piece(38).erg;
  assert.ok(easy.done > 140 && easy.done < 155, `20: ${easy.done}`);
  assert.ok(firm.done > 118 && firm.done < 128, `30: ${firm.done}`);
  assert.ok(flat.done < firm.done, `38: ${flat.done}`);
  assert.equal(monitor(firm).metres, 500);
  assert.equal(monitor(firm).left, 0);
  assert.ok(flat.stamina < 0.2, 'rating high tires you');
});

test("both hands together are one stroke; a stroke can't come before the recovery's done", () => {
  const erg = createErg();
  stepErg(erg, DT, { strokes: ['left', 'right'] });
  assert.equal(erg.strokes, 1);
  for (let t = 0; t < 0.4; t += DT) stepErg(erg, DT, {}); // past the other hand, still on the drive
  assert.deepEqual(stepErg(erg, DT, { strokes: ['left'] }), ['rush']);
  assert.equal(erg.strokes, 1);
});

test('stop rowing and the wheel runs down; the clock waits for the first stroke', () => {
  const idle = createErg();
  for (let t = 0; t < 5; t += DT) stepErg(idle, DT, {});
  assert.equal(monitor(idle).time, 0);
  const { erg } = piece(30, { max: 30 });
  const going = erg.power;
  for (let t = 0; t < 8; t += DT) stepErg(erg, DT, {});
  assert.ok(erg.power < going * 0.1, `${erg.power} from ${going}`);
});

test('the rower on the next erg keeps a steady pace to race', () => {
  const { erg } = piece(30, { pace: 120 });
  assert.ok(Math.abs(erg.other.metres - erg.done * (500 / 120)) < 5);
  assert.ok(monitor(erg).other > 0);
});

test('the rower on the erg: legs first at the catch, arms last; back up the slide on the recovery; easy when stopped', () => {
  const erg = createErg();
  stepErg(erg, DT, { strokes: ['left'] });
  const atCatch = ergPose(erg);
  assert.ok(atCatch.slide > 0.95 && atCatch.arms > 0.95);
  for (let t = 0; t < ERG.drive * 0.5; t += DT) stepErg(erg, DT, {});
  const mid = ergPose(erg);
  assert.ok(mid.slide < 0.6 && mid.arms > 0.9, 'legs down, arms still long');
  for (let t = 0; t < 6; t += DT) stepErg(erg, DT, {});
  const easy = ergPose(erg);
  assert.ok(easy.slide < 0.1, 'sat easy');
});

test('the other hand a few frames later is the same stroke; the next one after the recovery counts', () => {
  const erg = createErg();
  stepErg(erg, DT, { strokes: ['left'] });
  for (let i = 0; i < 6; i++) stepErg(erg, DT, {});
  stepErg(erg, DT, { strokes: ['right'] });
  assert.equal(erg.strokes, 1);
  for (let t = 0; t < 1.6; t += DT) stepErg(erg, DT, {});
  stepErg(erg, DT, { strokes: ['left', 'right'] });
  assert.equal(erg.strokes, 2);
});

test('the finish is timed inside the step it was crossed in, and strokes after it do nothing', () => {
  const erg = createErg();
  let next = 0;
  let t = 0;
  const step = 0.5; // a big step: the time still lands inside it
  for (; t < 400 && erg.done === null; t += step) {
    const strokes = t >= next ? ((next += 2), ['left', 'right']) : [];
    stepErg(erg, step, { strokes });
  }
  assert.ok(erg.done > erg.time - step - 1e-9 && erg.done <= erg.time + 1e-9, `${erg.done} in (${erg.time - step}, ${erg.time}]`);
  const strokes = erg.strokes;
  const done = erg.done;
  assert.deepEqual(stepErg(erg, 3, { strokes: ['left', 'right'] }), []);
  assert.equal(erg.strokes, strokes);
  assert.equal(erg.done, done, 'the monitor holds the time');
});

test('out of legs, rating high pulls little more than rating easy', () => {
  const fresh = createErg();
  const tired = createErg();
  tired.stamina = 0;
  for (const erg of [fresh, tired]) {
    stepErg(erg, DT, { strokes: ['left'] });
    for (let t = 0; t < 1.5; t += DT) stepErg(erg, DT, {});
    stepErg(erg, DT, { strokes: ['left'] }); // 40 a minute
  }
  assert.ok(tired.stroke < fresh.stroke, `${tired.stroke} against ${fresh.stroke}`);
});

test("the result: the time, a new best or the old one, and whether you beat the rower next to you", () => {
  assert.deepEqual(ergResult(118.4, null, 470), { text: '500 m in 1:58.4. You beat the rower next to you.', record: true });
  assert.deepEqual(ergResult(115.2, 118.4, 500), { text: '500 m in 1:55.2, a new best!', record: true });
  assert.deepEqual(ergResult(121, 118.4, 500), { text: '500 m in 2:01.0. Your best: 1:58.4.', record: false });
});
