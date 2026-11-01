// The canoe club's kayak erg (kayak-erg.js): paddled like the boat, a stroke
// each side in turn; a 500 m piece, sprints spend stamina.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KAYAK_ERG, createKayakErg, stepKayakErg, kayakErgNumbers, ergPaddle } from '../reading-thames/kayak-erg.js';

const DT = 1 / 60;
// A 500 m at a steady `rate` (strokes a minute, both sides counted).
function piece(rate, { sides = ['left', 'right'], max = 400 } = {}) {
  const erg = createKayakErg();
  const events = [];
  let next = 0;
  let n = 0;
  for (let t = 0; t < max && erg.done === null; t += DT) {
    const strokes = t >= next ? ((next += 60 / rate), [sides[n++ % sides.length]]) : [];
    events.push(...stepKayakErg(erg, DT, { strokes }));
  }
  return { erg, events };
}

test('a 500 m: about 2:38 at an easy 60, 2:13 at a steady 90, quicker sprinting', () => {
  const easy = piece(60).erg;
  const steady = piece(90).erg;
  const sprint = piece(110).erg;
  assert.ok(easy.done > 148 && easy.done < 168, `60: ${easy.done}`);
  assert.ok(steady.done > 126 && steady.done < 140, `90: ${steady.done}`);
  assert.ok(sprint.done < steady.done, `110: ${sprint.done}`);
  assert.equal(kayakErgNumbers(steady).left, 0);
  assert.ok(Math.abs(kayakErgNumbers(steady).rate - 90) <= 1);
});

test("up to 90 a minute costs nothing; a sprint empties you, and empty it's no quicker than 90", () => {
  assert.equal(piece(90).erg.stamina, 1);
  const flat = piece(140).erg;
  assert.equal(flat.stamina, 0);
  // Flat out from the start, you run dry and finish barely ahead of a steady 90.
  assert.ok(flat.done > piece(90).erg.done - 15, `140: ${flat.done}`);
});

test('the same side twice is a weak stroke, as in the boat', () => {
  const { erg, events } = piece(90, { sides: ['left'] });
  assert.ok(events.includes('weak'));
  assert.ok(erg.done > piece(90).erg.done + 20, `one side: ${erg.done}`);
});

test("taps quicker than a stroke can be don't count; the clock waits for the first stroke", () => {
  const erg = createKayakErg();
  for (let t = 0; t < 3; t += DT) stepKayakErg(erg, DT, {});
  assert.equal(kayakErgNumbers(erg).time, 0);
  stepKayakErg(erg, DT, { strokes: ['left'] });
  stepKayakErg(erg, DT, { strokes: ['right'] });
  assert.equal(erg.strokes, 1);
  assert.ok(KAYAK_ERG.quickest > 2 * DT);
});

test("tapping left, right quicker than the erg counts isn't called a weak stroke", () => {
  const erg = createKayakErg();
  const events = [];
  for (let i = 0; i < 20; i++) {
    events.push(...stepKayakErg(erg, 0.2, { strokes: [i % 2 ? 'right' : 'left'] }));
  }
  assert.ok(!events.includes('weak'), events.join());
  assert.ok(erg.strokes > 5 && erg.strokes < 20);
});

test('a sprint is worth about the same whenever you spend it, as in the boat: empty, quicker than 90 pulls as 90', () => {
  const run = (rateAt) => {
    const erg = createKayakErg();
    let next = 0;
    let n = 0;
    for (let t = 0; t < 400 && erg.done === null; t += DT) {
      const strokes = t >= next ? ((next += 60 / rateAt(erg)), [n++ % 2 ? 'right' : 'left']) : [];
      stepKayakErg(erg, DT, { strokes });
    }
    return erg.done;
  };
  const steady = run(() => 90);
  const allOut = run(() => 110);
  const finish = run((e) => (e.metres > 500 - 40 * 4.1 ? 110 : 90));
  assert.ok(finish < steady - 2 && allOut < steady - 2, `sprint at the end ${finish}, steady ${steady}, all out ${allOut}`);
  assert.ok(Math.abs(finish - allOut) < 2);
});

test('stop paddling and the wheel runs down', () => {
  const { erg } = piece(90, { max: 30 });
  const going = erg.power;
  for (let t = 0; t < 8; t += DT) stepKayakErg(erg, DT, {});
  assert.ok(erg.power < going * 0.1, `${erg.power} from ${going}`);
  assert.equal(erg.rate, 0);
});

test("the paddler's stroke for drawing: the last side and when", () => {
  const erg = createKayakErg();
  assert.equal(ergPaddle(erg).side, null);
  stepKayakErg(erg, DT, { strokes: ['right'] });
  assert.deepEqual(ergPaddle(erg), { at: 0, side: 'right' });
});
