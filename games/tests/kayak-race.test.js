import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoat, step } from '../reading-thames/sim.js';
import { readFile } from 'node:fs/promises';
import { raceRiver, courseFromFile, pointAt, locate, headingAt, widthAt } from '../reading-thames/course.js';
import { wrap } from '../reading-thames/sim.js';
import { createRace, stepRace, standings, started, wash, elapsed, applyCall, washSlots, washMarks, SLOTS, DIVISION_9 } from '../reading-thames/race.js';

const DT = 1 / 120;
const balance = (b) => Math.max(-1, Math.min(1, -(b.roll * 2 + b.rollRate * 0.6)));

const nearestGap = (race) => race.gaps.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));

// The player's input for one step: paddle up into the nearest gap on the start
// line at `interval` seconds a stroke, then sit still on it (or, with
// `through`, keep going over it).
function lineUp(race, { interval = 0.75, through = false } = {}) {
  const { boat, loc } = race.player;
  const bow = loc.s + 3.3;
  const strokes = [];
  if ((through || bow < race.start.line - 1.2) && boat.time - boat.lastStroke >= (bow > race.start.line - 4 ? 1.2 : interval)) {
    strokes.push(boat.lastSide === 'left' ? 'right' : 'left');
  }
  // Head for the gap's lane, then straighten up along the river.
  const along = headingAt(race.course, loc.s);
  const want = along + Math.max(-0.35, Math.min(0.35, (nearestGap(race) - loc.lateral) * 0.2));
  const err = wrap(want - boat.heading);
  return { strokes, rudder: Math.max(-1, Math.min(1, err * 3 - boat.yawRate * 0.5)), lean: balance(boat) };
}

// A boat at (0, 0) heading up -z at racing speed, and a point relative to it.
const leader = () => Object.assign(createBoat(), { speed: 3.6 });
const at = (right, ahead) => createBoat({ x: right, z: -ahead });

test('a division race shows 6 km and squeezes it into a quarter of the time', () => {
  const course = raceRiver();
  assert.equal((course.finish - course.start) * course.warp, 6000);
  assert.equal(course.warp, 4);
});

test('the wash helps right behind the stern and on the hip, nowhere else', () => {
  const l = leader();
  const stern = wash(at(0, -6.3), l);
  const hip = wash(at(1.4, -4.2), l);
  const wide = wash(at(6, -4), l);
  const ahead = wash(at(0, 8), l);
  assert.ok(stern.draft > 0.8, `stern ${stern.draft}`);
  assert.ok(hip.draft > 0.7, `hip ${hip.draft}`);
  assert.ok(hip.rock > stern.rock, 'the hip rocks more than tucking in behind');
  assert.equal(wide.draft, 0);
  assert.equal(ahead.draft, 0);
  assert.equal(wash(at(0, -6.3), createBoat()).draft, 0, 'a boat sitting still makes no wash');
});

test('riding a wash is faster for the same effort', () => {
  const paddle = (draft) => {
    const boat = createBoat();
    let next = 0;
    let side = 'left';
    for (let t = 0; t < 30; t += DT) {
      const strokes = [];
      if (t >= next) { strokes.push(side); side = side === 'left' ? 'right' : 'left'; next += 0.7; }
      step(boat, DT, { strokes, lean: balance(boat), draft });
    }
    return boat.speed;
  };
  assert.ok(paddle(1) > paddle(0) * 1.1);
});

test('touching hulls are pushed apart and count as one bump', () => {
  const course = raceRiver();
  const race = createRace(course, { rivals: DIVISION_9.slice(0, 1) });
  const [a, b] = race.racers.map((r) => r.boat);
  b.x = a.x + Math.cos(a.heading) * 0.3; // side by side, overlapping
  b.z = a.z + Math.sin(a.heading) * 0.3;
  b.heading = a.heading;
  const bumps = [];
  for (let i = 0; i < 30; i++) bumps.push(...stepRace(race, DT, { strokes: [], lean: balance(race.player.boat) }).events);
  assert.equal(bumps.filter((e) => e === 'bump').length, 1);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 0.47);
});

