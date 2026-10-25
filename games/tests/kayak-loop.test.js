import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { courseFromFile, locate, pointAt, riverView } from '../kayak/course.js';
import { createRace, stepRace, started } from '../kayak/race.js';
import { createBoat, step, bounceOffShore, wrap } from '../kayak/sim.js';

const loop = async () => courseFromFile(JSON.parse(await readFile(new URL('../kayak/courses/loop.json', import.meta.url), 'utf8')));
const gate = (course, words) => course.scenery.gates.find((g) => g.label.includes(words));
const fromRiver = (course, s) => {
  const p = pointAt(course, s);
  return Math.abs(locate(course.scenery.river, p.x, p.z).lateral);
};

test("the Loop goes down the main channel right of Fry's Island, round its end above Christchurch Bridge, and back up behind it", async () => {
  const course = await loop();
  const river = course.scenery.river;
  // The main channel is the river line's; the back channel is well away from it.
  assert.ok(fromRiver(course, gate(course, 'main channel').s) < 15, 'down the main channel');
  assert.ok(fromRiver(course, gate(course, 'behind Fry').s) > 40, 'up the back channel');
  // Through Caversham Bridge's south arch (the river line's) both ways.
  const bridge = river.bridges?.find((b) => b.name === 'Caversham Bridge') ?? course.scenery.bridges.find((b) => b.name === 'Caversham Bridge');
  const c = pointAt(river, bridge.s);
  const passes = course.samples.filter((p) => Math.hypot(p.x - c.x, p.z - c.z) < 8);
  const legs = new Set(passes.map((p) => Math.round(p.s / 500)));
  assert.ok(legs.size >= 2, 'under the bridge twice');
  // The turn round the end of Fry's Island stays above Christchurch Bridge.
  const christchurch = course.scenery.bridges.find((b) => b.name === 'Christchurch Bridge').s;
  const [from, to] = [gate(course, 'main channel').s, gate(course, 'behind Fry').s];
  for (const p of course.samples.filter((q) => q.s > from && q.s < to)) {
    assert.ok(locate(river, p.x, p.z).s > christchurch, `${p.s.toFixed(0)} m along: above the bridge`);
  }
});

test('no turn on the Loop is tighter than a K1 can make, and the line keeps off the banks', async () => {
  const course = await loop();
  const S = course.samples;
  for (let i = 2; i < S.length - 2; i++) {
    const [a, b, c] = [S[i - 2], S[i], S[i + 2]];
    const area = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
    const r = area < 1e-9 ? Infinity : (Math.hypot(b.x - a.x, b.z - a.z) * Math.hypot(c.x - b.x, c.z - b.z) * Math.hypot(c.x - a.x, c.z - a.z)) / (4 * area);
    // 12 m where there's water for it; round the end of Fry's Island, 20 m above Christchurch Bridge, a little less.
    assert.ok(r > 9, `a ${r.toFixed(1)} m turn at ${S[i].s} m`);
  }
  for (const p of S) assert.ok(!course.shore.dry(p.x, p.z), `${p.s} m on the water`);
});

test('a cue comes before each turn it warns of, and the turning buoys are on the water off the island ends', async () => {
  const course = await loop();
  const { cues, gates, marks } = course.scenery;
  const before = (text, words) => {
    const c = cues.find((q) => q.text.includes(text));
    assert.ok(c.s < gate(course, words).s - 40, `"${c.text}" in time`);
  };
  before('up the back channel behind St Mary', 'up the back channel round St Mary');
  before('Round the end of the island', 'round the end of St Mary');
  before("Keep right of Fry's", 'main channel');
  before('turn left round the end of Fry', "round the end of Fry's");
  assert.equal(gates.length, 5);
  assert.equal(marks.length, 4);
  for (const m of marks) assert.ok(!course.shore.dry(m.x, m.z), 'a buoy on the water');
});

