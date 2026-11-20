// The courses on the menu: all on the one real river at Reading, each known to
// the server's leaderboards, and the Hasler courses' turns and portage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { courseFromFile, pointAt, locate, widthAt } from '../reading-thames/course.js';
import { createRace, stepRace, standings, PORTAGE, portageTime, DIVISION_9, DIVISION_3 } from '../reading-thames/race.js';

const DT = 1 / 120;
const balance = (b) => Math.max(-1, Math.min(1, -(b.roll * 2 + b.rollRate * 0.6)));
const read = async (path) => readFile(new URL(path, import.meta.url), 'utf8');
const data = async (id) => JSON.parse(await read(`../reading-thames/courses/${id}.json`));

// The menu's courses, from main.js's MODES (it runs in a browser, so read as text).
async function modes() {
  const src = await read('../reading-thames/main.js');
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
  const server = Object.fromEntries([...list.matchAll(/'?([\w-]+)'?: (\d+)/g)].map(([, k, v]) => [k, +v]));
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
  // Three seeds: what each race does is the same in all (everyone finishes, the
  // route, the times), how many swim isn't. It passes the crowd of swans by
  // Reading Rowing Club twice (SWAN_GRACE in birds.js), and where the swims fall
  // moves from race to race with the smallest change to the river: with the
  // traffic eased all along it (#984) seed 1 went from 2 swims to 7 and seed 10
  // from 7 to 2, none of the difference by traffic. Over 12 seeds before and
  // after (24 races, measured 2026-11-20) a race averages 1.9 swims, standard
  // deviation 2.1: three races 5.6, give or take 3.6, so at most 13 (two
  // standard deviations over), a loose bound (a doubling of every race's swims
  // would still pass two times in three: tester), so what this course's changes
  // move is bounded tight: the swims traffic tips in (2 in 12 races, before and
  // after). Swimming twice in a race is #986's (the 6-7 swim races are pile-ups
  // on main too); three times is SWAN_GRACE broken.
  let [swims, byTraffic] = [0, 0];
  const each = [];
  for (const seed of [1, 2, 3]) {
    const race = createRace(course, { rivals: DIVISION_9, seed, format: 'interval' });
    while (race.time < 900 && race.racers.some((r) => r.ai && r.finish === null)) stepRace(race, DT, { strokes: [], lean: balance(race.player.boat) });
    const rivals = standings(race).filter((r) => r.ai);
    assert.ok(rivals.every((r) => r.finish !== null), `seed ${seed}: everyone finished`);
    assert.ok(rivals.every((r) => r.gate === race.gates.length), `seed ${seed}: through every gate`);
    const minutes = rivals.map((r) => (r.finish * course.warp) / 60);
    assert.ok(minutes[0] > 36 && minutes.at(-1) < 48, `seed ${seed}: ${minutes[0]}-${minutes.at(-1)} minutes`);
    const n = rivals.reduce((a, r) => a + r.boat.capsizes, 0);
    swims += n;
    const tipped = (r) => race.traffic.boats.filter((b) => b.hit.includes(r)).length;
    byTraffic += rivals.reduce((a, r) => a + tipped(r), 0);
    each.push(`seed ${seed}: ${n}, ${rivals.reduce((a, r) => a + tipped(r), 0)} by traffic`);
    // (Not twice, as before, but not again and again: SWAN_GRACE still holds.)
    assert.ok(rivals.every((r) => r.boat.capsizes <= 2), `seed ${seed}: ${rivals.filter((r) => r.boat.capsizes > 2).map((r) => `${r.name} ${r.boat.capsizes}`)}`);
  }
  assert.ok(swims <= 13, `${swims} swims in three races (${each.join('; ')})`);
  // What the river's traffic tips in, it does on its own: 2 in 12 races before and after #984.
  assert.ok(byTraffic <= 2, `${byTraffic} tipped in by traffic in three races (${each.join('; ')})`);
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

test("the Caversham Lady (the black trip boat along Piper's Island) stays off every route and out of the Island Bar's view from the main river", async () => {
  const reading = await data('reading');
  const river = courseFromFile(reading).scenery.river;
  const lady = reading.moorings.find((m) => m.kind === 'trip-boat' && m.paint === 'black');
  // Her deck, as course.js moors her: against her bank, 4.6 m in the beam.
  const c = pointAt(river, lady.s);
  const w = widthAt(river, lady.s).half - 4.6 / 2;
  const mid = [c.x - c.tz * lady.side * w, c.z + c.tx * lady.side * w];
  const deck = [-1, -0.5, 0, 0.5, 1].flatMap((k) => [-2.3, 2.3].map((b) => [mid[0] + c.tx * k * lady.length / 2 - c.tz * b, mid[1] + c.tz * k * lady.length / 2 + c.tx * b]));
  for (const id of ['loop', 'hasler79', 'hasler16']) {
    const route = courseFromFile(await data(id));
    const near = route.samples.filter((p) => Math.hypot(p.x - mid[0], p.z - mid[1]) < 80);
    const gap = Math.min(...near.flatMap((p) => deck.map(([x, z]) => Math.hypot(x - p.x, z - p.z))));
    assert.ok(!near.length || gap > 6, `${id}: ${gap.toFixed(1)} m from its racing line`);
  }
  // From the main river below the bar (the owner's reference view) she's beside it: at most a
  // tenth of it behind her (its far corner), where at s 614.9 she stood in front of half of it.
  const eye = [-495.3, -411.4];
  const bearing = ([x, z]) => (Math.atan2(x - eye[0], -(z - eye[1])) * 180) / Math.PI;
  const bar = reading.buildings.find((b) => b.style === 'island-bar').shape.map(bearing);
  const her = deck.map(bearing);
  const hidden = Math.max(0, Math.min(Math.max(...her), Math.max(...bar)) - Math.max(Math.min(...her), Math.min(...bar)));
  assert.ok(hidden <= (Math.max(...bar) - Math.min(...bar)) / 10, `her ${Math.min(...her).toFixed(0)}–${Math.max(...her).toFixed(0)}°, the bar ${Math.min(...bar).toFixed(0)}–${Math.max(...bar).toFixed(0)}°`);
});

test("rivals don't sit with their bow in the bank at an island's end: mass starts that never finished on main now do, with no one stuck a minute or backing off long", async () => {
  // At this DT on main: Loop seed 13 left three rivals at St Mary's Island's end
  // (1683 m) for the hour, seed 7 one at 4419 m; Hasler Div 1-6 seed 17 held
  // two at Fry's Island's end for 65-133 s.
  for (const [id, seed] of [['loop', 7], ['loop', 13], ['hasler16', 17]]) {
    const course = courseFromFile(await data(id));
    const race = createRace(course, { rivals: id === 'hasler16' ? DIVISION_3 : DIVISION_9, seed, format: 'mass', easy: true });
    const spot = new Map();
    const backing = new Map();
    let stuck = '';
    let backed = '';
    while (race.time < 1500 && race.racers.some((r) => r.ai && r.finish === null)) {
      stepRace(race, DT, { strokes: [], lean: balance(race.player.boat) });
      for (const r of race.racers) {
        if (!r.ai || r.finish !== null || r.boat.swim > 0 || r.portage) { spot.delete(r); backing.delete(r); continue; }
        const was = spot.get(r);
        if (!was || Math.abs(r.loc.s - was.s) > 3) spot.set(r, { s: r.loc.s, t: race.time });
        else if (race.time - was.t > 60 && !stuck) stuck = `${r.name} at ${r.loc.s.toFixed(0)} m since ${was.t.toFixed(0)} s`;
        // A back-off is short (BACK_OFF in race.js), and never far.
        if (!r.ai.backOff) { backing.delete(r); continue; }
        if (!backing.has(r)) backing.set(r, { t: race.time, s: r.loc.s });
        const b = backing.get(r);
        if (!backed && (race.time - b.t > 10 || b.s - r.loc.s > 20)) backed = `${r.name} backing ${(race.time - b.t).toFixed(0)} s, ${(b.s - r.loc.s).toFixed(0)} m at ${r.loc.s.toFixed(0)} m`;
      }
    }
    const left = race.racers.filter((r) => r.ai && r.finish === null).map((r) => `${r.name} at ${r.loc.s.toFixed(0)} m`);
    assert.deepEqual(left, [], `${id} seed ${seed}: everyone finished`);
    assert.equal(stuck, '', `${id} seed ${seed}: stuck`);
    assert.equal(backed, '', `${id} seed ${seed}: a long back-off`);
    // A finished rival isn't left holding a back-off (and its rudder over).
    assert.ok(race.racers.every((r) => !r.ai || r.finish === null || !r.ai.backOff), 'no back-off after the finish');
  }
});

// Every moored boat's deck, as course.js moors it: at its `at` along `dir`, or against its bank.
const BEAMS = { narrowboat: 2.1, cruiser: 3.4, 'trip-boat': 4.6, tatty: 3.4, houseboat: 4.6 };
function decks(reading) {
  const river = courseFromFile(reading).scenery.river;
  return reading.moorings.map((m) => {
    const c = pointAt(river, m.s);
    const beam = BEAMS[m.kind] ?? 2.1;
    const w = widthAt(river, m.s).half - beam / 2;
    const mid = m.at ?? [c.x - c.tz * m.side * w, c.z + c.tx * m.side * w];
    const [ux, uz] = m.dir ?? [c.tx, c.tz];
    const pts = [-1, -0.5, 0, 0.5, 1].flatMap((k) => [-beam / 2, beam / 2].map((b) => [mid[0] + ux * k * m.length / 2 - uz * b, mid[1] + uz * k * m.length / 2 + ux * b]));
    return { m, mid, pts };
  });
}

test('no moored boat lies on a racing line, a turning buoy or a gate, and no angler fishes over one', async () => {
  const reading = await data('reading');
  const boats = decks(reading);
  // Known and kept: the trip boat moored in Piper's Island's north channel, which the Hasler courses go up.
  const allow = { 600.7: "the trip boat in Piper's north channel" };
  for (const id of ['loop', 'hasler79', 'hasler16', 'practice']) {
    const route = courseFromFile(await data(id));
    for (const { m, mid, pts } of boats) {
      if (allow[m.s]) continue;
      const near = route.samples.filter((p) => Math.hypot(p.x - mid[0], p.z - mid[1]) < 60);
      if (!near.length) continue;
      const gap = Math.min(...near.flatMap((p) => pts.map(([x, z]) => Math.hypot(x - p.x, z - p.z))));
      assert.ok(gap > 2, `${id}: the ${m.kind} at ${m.s} m is ${gap.toFixed(1)} m from the racing line`);
    }
    const raw = await data(id);
    for (const mark of raw.marks ?? []) {
      const gap = Math.min(...boats.flatMap(({ pts }) => pts.map(([x, z]) => Math.hypot(x - mark.x, z - mark.z))));
      assert.ok(gap > 5, `${id}: a boat ${gap.toFixed(1)} m from the buoy at ${mark.x}, ${mark.z}`);
    }
    for (const g of raw.gates ?? []) {
      const p = pointAt(route, g.s);
      const gap = Math.min(...boats.flatMap(({ pts }) => pts.map(([x, z]) => Math.hypot(x - p.x, z - p.z))));
      assert.ok(gap > 5, `${id}: a boat ${gap.toFixed(1)} m from the gate "${g.label}"`);
    }
  }
  // And no angler fishes over a moored boat on their own bank.
  for (const a of reading.anglers ?? []) {
    const over = reading.moorings.find((m) => !m.at && m.side === a.side && Math.abs(m.s - a.s) < m.length / 2 + 4);
    assert.ok(!over, `the angler at ${a.s} m fishes over the ${over?.kind} at ${over?.s} m`);
  }
});
