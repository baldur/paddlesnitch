// Practice drills (drills.js): starts, wash hanging and the portage, each set
// up on its course and timed as a person would paddle it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { courseFromFile, headingAt, pointAt } from '../reading-thames/course.js';
import { wrap } from '../reading-thames/sim.js';
import { createRace, stepRace } from '../reading-thames/race.js';
import { DRILLS, setupDrill, trackDrill } from '../reading-thames/drills.js';

const DT = 1 / 120;
const balance = (b) => Math.max(-1, Math.min(1, -(b.roll * 2 + b.rollRate * 0.6)));
const load = async (id) => courseFromFile(JSON.parse(await readFile(new URL(`../reading-thames/courses/${id}.json`, import.meta.url), 'utf8')));

// A drill's race as main.js makes it: no swans or other boats.
async function drill(kind) {
  const course = await load(DRILLS[kind].course);
  const race = createRace(course, { rivals: DRILLS[kind].rivals, seed: 3, birds: false, traffic: false });
  race.player.boat.hull = { ...race.player.boat.hull, capsize: 10 };
  return { race, d: setupDrill(race, kind) };
}
// Steer along the course `lateral` off its line.
function rudder(race, lateral = 0) {
  const { boat, loc } = race.player;
  const aim = pointAt(race.course, loc.s + 12);
  const want = Math.atan2(aim.x - aim.tz * lateral - boat.x, -(aim.z + aim.tx * lateral - boat.z));
  const err = wrap(want - boat.heading);
  return Math.max(-1, Math.min(1, err * 3 - boat.yawRate * 0.5));
}
// Steer straight at another boat, as you would to sit on its wash.
function follow(boat, other) {
  const err = wrap(Math.atan2(other.x - boat.x, -(other.z - boat.z)) - boat.heading);
  return Math.max(-1, Math.min(1, err * 3 - boat.yawRate * 0.5));
}
function stepDrill(race, d, input) {
  const { events } = stepRace(race, DT, { lean: balance(race.player.boat), ...input });
  trackDrill(d, race, events, DT);
  return events;
}

test('starts: paddle up to the line and wait, then go on the horn: your reaction and your first 100 m', async () => {
  const { race, d } = await drill('start');
  const { boat } = race.player;
  let go = null;
  for (let t = 0; t < 300 && !d.done; t += DT) {
    // Up to the line and stop; on the horn, paddle hard after a 0.3 s reaction.
    const bow = race.player.loc.s + 3.3;
    let strokes = [];
    if (go === null && bow < race.start.line - 1.2 && boat.time - boat.lastStroke > 1.2) strokes = [boat.lastSide === 'left' ? 'right' : 'left'];
    if (go !== null && race.time - go > 0.3 && boat.time - boat.lastStroke > 0.55) strokes = [boat.lastSide === 'left' ? 'right' : 'left'];
    const events = stepDrill(race, d, { strokes, rudder: Math.max(-1, Math.min(1, wrap(headingAt(race.course, race.player.loc.s) - boat.heading) * 3)) });
    if (events.includes('go')) go = race.time;
  }
  assert.ok(d.done, d.readout);
  assert.ok(Math.abs(d.reaction - 0.3) < 0.05, `reaction ${d.reaction}`);
  assert.match(d.result.title, /^100 m in \d+\.\d s$/);
  // 100 m from a standing start, as shown: about 25-40 s at this pace.
  assert.ok(d.result.best > 20 && d.result.best < 45, `${d.result.best} s`);
  assert.ok(d.result.lines.some((l) => /of 5 at 100 m/.test(l)));
});

test('wash hanging: sit on the pacer and the seconds count; stop paddling and you fall off, metres back', async () => {
  const { race, d } = await drill('wash');
  const { pacer } = d;
  const me = race.player;
  // Keep station about 6 m behind the pacer: paddle when dropping back.
  let next = 0;
  for (let t = 0; t < 20; t += DT) {
    const gap = pacer.loc.s - me.loc.s;
    const strokes = me.boat.time >= next && gap > 6 * race.course.speedup / 4 ? [me.boat.lastSide === 'left' ? 'right' : 'left'] : [];
    if (strokes.length) next = me.boat.time + 0.62;
    stepDrill(race, d, { strokes, rudder: follow(me.boat, pacer.boat) });
  }
  assert.ok(d.best > 30, `held it ${d.best} s as shown`);
  assert.match(d.readout, /^On the wash/);
  // Stop paddling: off it, and told how far back.
  for (let t = 0; t < 4; t += DT) stepDrill(race, d, { strokes: [], rudder: follow(me.boat, pacer.boat) });
  assert.match(d.readout, /^Off the wash: \d+\.\d m back/);
  assert.equal(d.streak, 0);
});

test('the portage drill: slow in, jump out, run, jump in and paddle away, with a split for each', async () => {
  const { race, d } = await drill('portage');
  const r = race.player;
  const { p } = d;
  let next = 0;
  let phase = 'in';
  for (let t = 0; t < 200 && !d.done; t += DT) {
    const at = pointAt(race.course, p.from);
    const togo = Math.hypot(at.x - r.boat.x, at.z - r.boat.z);
    let strokes = [];
    if (!r.portage && !r.portaged?.has(0)) {
      // Paddle in, ease off 40 m out, and jump out once slow.
      if (togo > 40 && r.boat.time >= next) strokes = [r.boat.lastSide === 'left' ? 'right' : 'left'];
      if (togo < 12 && r.boat.speed < 1.4) strokes = ['left', 'right'];
    } else if (r.portage?.phase === 'run' && r.boat.time >= next) strokes = [r.boat.lastSide === 'left' ? 'right' : 'left'];
    else if (r.portage?.phase === 'put') strokes = ['left', 'right'];
    else if (!r.portage && r.boat.time >= next && r.boat.time > (r.settle ?? 0)) strokes = [r.boat.lastSide === 'left' ? 'right' : 'left'];
    if (strokes.length === 1) {
      next = r.boat.time + (r.portage ? 1 / 3 : 0.62);
      r.boat.lastSide = strokes[0];
    }
    phase = r.portage?.phase ?? phase;
    stepDrill(race, d, { strokes, rudder: r.portage ? 0 : rudder(race) });
  }
  assert.ok(d.done, d.readout);
  const [beach, run, back, away] = d.result.lines.map((l) => Number(l.match(/(\d+\.\d) s/)[1]));
  assert.ok(Math.abs(beach + run + back + away - d.result.best) < 0.3, d.result.lines.join(' / '));
  assert.ok(run > 40 && run < 65, `run ${run} s`);
  assert.ok(back >= 2.9 && back < 5, `back in ${back} s`);
  assert.doesNotMatch(d.result.lines[0], /aground/);
});