test('a pack of rivals races a full 6 km without capsizing, finishing in about 31 minutes', () => {
  const course = raceRiver();
  const race = createRace(course, { rivals: DIVISION_9, seed: 3 });
  // The player comes up to the line, then just sits there.
  for (let t = 0; !started(race); t += DT) {
    assert.ok(t < 60, 'the start never came');
    stepRace(race, DT, lineUp(race));
  }
  while (race.time < 600 && race.racers.some((r) => r.ai && r.finish === null)) {
    stepRace(race, DT, { strokes: [], lean: balance(race.player.boat) });
  }
  const rivals = standings(race).filter((r) => r.ai);
  assert.ok(rivals.every((r) => r.finish !== null), 'everyone finished');
  const minutes = rivals.map((r) => (r.finish * course.warp) / 60);
  assert.ok(minutes[0] > 29 && minutes[0] < 33, `winner ${minutes[0]}`);
  assert.ok(minutes.at(-1) < 36, `last ${minutes.at(-1)}`);
  // The pack never tips itself in; the river's traffic may, now and then (here an eight).
  const tipped = rivals.filter((r) => r.boat.capsizes > 0);
  assert.ok(tipped.every((r) => race.traffic.boats.some((b) => b.hit.includes(r))), `swims not from traffic: ${tipped.map((r) => r.name)}`);
  assert.ok(tipped.length <= 1, `${tipped.length} tipped in`);
  assert.equal(standings(race).at(-1), race.player, 'a player who never paddles comes last');
});

test('standings put finishers first, then whoever is furthest along', () => {
  const course = raceRiver();
  const race = createRace(course, { rivals: DIVISION_9.slice(0, 2) });
  const [a, b, c] = race.racers;
  const place = (r, s) => {
    const p = pointAt(course, s);
    Object.assign(r.boat, { x: p.x, z: p.z });
    r.loc = locate(course, p.x, p.z);
  };
  place(a, 500);
  place(b, 900);
  place(c, 300);
  c.finish = 100;
  assert.deepEqual(standings(race), [c, b, a]);
});

test('the horn comes after "Are you ready?", at an unpredictable moment', () => {
  const waits = new Set();
  for (const seed of [1, 2, 3]) {
    const race = createRace(raceRiver(), { rivals: DIVISION_9, seed });
    const calls = [];
    let t = 0;
    while (!started(race)) {
      assert.ok(t < 60, 'the start never came');
      for (const e of stepRace(race, DT, lineUp(race)).events) if (!['stroke', 'weak', 'bump'].includes(e)) calls.push([e, t]);
      t += DT;
    }
    assert.deepEqual(calls.map(([e]) => e), ['line-up', 'ready', 'go']);
    waits.add((calls[2][1] - calls[1][1]).toFixed(1));
    assert.ok(race.time <= DT, 'the race clock starts at the horn');
  }
  assert.ok(waits.size > 1);
});

test('half the field waits on the line, the rest drift up to it, and you paddle into a gap', () => {
  const race = createRace(raceRiver(), { rivals: DIVISION_9, seed: 5 });
  assert.equal(race.gaps.length, 2);
  const line = race.start.line;
  const bow = (r) => r.loc.s + 3.3;
  const rivals = race.racers.filter((r) => r.ai);
  const waiting = rivals.filter((r) => Math.abs(bow(r) - line) < 1.5);
  assert.equal(waiting.length, rivals.length - Math.floor(rivals.length / 2));
  for (const r of rivals) assert.ok(bow(r) > bow(race.player) + 1, `${r.name} is ahead of you`);
  for (const r of waiting) {
    for (const g of race.gaps) assert.ok(Math.abs(r.loc.lateral - g) > 1, `${r.name} clear of the gap`);
  }
  assert.ok(bow(race.player) < line - 10, 'you start behind the line');
  for (let t = 0; !started(race); t += DT) {
    assert.ok(t < 60, 'the start never came');
    stepRace(race, DT, lineUp(race));
  }
  assert.ok(Math.abs(race.player.loc.lateral - nearestGap(race)) < 0.8, 'in the gap');
  for (const r of race.racers) assert.ok(Math.abs(bow(r) - line) < 2.5, `${r.name} level on the line`);
  assert.ok(race.racers.every((r) => r.boat.capsizes === 0));
});