// Stepping a race with the player's boat carried along a path (a racing line
// or another): the events, and the player.
function paddle(race, path) {
  const events = [];
  const boat = race.player.boat;
  for (const [x, z, heading] of path) {
    Object.assign(boat, { x, z, heading, speed: 0, roll: 0, rollRate: 0 });
    events.push(...stepRace(race, 1 / 30, { strokes: [], lean: 0 }).events);
  }
  return events;
}
const along = (course, from, to) => {
  const out = [];
  for (let s = from; s <= to; s += 1) {
    const p = pointAt(course, s);
    out.push([p.x, p.z, Math.atan2(p.tx, -p.tz)]);
  }
  return out;
};

test("gates: going up the main channel instead of St Mary's back channel misses it, and going back for it counts", async () => {
  const course = await loop();
  const g = gate(course, 'up the back channel round St Mary');
  const fresh = () => {
    const race = createRace(course, { rivals: [], seed: 1, traffic: false, birds: false });
    race.start.phase = 'go';
    paddle(race, along(course, g.s - 120, g.s - 100));
    return race;
  };
  // The racing line: through.
  let race = fresh();
  paddle(race, along(course, g.s - 100, g.s + 20));
  assert.equal(race.player.gate, 1);
  assert.equal(race.player.missed ?? null, null);
  // Up the main channel past the island instead: missed.
  race = fresh();
  const river = course.scenery.river;
  const from = locate(river, pointAt(course, g.s - 100).x, pointAt(course, g.s - 100).z).s;
  const to = locate(river, pointAt(course, g.s + 40).x, pointAt(course, g.s + 40).z).s;
  const events = paddle(race, along(river, Math.min(from, to), Math.max(from, to)).map(([x, z, h]) => [x, z, from < to ? h : h + Math.PI]));
  assert.ok(events.includes('missed'), 'told it missed the course');
  assert.equal(race.player.missed, g);
  // Back down below the gate and round by the back channel: it counts.
  paddle(race, along(course, g.s - 100, g.s + 20));
  assert.equal(race.player.missed, null);
  assert.equal(race.player.gate, 1);
});

test("a boat paddled into the end of an island stops there: it isn't thrown sideways", async () => {
  const course = await loop();
  const tip = course.scenery.marks[2]; // off Fry's Island's upstream end
  // Head from the buoy straight at the nearest shore, at a racing speed.
  const shore = (() => {
    for (let r = 1; r < 30; r += 0.5) {
      for (let a = 0; a < 360; a += 10) {
        const x = tip.x + Math.cos((a * Math.PI) / 180) * r;
        const z = tip.z + Math.sin((a * Math.PI) / 180) * r;
        if (course.shore.dry(x, z)) return { x, z };
      }
    }
    return null;
  })();
  const heading = Math.atan2(shore.x - tip.x, -(shore.z - tip.z));
  const boat = { ...createBoat({ x: tip.x - Math.sin(heading) * 4, z: tip.z + Math.cos(heading) * 4, heading }), speed: 4 };
  let worst = 0;
  let hits = 0;
  for (let t = 0; t < 3; t += 1 / 120) {
    const [x, z] = [boat.x, boat.z];
    step(boat, 1 / 120, { strokes: [], lean: 0 });
    const h = boat.heading;
    const [mx, mz] = [boat.x, boat.z];
    if (bounceOffShore(boat, course.shore, 1 / 120)) hits++;
    worst = Math.max(worst, Math.hypot(boat.x - mx, boat.z - mz));
    assert.ok(Math.hypot(boat.x - x, boat.z - z) < 0.6, 'no jump');
    assert.ok(Math.abs(wrap(boat.heading - h)) < 0.06, 'turned along the bank over a few frames, not in one');
  }
  assert.ok(hits >= 1, 'it hit the island');
  assert.ok(worst < 0.5, `pushed back at most ${worst.toFixed(2)} m in a step`);
  assert.ok(boat.speed < 2, 'and it lost its speed');
  for (const d of [-1.9, 0, 3.3]) assert.ok(!course.shore.dry(boat.x + Math.sin(boat.heading) * d, boat.z - Math.cos(boat.heading) * d), 'back on the water');
});

