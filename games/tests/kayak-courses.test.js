// The courses on the menu: all on the one real river at Reading, each known to
// the server's leaderboards, and the Hasler courses' turns and portage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { courseFromFile, pointAt, locate } from '../kayak/course.js';
import { createRace, stepRace, standings, PORTAGE, portageTime, DIVISION_9, DIVISION_3 } from '../kayak/race.js';

const DT = 1 / 120;
const balance = (b) => Math.max(-1, Math.min(1, -(b.roll * 2 + b.rollRate * 0.6)));
const read = async (path) => readFile(new URL(path, import.meta.url), 'utf8');
const data = async (id) => JSON.parse(await read(`../kayak/courses/${id}.json`));

// The menu's courses, from main.js's MODES (it runs in a browser, so read as text).
async function modes() {
  const src = await read('../kayak/main.js');
  const block = src.slice(src.indexOf('const MODES = {'), src.indexOf('};', src.indexOf('const MODES = {')));
  return [...block.matchAll(/^\s+(\w+): \{ file: 'courses\/(\w+)\.json'/gm)].map(([, key, file]) => ({ key, file }));
}

test('the menu offers the loop, both Hasler courses and practice, each from its own course file', async () => {
  assert.deepEqual((await modes()).map((m) => m.key), ['loop', 'hasler79', 'hasler16', 'practice']);
  for (const m of await modes()) assert.equal(m.file, m.key);
});

test("every course is on the server's list, at its distance: a wrong id or distance would fail every leaderboard submit", async () => {
  const core = await read('../../packages/core/src/games.ts');
  const list = core.slice(core.indexOf('export const GAME_COURSES = {'), core.indexOf('} as const', core.indexOf('export const GAME_COURSES')));
  const server = Object.fromEntries([...list.matchAll(/(\w+): (\d+)/g)].map(([, k, v]) => [k, +v]));
  for (const { key } of await modes()) {
    assert.ok(key in server, `${key} isn't in GAME_COURSES (packages/core/src/games.ts)`);
    const course = courseFromFile(await data(key));
    const metres = ((course.finish - course.start) * course.warp) / course.speedup;
    // The server refuses a time quicker than its distance at top speed allows:
    // its distance mustn't be much longer than the race really is.
    assert.ok(server[key] <= metres * 1.02 && server[key] >= metres * 0.9, `${key}: server ${server[key]} m, course ${Math.round(metres)} m`);
  }
});

test('every course draws the same river: the scenery is the Reading world, only the route and what is on it differ', async () => {
  const world = await data('reading');
  const own = new Set(['name', 'title', 'blurb', 'world', 'route', 'places', 'birds', 'gates', 'cues', 'marks']);
  for (const { key } of await modes()) {
    const c = await data(key);
    assert.equal(c.world, 'reading', key);
    for (const k of Object.keys(world)) if (!own.has(k)) assert.deepEqual(c[k], world[k], `${key}: ${k} differs from the world's`);
  }
});

test('Hasler Div 1-6 has one portage at Mapledurham, a run of 150 to 200 m over land', async () => {
  const course = courseFromFile(await data('hasler16'));
  assert.equal(course.portages.length, 1);
  const p = course.portages[0];
  assert.ok(p.to - p.from > 150 && p.to - p.from < 200, `${p.to - p.from} m`);
  // Out where the water ends, near the beach the owner gave (51.48366, -1.03732).
  const shore = course.shore;
  assert.ok(!shore.dry(pointAt(course, p.from).x, pointAt(course, p.from).z), 'you land from the water');
  assert.ok(shore.dry(pointAt(course, (p.from + p.to) / 2).x, pointAt(course, (p.from + p.to) / 2).z), 'the run is on land');
  assert.ok(!shore.dry(pointAt(course, p.to).x, pointAt(course, p.to).z), 'and you put in on the water');
  // Real time out, run and back in: about a minute.
  assert.ok(portageTime(p) > 50 && portageTime(p) < 80, `${portageTime(p)} s`);
});

// A Div 1-6 race on its own, the player `back` metres below the beach, at `speed`.
async function atTheBeach(back = 30, speed = 0) {
  const course = courseFromFile(await data('hasler16'));
  const race = createRace(course, { rivals: [], seed: 1, birds: false, traffic: false });
  const r = race.player;
  const p = course.portages[0];
  const at = pointAt(course, p.from - back);
  Object.assign(r.boat, { x: at.x, z: at.z, heading: Math.atan2(at.tx, -at.tz), speed, speedup: course.speedup });
  r.boat.hull = { ...r.boat.hull, capsize: 10 };
  r.loc = locate(course, at.x, at.z, course.samples.findIndex((q) => q.s >= p.from - back));
  race.start.phase = 'go';
  r.gate = race.gates.findIndex((g) => g.s > p.from);
  return { course, race, r, p };
}
// Paddling along the route (steering for a point 12 m on), `seconds` of race time.
function paddle(race, seconds, { off = 0 } = {}) {
  const r = race.player;
  const events = [];
  let next = 0;
  for (let t = 0; t < seconds; t += DT) {
    const aim = pointAt(race.course, r.loc.s + 12);
    const want = Math.atan2(aim.x - aim.tz * off - r.boat.x, -(aim.z + aim.tx * off - r.boat.z));
    const err = Math.atan2(Math.sin(want - r.boat.heading), Math.cos(want - r.boat.heading));
    const strokes = r.boat.time >= next ? [r.boat.lastSide === 'left' ? 'right' : 'left'] : [];
    if (strokes.length) next = r.boat.time + 0.7;
    events.push(...stepRace(race, DT, { strokes, rudder: Math.max(-1, Math.min(1, err * 3 - r.boat.yawRate * 0.5)), lean: balance(r.boat) }).events);
  }
  return events;
}
// `seconds` of race time doing nothing but `strokes` once (both sides together: a jump).
function hold(race, seconds, strokes = []) {
  const events = [...stepRace(race, DT, { strokes, lean: balance(race.player.boat) }).events];
  for (let t = DT; t < seconds; t += DT) events.push(...stepRace(race, DT, { strokes: [], lean: balance(race.player.boat) }).events);
  return events;
}
// Tapping strides, `rate` a second, until `until` (or `seconds` of race time).
function run(race, rate, seconds, until = () => false) {
  const r = race.player;
  const events = [];
  let next = r.boat.time;
  for (let t = 0; t < seconds && !until(); t += DT) {
    const strokes = r.boat.time >= next ? [r.boat.lastSide === 'left' ? 'right' : 'left'] : [];
    if (strokes.length) {
      next += 1 / rate;
      r.boat.lastSide = strokes[0];
    }
    events.push(...stepRace(race, DT, { strokes, lean: 0 }).events);
  }
  return events;
}
const BOTH = ['left', 'right'];
const shown = (race, from) => (race.time - from) * race.course.warp;

test('at the beach you jump out (both sides together, slowly), run it by tapping, and jump back in at the put-in', async () => {
  const { race, r, p } = await atTheBeach(8);
  // Coming up to it: told what to do.
  assert.ok(hold(race, 0.05).includes('beach'));
  assert.ok(hold(race, 0.05, BOTH).includes('landed'), 'out');
  assert.equal(r.portage.phase, 'out');
  // Getting out takes a moment; then you run, only as you tap.
  assert.ok(hold(race, PORTAGE.out / race.course.warp + 0.05).includes('run'));
  hold(race, 1);
  assert.ok(r.portage.d < 0.01, "no taps, you don't go anywhere");
  const from = race.time;
  const events = run(race, 3, 60, () => r.portage?.phase === 'put');
  assert.ok(events.includes('at-put-in'));
  // 3 taps a second is 3.5 m/s: about 50 s along the bank, as shown.
  const runSeconds = shown(race, from);
  assert.ok(runSeconds > (p.to - p.from) / 3.6 && runSeconds < (p.to - p.from) / 3.2, `${runSeconds} s for ${p.to - p.from} m`);
  // At the put-in you wait for yourself: strides don't get you in.
  hold(race, 0.3);
  run(race, 3, 1);
  assert.equal(r.portage.phase, 'put');
  hold(race, 0.05, BOTH);
  assert.equal(r.portage.phase, 'in');
  assert.ok(hold(race, PORTAGE.in / race.course.warp + 0.05).includes('put-in'));
  assert.equal(r.portage, null);
  assert.equal(r.boat.speed, 0, 'afloat at the put-in, from a standstill');
  assert.ok(Math.abs(r.loc.s - p.to) < 3);
  // And on down the river.
  paddle(race, 15);
  assert.ok(r.loc.s > p.to + 60, `on to ${r.loc.s}`);
  assert.equal(r.missed, undefined);
});

test('come into the beach too fast and you run aground: stuck a few seconds before you can get out', async () => {
  const { race, r } = await atTheBeach(10, 3);
  const events = [];
  for (let t = 0; t < 2 && !r.portage; t += DT) events.push(...hold(race, DT));
  assert.ok(events.includes('aground'));
  assert.equal(r.portage.phase, 'aground');
  hold(race, 0.05, BOTH);
  assert.equal(r.portage.phase, 'aground', "can't get out while stuck");
  hold(race, PORTAGE.stuck / race.course.warp);
  assert.equal(r.portage.phase, 'beached');
  assert.ok(hold(race, 0.05, BOTH).includes('landed'));
});

test("trying to jump out while still going too quick (but not aground yet) doesn't work", async () => {
  const { race, r } = await atTheBeach(11, 2.5);
  const events = hold(race, 0.02, BOTH);
  assert.ok(events.includes('too-fast'));
  assert.equal(r.portage ?? null, null);
});

test('running: a jog at 2 taps a second for free, quicker costs your sprint stamina, and out of it you can only jog', async () => {
  const speedAt = async (rate, stamina = 1) => {
    const { race, r } = await atTheBeach(5);
    hold(race, 0.02, BOTH);
    hold(race, PORTAGE.out / race.course.warp + 0.05);
    r.boat.stamina = stamina;
    run(race, rate, 3);
    return { v: r.portage.v, stamina: r.boat.stamina };
  };
  const jog = await speedAt(2);
  const fast = await speedAt(3);
  const tired = await speedAt(3, 0);
  assert.ok(Math.abs(jog.v - 2.5) < 0.15, `jog ${jog.v}`);
  assert.ok(jog.stamina > 0.999, `stamina ${jog.stamina}`);
  assert.ok(Math.abs(fast.v - 3.5) < 0.15, `fast ${fast.v}`);
  assert.ok(fast.stamina < 0.95, `stamina ${fast.stamina}`);
  assert.ok(Math.abs(tired.v - 2.5) < 0.15, `tired ${tired.v}`);
});

test('back in, the boat wobbles: sit still and it settles, paddle at once and it rocks harder', async () => {
  const roll = async (strokes) => {
    const { race, r, p } = await atTheBeach(5);
    hold(race, 0.02, BOTH);
    hold(race, PORTAGE.out / race.course.warp + 0.05);
    run(race, 3, 60, () => r.portage?.phase === 'put');
    hold(race, 0.02, BOTH);
    hold(race, PORTAGE.in / race.course.warp + 0.05);
    assert.equal(r.portage, null);
    let worst = 0;
    const events = [];
    for (let t = 0; t < 1; t += DT) {
      events.push(...stepRace(race, DT, { strokes: t < 0.6 && strokes && Math.round(t / DT) % 30 === 0 ? [Math.round(t / DT) % 60 ? 'left' : 'right'] : [], lean: 0 }).events);
      worst = Math.max(worst, Math.abs(r.boat.roll));
    }
    return { worst, events, p };
  };
  const still = await roll(false);
  const rushed = await roll(true);
  assert.ok(still.worst > 0.03, 'a wobble as you sit');
  assert.ok(rushed.events.includes('rushed'));
  assert.ok(rushed.worst > still.worst * 1.3, `${rushed.worst} vs ${still.worst}`);
});

test('paddle on past the beach without landing and you have missed it, until you go back and run it', async () => {
  const { race, r, p } = await atTheBeach(120);
  // Keep to the far (east) side of the river, away from the beach, and on up.
  const s0 = r.loc.s;
  const course = race.course;
  const put = pointAt(course, p.to + 40);
  Object.assign(r.boat, { x: put.x, z: put.z, heading: Math.atan2(put.tx, -put.tz) });
  r.loc = locate(course, put.x, put.z, course.samples.findIndex((q) => q.s >= p.to + 40));
  const events = paddle(race, 3);
  assert.ok(s0 < p.from && events.includes('missed'), 'skipping it is a miss');
  assert.match(r.missed.label, /beach/);
  // Gone back and run it: no longer missed.
  const back = pointAt(course, p.from);
  Object.assign(r.boat, { x: back.x, z: back.z, speed: 0 });
  r.loc = locate(course, back.x, back.z, course.samples.findIndex((q) => q.s >= p.from - 5));
  hold(race, 0.02, BOTH);
  hold(race, PORTAGE.out / race.course.warp + 0.05);
  run(race, 3, 60, () => r.portage?.phase === 'put');
  hold(race, 0.02, BOTH);
  hold(race, PORTAGE.in / race.course.warp + 0.05);
  assert.ok(r.portaged.has(0));
  assert.equal(r.missed, null);
});

test('carried along the bank, a boat on the water beside you never bumps you', async () => {
  const course = courseFromFile(await data('hasler16'));
  const race = createRace(course, { rivals: DIVISION_9.slice(0, 1), seed: 1, birds: false, traffic: false });
  race.start.phase = 'go';
  const [you, rival] = [race.player, race.racers.find((r) => r.ai)];
  you.portage = { k: 0, phase: 'run', t: 0, d: 50, v: 3, target: 3 }; // mid-run
  you.portaged = new Set();
  for (let t = 0; t < 2; t += DT) {
    // The rival kept right alongside, wherever the run takes you.
    Object.assign(rival.boat, { x: you.boat.x + 0.3, z: you.boat.z, heading: you.boat.heading, speed: 2 });
    rival.loc = locate(course, rival.boat.x, rival.boat.z, you.loc.i);
    assert.ok(!stepRace(race, DT, { strokes: [], lean: 0 }).events.includes('bump'));
  }
  assert.ok(you.portage, 'still running');
});

test('Div 1-6 as a time trial: every rival coasts in, jumps out, runs the bank and gets back in, and nobody runs aground', async () => {
  const course = courseFromFile(await data('hasler16'));
  const race = createRace(course, { rivals: DIVISION_3, seed: 1, format: 'interval' });
  const aground = new Set();
  while (race.time < 1600 && race.racers.some((r) => r.ai && r.finish === null)) {
    stepRace(race, DT, { strokes: [], lean: balance(race.player.boat) });
    for (const r of race.racers) if (r.portage?.phase === 'aground') aground.add(r.name);
  }
  const rivals = race.racers.filter((r) => r.ai);
  assert.ok(rivals.every((r) => r.finish !== null && r.portaged.has(0)), 'all ran it and finished');
  assert.deepEqual([...aground], []);
});

test('Hasler Div 7-9 as a time trial: the pack goes round Appletree Eyot and Fry\'s Island, right of Piper\'s both ways, and all finish', async () => {
  const course = courseFromFile(await data('hasler79'));
  const km = ((course.finish - course.start) * course.warp) / course.speedup / 1000;
  assert.ok(km > 7.7 && km < 8.1, `${km} km`);
  const race = createRace(course, { rivals: DIVISION_9, seed: 1, format: 'interval' });
  while (race.time < 900 && race.racers.some((r) => r.ai && r.finish === null)) stepRace(race, DT, { strokes: [], lean: balance(race.player.boat) });
  const rivals = standings(race).filter((r) => r.ai);
  assert.ok(rivals.every((r) => r.finish !== null), 'everyone finished');
  assert.ok(rivals.every((r) => r.gate === race.gates.length), 'through every gate');
  const minutes = rivals.map((r) => (r.finish * course.warp) / 60);
  assert.ok(minutes[0] > 36 && minutes.at(-1) < 48, `${minutes[0]}-${minutes.at(-1)} minutes`);
  // It passes the crowd of swans by Reading Rowing Club twice: a swim or two,
  // but nobody goes in again and again (SWAN_GRACE in birds.js).
  const caps = rivals.filter((r) => r.boat.capsizes).map((r) => `${r.name} ${r.boat.capsizes}`);
  // A swim each for a few, never two for anyone. (One seed: with the busier river of
  // 2026-10-31 this one has four, while 16 seeded races swam fewer than main's, 9 against 12.)
  assert.ok(caps.length <= 4 && rivals.every((r) => r.boat.capsizes <= 1), `swims: ${caps}`);
});

test('a mass start on a course that finishes where it starts: nobody "finishes" on the start line', async () => {
  for (const id of ['hasler79', 'hasler16', 'loop']) {
    const course = courseFromFile(await data(id));
    const race = createRace(course, { rivals: DIVISION_9, seed: 2 });
    assert.ok(race.racers.every((r) => r.loc.s < course.start + 10), `${id}: ${race.racers.map((r) => Math.round(r.loc.s))}`);
  }
});

test('a portage as shown: out, along the bank at a pace, back in', () => {
  assert.equal(portageTime({ from: 0, to: 150 }), PORTAGE.out + 150 / 3 + PORTAGE.in);
  assert.equal(portageTime({ from: 0, to: 150 }, 2.5), PORTAGE.out + 60 + PORTAGE.in);
});