test('the starter waits for you, and calls you up again', () => {
  const race = createRace(raceRiver(), { rivals: DIVISION_9, seed: 6 });
  const calls = [];
  for (let t = 0; t < 30; t += DT) calls.push(...stepRace(race, DT, { strokes: [], lean: balance(race.player.boat) }).events);
  assert.deepEqual(calls, ['line-up', 'nudge', 'nudge']);
  assert.equal(started(race), false);
});

test('jumping the start holds it until the field comes up level, then starts again', () => {
  const race = createRace(raceRiver(), { rivals: DIVISION_9, seed: 4 });
  const calls = [];
  for (let t = 0; !started(race) && t < 90; t += DT) {
    // Charge at the line and over it, then sit still.
    const input = lineUp(race, { interval: 0.55, through: race.start.phase !== 'hold' && !race.start.holds });
    calls.push(...stepRace(race, DT, input).events.filter((e) => e !== 'stroke' && e !== 'weak'));
  }
  assert.deepEqual(calls.slice(calls.indexOf('hold')), ['hold', 'line-up', 'ready', 'go']);
  assert.ok(race.start.line > race.course.start, 'the line moved up to the jumper');
  for (const r of race.racers) assert.ok(Math.abs(r.loc.s + 3.3 - race.start.line) < 2.5, `${r.name} is level`);
});

test('a pack races the true-size Reading Thames: lined up at true speed, then four times faster from the horn', async () => {
  const course = courseFromFile(JSON.parse(await readFile(new URL('../reading-thames/courses/reading.json', import.meta.url), 'utf8')));
  const race = createRace(course, { rivals: DIVISION_9, seed: 2 });
  for (let t = 0; !started(race); t += DT) {
    assert.ok(t < 60, 'the start never came');
    assert.ok(race.racers.every((r) => r.boat.speedup === 1), 'lining up happens at true speed');
    stepRace(race, DT, lineUp(race));
  }
  assert.ok(race.racers.every((r) => r.boat.speedup === course.speedup));
  let banked = 0;
  while (race.time < 900 && race.racers.some((r) => r.ai && r.finish === null)) {
    stepRace(race, DT, { strokes: [], lean: balance(race.player.boat) });
    banked += race.racers.filter((r) => r.ai && r.boat.onBank).length * DT;
  }
  const rivals = standings(race).filter((r) => r.ai);
  assert.ok(rivals.every((r) => r.finish !== null), 'everyone finished');
  // 6.26 km at a club pace, in real-equivalent minutes.
  const minutes = rivals.map((r) => (r.finish * course.warp) / 60);
  assert.ok(minutes[0] > 29 && minutes[0] < 34, `winner ${minutes[0]}`);
  assert.ok(minutes.at(-1) < 37, `last ${minutes.at(-1)}`);
  assert.ok(rivals.every((r) => r.boat.capsizes === 0));
  assert.ok(banked < 15, `rivals spent ${banked} s on the banks`); // a few brushes, swerving round swans
});

const loopCourse = async () => courseFromFile(JSON.parse(await readFile(new URL('../reading-thames/courses/loop.json', import.meta.url), 'utf8')));