test('swans crowd in front of the university boathouses, off the racing line on the water, and stay there', async () => {
  const course = await loop();
  const race = createRace(course, { rivals: [], seed: 4, traffic: false });
  const away = race.birds.filter((b) => b.away);
  assert.ok(away.length >= 6, `${away.length} swans and ducks there`);
  for (const b of away) assert.ok(!course.shore.dry(b.x, b.z));
  race.start.phase = 'go';
  for (let t = 0; t < 60; t += 1 / 30) stepRace(race, 1 / 30, { strokes: [], lean: 0 });
  for (const b of away.filter((x) => !x.gone && x.fly <= 0)) {
    assert.ok(!course.shore.dry(b.x, b.z), 'still on the water');
    assert.ok(Math.abs(b.loc.lateral) > 12, 'still off the racing line');
  }
});

// A paddler who steers for a point 15 m up the line cuts every corner, and
// brushes the ends of St Mary's and Fry's Islands, and the bank below
// Caversham Bridge: the boat used to be turned along the bank in a frame
// (up to 78 degrees), which on screen is the view jerking round.
test("brushing the bank round the island ends doesn't jerk the boat round", async () => {
  const course = await loop();
  const race = createRace(course, { rivals: [], seed: 1, traffic: false, birds: false, format: 'interval' });
  const p = race.player;
  const DT = 1 / 60;
  const balance = (b) => Math.max(-1, Math.min(1, -(b.roll * 2 + b.rollRate * 0.6)));
  for (let t = 0; !started(race) && t < 120; t += DT) stepRace(race, DT, { strokes: [], lean: balance(p.boat) });
  let next = 0;
  let bank = 0;
  while (p.finish === null && race.time < 900) {
    const strokes = race.time >= next ? [p.boat.lastSide === 'left' ? 'right' : 'left'] : [];
    if (strokes.length) next += 0.7;
    const aim = pointAt(course, p.loc.s + 15);
    const err = wrap(Math.atan2(aim.x - p.boat.x, -(aim.z - p.boat.z)) - p.boat.heading);
    const h = p.boat.heading;
    const { events } = stepRace(race, DT, { strokes, lean: balance(p.boat), rudder: Math.max(-1, Math.min(1, err * 3 - p.boat.yawRate * 0.5)) });
    if (events.includes('bank')) bank++;
    assert.ok(Math.abs(wrap(p.boat.heading - h)) < 0.12, `turned ${wrap(p.boat.heading - h).toFixed(2)} rad in a frame at ${p.loc.s.toFixed(0)} m`);
  }
  assert.notEqual(p.finish, null, 'and finished');
  assert.ok(bank >= 1, 'it did brush a bank');
});

// The water's tree reflections are taken from the river line and the open
// water's width where you are; at an island's end that width jumps by tens of
// metres in a few, and the reflections all over the water jumped with it.
test("the water's reflections ease through the island ends rather than jump", async () => {
  const course = await loop();
  let view = null;
  let worst = { half: 0, turn: 0 };
  for (let s = course.start; s < course.finish; s += 4 / 60) {
    const was = view;
    view = riverView(course, s, view, 1 / 60);
    if (!was) continue;
    worst.half = Math.max(worst.half, Math.abs(view.half - was.half));
    worst.turn = Math.max(worst.turn, Math.abs(wrap(Math.atan2(view.tx, -view.tz) - Math.atan2(was.tx, -was.tz))));
  }
  assert.ok(worst.half < 1, `the width moved ${worst.half.toFixed(2)} m in a frame`);
  assert.ok(worst.turn < 0.02, `the river's direction turned ${worst.turn.toFixed(3)} rad in a frame`);
  // And it starts afresh on a new race or a restart.
  const fresh = riverView(course, course.start, view, 1 / 60);
  assert.equal(fresh.x, pointAt(course, course.start).x);
});
