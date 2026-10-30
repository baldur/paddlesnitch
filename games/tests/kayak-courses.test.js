// The courses on the menu: all on the one real river at Reading, each known to
// the server's leaderboards, and the Hasler courses' turns and portage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { courseFromFile, pointAt, locate } from '../kayak/course.js';
import { createRace, stepRace, standings, PORTAGE, portageTime, DIVISION_9 } from '../kayak/race.js';

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

// A Div 1-6 race on its own, the player put just below the beach.
async function atTheBeach(back = 30) {
  const course = courseFromFile(await data('hasler16'));
  const race = createRace(course, { rivals: [], seed: 1, birds: false, traffic: false });
  const r = race.player;
  const p = course.portages[0];
  const at = pointAt(course, p.from - back);
  Object.assign(r.boat, { x: at.x, z: at.z, heading: Math.atan2(at.tx, -at.tz), speed: 0, speedup: course.speedup });
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

test('at the beach you land, run along the bank with the boat and put in again, a minute later as shown', async () => {
  const { race, r, p, course } = await atTheBeach();
  const landed = [];
  let events = [];
  for (let t = 0; t < 20 && !r.portage; t += DT) events = paddle(race, DT);
  assert.ok(r.portage, 'landed at the beach');
  const from = race.time;
  // While carried, strokes do nothing and you follow the run along the bank.
  while (r.portage) {
    landed.push(r.loc.s);
    events.push(...stepRace(race, DT, { strokes: ['left'], lean: 0 }).events);
  }
  assert.ok(events.includes('put-in'));
  const shownSeconds = (race.time - from) * course.warp;
  assert.ok(Math.abs(shownSeconds - portageTime(p)) < 1, `${shownSeconds} s as shown`);
  assert.ok(Math.min(...landed) >= p.from - 0.5 && Math.max(...landed) <= p.to + 1.5, `${Math.min(...landed)}-${Math.max(...landed)} for ${p.from}-${p.to}`);
  assert.equal(r.boat.speed, 0, 'afloat at the put-in, from a standstill');
  // And on down the river.
  paddle(race, 15);
  assert.ok(r.loc.s > p.to + 60, `on to ${r.loc.s}`);
  assert.equal(r.missed, undefined);
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
  for (let t = 0; t < 120 && !r.portaged?.has(0); t += DT) stepRace(race, DT, { strokes: [], lean: 0 });
  assert.ok(r.portaged.has(0));
  assert.equal(r.missed, null);
});

test('carried along the bank, a boat on the water beside you never bumps you', async () => {
  const course = courseFromFile(await data('hasler16'));
  const race = createRace(course, { rivals: DIVISION_9.slice(0, 1), seed: 1, birds: false, traffic: false });
  race.start.phase = 'go';
  const [you, rival] = [race.player, race.racers.find((r) => r.ai)];
  you.portage = { k: 0, t: PORTAGE.out + 5 }; // mid-run
  you.portaged = new Set();
  for (let t = 0; t < 2; t += DT) {
    // The rival kept right alongside, wherever the run takes you.
    Object.assign(rival.boat, { x: you.boat.x + 0.3, z: you.boat.z, heading: you.boat.heading, speed: 2 });
    rival.loc = locate(course, rival.boat.x, rival.boat.z, you.loc.i);
    assert.ok(!stepRace(race, DT, { strokes: [], lean: 0 }).events.includes('bump'));
  }
  assert.ok(you.portage, 'still running');
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
  assert.ok(caps.length <= 3 && rivals.every((r) => r.boat.capsizes <= 1), `swims: ${caps}`);
});

test('a mass start on a course that finishes where it starts: nobody "finishes" on the start line', async () => {
  for (const id of ['hasler79', 'hasler16', 'loop']) {
    const course = courseFromFile(await data(id));
    const race = createRace(course, { rivals: DIVISION_9, seed: 2 });
    assert.ok(race.racers.every((r) => r.loc.s < course.start + 10), `${id}: ${race.racers.map((r) => Math.round(r.loc.s))}`);
  }
});

test('the run itself takes everyone the same: out, along the bank at a jog, back in', () => {
  assert.equal(portageTime({ from: 0, to: 150 }), PORTAGE.out + 150 / PORTAGE.run + PORTAGE.in);
});