test('a time trial lets boats go one at a time, and times each from the start line', async () => {
  const course = await loopCourse();
  const race = createRace(course, { rivals: DIVISION_9.slice(0, 5), seed: 3, format: 'interval', you: { slot: 2 } });
  assert.equal(race.racers.indexOf(race.player), 2, 'you go third');
  const gap = 30 / course.warp;
  assert.deepEqual(race.racers.map((r) => r.release - race.racers[0].release), race.racers.map((_, k) => k * gap));
  const calls = [];
  const startAt = race.player.loc.s;
  // Paddling before your start gets you nowhere.
  let next = 0;
  while (race.time < race.player.release + 20) {
    const strokes = race.time >= next ? [race.player.boat.lastSide === 'left' ? 'right' : 'left'] : [];
    if (strokes.length) next = race.time + 0.7;
    calls.push(...stepRace(race, DT, { strokes, lean: balance(race.player.boat) }).events.filter((e) => ['ten', 'count', 'go'].includes(e)));
    if (race.time < race.player.release) assert.ok(race.player.loc.s - startAt < 1, 'held until your start');
  }
  assert.deepEqual(calls, ['ten', 'count', 'count', 'count', 'count', 'count', 'go']);
  assert.ok(race.player.crossed !== null && race.player.crossed > race.player.release, 'your clock starts at the line');
  assert.ok(Math.abs(elapsed(race, race.player) - (race.time - race.player.crossed)) < 1e-9);
  const [first, second] = race.racers;
  assert.ok(first.crossed < second.crossed, 'the first boat off crossed first');
});

// Swans crowd by the club, and a rival now and then paddles into one: over
// 40 seeded races main and this course average about 0.7 swims a race
// (27 each, measured 2026-10-30), so one seed is allowed one, never the
// same paddler twice.
test('the time trial loop: round St Mary\'s and Fry\'s islands and back, everyone home, a swim at most', async () => {
  const course = await loopCourse();
  const km = ((course.finish - course.start) * course.warp) / course.speedup / 1000;
  assert.ok(km > 5.2 && km < 5.6, `${km} km`);
  assert.ok(course.samples.filter((p) => p.shared).length > course.samples.length / 3, 'much of it is two-way water');
  assert.ok(Math.min(...course.samples.map((p) => p.left + p.right)) < 15, 'the gap at St Mary\'s is narrow');
  const race = createRace(course, { rivals: DIVISION_9, seed: 1, format: 'interval' });
  while (race.time < 700 && race.racers.some((r) => r.ai && r.finish === null)) stepRace(race, DT, { strokes: [], lean: balance(race.player.boat) });
  const rivals = standings(race).filter((r) => r.ai);
  assert.ok(rivals.every((r) => r.finish !== null), 'everyone finished');
  const minutes = rivals.map((r) => (r.finish * course.warp) / 60);
  assert.ok(minutes[0] > 24 && minutes.at(-1) < 33, `${minutes[0]}-${minutes.at(-1)} minutes`);
  const swims = rivals.reduce((n, r) => n + r.boat.capsizes, 0);
  assert.ok(swims <= 1 && rivals.every((r) => r.boat.capsizes <= 1), rivals.filter((r) => r.boat.capsizes).map((r) => `${r.name} ${r.boat.capsizes}`).join(', '));
});

test('a live race: everyone on the line, the host runs the starter, the others follow its calls', () => {
  const course = raceRiver();
  const players = [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bob' }, { id: 'c', name: 'Cat' }];
  const host = createRace(course, { live: { players, you: 'a', host: 'a' }, birds: false });
  const guest = createRace(course, { live: { players, you: 'b', host: 'a' }, birds: false });
  assert.equal(host.player.id, 'a');
  assert.equal(guest.player.id, 'b');
  assert.deepEqual(guest.racers.map((r) => [r.name, !!r.remote]), [['Ann', true], ['You', false], ['Cat', true]]);
  const bow = (r) => r.loc.s + 3.3;
  for (const r of host.racers) assert.ok(Math.abs(bow(r) - host.start.line) < 1.5, `${r.name} on the line`);

  // The host's starter sees everyone sitting on the line and calls them; the guest's never does.
  const hostCalls = [];
  const guestCalls = [];
  for (let t = 0; t < 12 && !started(host); t += DT) {
    hostCalls.push(...stepRace(host, DT, { strokes: [], lean: balance(host.player.boat) }).events);
    guestCalls.push(...stepRace(guest, DT, { strokes: [], lean: balance(guest.player.boat) }).events);
  }
  assert.deepEqual(hostCalls.filter((e) => ['line-up', 'ready', 'go'].includes(e)), ['line-up', 'ready', 'go']);
  assert.deepEqual(guestCalls.filter((e) => ['ready', 'go'].includes(e)), []);
  assert.equal(started(guest), false);

  applyCall(guest, 'ready');
  applyCall(guest, 'go');
  assert.deepEqual(stepRace(guest, DT, { strokes: [], lean: 0 }).events.filter((e) => e !== 'stroke'), ['ready', 'go']);
  assert.ok(started(guest));

  // Remote boats are moved by the network, never by the physics or the finish line.
  const ann = guest.racers[0];
  const before = [ann.boat.x, ann.boat.z];
  ann.boat.speed = 5;
  for (let k = 0; k < 120; k++) stepRace(guest, DT, { strokes: [], lean: 0 });
  assert.deepEqual([ann.boat.x, ann.boat.z], before);
  Object.assign(ann.boat, { x: pointAt(course, course.finish + 5).x, z: pointAt(course, course.finish + 5).z });
  ann.loc.i = Math.round((course.finish + 5) / 2);
  stepRace(guest, DT, { strokes: [], lean: 0 });
  assert.equal(ann.finish, null, 'their finish comes from them');
});


// A boat under way at `s` along the made-up river, `lateral` to the right of its middle.
function boatAt(course, s, lateral, speed = 3.6) {
  const c = pointAt(course, s);
  const boat = createBoat({ x: c.x - c.tz * lateral, z: c.z + c.tx * lateral, heading: headingAt(course, s) });
  boat.speed = speed;
  return { boat, loc: locate(course, boat.x, boat.z), finish: null, ai: { slot: null } };
}
const packRace = (course, racers) => ({ course, racers, start: { phase: 'go' } });

test("a boat under way has three places in its wash, its two hips and its stern, each where wash() gives the most", () => {
  const course = raceRiver();
  const host = boatAt(course, 600, 0);
  const me = boatAt(course, 585, 0);
  const free = washSlots(packRace(course, [host, me]), me);
  assert.deepEqual(free.map((p) => p.slot).sort(), [0, 1, 2]);
  for (const p of free) {
    const there = createBoat({ x: p.x, z: p.z, heading: p.heading });
    assert.ok(wash(there, host.boat).draft > 0.5, `slot ${p.slot}: draft ${wash(there, host.boat).draft.toFixed(2)}`);
    assert.ok(Math.abs(host.loc.s - p.s - SLOTS[p.slot].back) < 0.01 && Math.abs(p.lateral - host.loc.lateral - SLOTS[p.slot].across) < 0.01);
  }
  // A boat drifting, or one too far ahead, leaves no place worth taking.
  host.boat.speed = 1;
  assert.equal(washSlots(packRace(course, [host, me]), me).length, 0);
  host.boat.speed = 3.6;
  assert.equal(washSlots(packRace(course, [host, me]), me, 5).length, 0, 'out of reach');
});

test("a place someone sits in isn't offered, nor a boat that's hanging on you (no going round in a ring)", () => {
  const course = raceRiver();
  const host = boatAt(course, 600, 0);
  const left = boatAt(course, 600 - SLOTS[0].back, SLOTS[0].across);
  const me = boatAt(course, 585, 0);
  const race = packRace(course, [host, left, me]);
  const free = washSlots(race, me).filter((p) => p.host === host);
  assert.deepEqual(free.map((p) => p.slot).sort(), [1, 2], 'the left hip is taken');
  // The left-hip boat is under way too: its own hips are places (the V widening).
  assert.ok(washSlots(race, me).some((p) => p.host === left));
  left.ai.slot = { host: me };
  assert.ok(!washSlots(race, me).some((p) => p.host === left), 'not a boat hanging on me');
});

test('the water shows you the free places ahead: full out to 20 m, gone by 30, softer close up, dim while you ride one; never by the bank; none before the start or on an outing', () => {
  const course = raceRiver();
  const host = boatAt(course, 600, 0);
  const me = boatAt(course, 585, 0);
  const race = packRace(course, [host, me]);
  const marks = washMarks(race, me);
  assert.equal(marks.length, 3);
  assert.ok(marks.every((m) => m[3] > 0.85), `bright 9-11 m off: ${marks.map((m) => m[3].toFixed(2))}`);
  const mid = boatAt(course, 600 - 6.3 - 18, 0); // the nearest place (the stern) 18 m ahead
  assert.ok(washMarks(packRace(course, [host, mid]), mid).every((m) => m[3] > 0.85), 'still full at 18 m');
  const far = boatAt(course, 600 - 6.3 - 31, 0);
  assert.equal(washMarks(packRace(course, [host, far]), far).length, 0, 'gone past 30 m');
  const close = boatAt(course, 600 - 6.3 - 2, 0);
  assert.ok(washMarks(packRace(course, [host, close]), close).some((m) => m[3] <= 0.6), 'softer 2 m off');
  // Riding the hip's wash ("On the wash" showing): that place goes dim.
  const sitting = boatAt(course, 600 - SLOTS[1].back, SLOTS[1].across);
  sitting.draft = 0.6;
  assert.ok(washMarks(packRace(course, [host, sitting]), sitting)[0][3] < 0.3);
  // A boat close to the right bank: no mark on its right hip, too near the bank for anyone.
  const right = widthAt(course, 600).right;
  const byBank = boatAt(course, 600, right - 2.6);
  const behind = boatAt(course, 590, right - 2.6);
  const shown = washMarks(packRace(course, [byBank, behind]), behind).map((m) => locate(course, m[0], m[1]).lateral);
  assert.ok(shown.length && shown.every((l) => l <= right - 2.2 + 0.01), `marks at ${shown.map((l) => l.toFixed(1))}, bank at ${right.toFixed(1)}`);
  assert.equal(washMarks({ ...race, start: { phase: 'ready' } }, me).length, 0);
  assert.equal(washMarks({ ...race, outing: {} }, me).length, 0);
  me.finish = 100;
  assert.equal(washMarks(race, me).length, 0);
});

test('the rivals race in packs: a V or a diamond, each in a place on a wash, far more than when each just hung on a hip', async () => {
  // Measured: the first 4 minutes of three Hasler 7-9 races. Before packs,
  // rivals rode a wash 14% of the time and a boat had two on its wash 80 times
  // in 1260 half-second looks; with them, 24% and 356.
  const course = courseFromFile(JSON.parse(await readFile(new URL('../reading-thames/courses/hasler79.json', import.meta.url), 'utf8')));
  let n = 0;
  let on = 0;
  let shaped = 0;
  for (const seed of [1, 2, 3]) {
    const race = createRace(course, { rivals: DIVISION_9, seed, traffic: false });
    // You sit out of the way at the side of the start (only the rivals are watched).
    const sLine = race.start.line - 3.6;
    const c = pointAt(course, sLine);
    const half = widthAt(course, sLine).half - 2;
    Object.assign(race.player.boat, { x: c.x - c.tz * half, z: c.z + c.tx * half, heading: headingAt(course, sLine), speed: 0 });
    race.player.loc = locate(course, race.player.boat.x, race.player.boat.z, race.player.loc.i);
    race.player.boat.hull = { ...race.player.boat.hull, capsize: 99 };
    const rivals = race.racers.filter((r) => r.ai);
    for (let t = 0, k = 0; t < 240; t += 1 / 60, k++) {
      stepRace(race, 1 / 60, { strokes: [], lean: 0 });
      if (race.time < 30 || k % 30) continue;
      for (const r of rivals) { n++; if (r.draft > 0.3) on++; }
      if (rivals.some((h) => rivals.filter((o) => o !== h && wash(o.boat, h.boat).draft > 0.3).length >= 2)) shaped++;
    }
  }
  assert.ok(on / n > 0.2, `on a wash ${(100 * on / n).toFixed(0)}%`);
  assert.ok(shaped > 250, `a V or diamond ${shaped} times`);
});
