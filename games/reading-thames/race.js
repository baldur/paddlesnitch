// A pack race: the player plus computer paddlers on the same boat physics.
// Half the rivals already wait on the start line; the rest are still drifting
// up to it, a few lengths ahead of you, and everyone leaves a couple of gaps
// for you to paddle up into. A starter then sounds the horn without warning; rivals then
// sprint off the line, pace themselves on stamina, hang on each other's wash,
// avoid and bump into each other and kick for the finish. Pure, no DOM, so
// whole races run in tests.
import { createBoat, step, bounceOffBank, bounceOffShore, wrap, steadyBeat, BOAT } from './sim.js';
import { stepScull } from './scull.js';
import { locate, pointAt, headingAt, widthAt, roomAhead } from './course.js';
import { createBirds, stepBirds, swansAhead } from './birds.js';
import { createAnglers, snagLines, linesAhead } from './anglers.js';
import { createTraffic, moveTraffic, trafficHits, trafficWash, trafficWarnings, trafficNear } from './traffic.js';

const BOW = 3.3; // hull ends, metres from the boat's origin (see meshes.kayakMesh)
const STERN = 1.9;
const BEAM = 0.48; // closest two hulls can get
const LANE = 1.75; // spacing on the start line: blades all but touching
const GAPS = 2; // open places the rivals leave on the line
const BEHIND = 14; // how far back from the line you start, metres
const RACE_PACE = 1.25; // rivals' racing beat, against the beat they could hold for ever
// Rivals pull this much of a full stroke: with RACE_PACE, tuned so a person on a
// keyboard or a phone, rarely perfectly on the beat, can race them (the winner
// takes about 31 minutes for 6 km).
const RIVAL_POWER = 0.92;

// Division 9, the entry division: a start line of twelve club paddlers in
// all sorts of boats. Pace scales their usual beat (below 1 is quicker, and
// tires them sooner); kick is how far out
// (real metres) they start sprinting for the line.
export const DIVISION_9 = [
  { name: 'Ingrid', hull: 'club', power: 1.0, endurance: 1.0, pace: 1.0, kick: 120 },
  { name: 'Tomás', hull: 'club', power: 0.98, endurance: 1.1, pace: 1.0, kick: 200 },
  { name: 'Aoife', hull: 'racing', power: 0.95, endurance: 1.0, pace: 0.99, kick: 90 },
  { name: 'Kenji', hull: 'club', power: 1.02, endurance: 0.85, pace: 0.98, kick: 150 },
  { name: 'Maja', hull: 'stable', power: 0.98, endurance: 1.05, pace: 1.0, kick: 110 },
  { name: 'Olu', hull: 'club', power: 0.97, endurance: 0.95, pace: 1.01, kick: 250 },
  { name: 'Bjarki', hull: 'stable', power: 0.96, endurance: 1.1, pace: 1.02, kick: 80 },
  { name: 'Priya', hull: 'club', power: 0.96, endurance: 1.0, pace: 1.01, kick: 140 },
  { name: 'Lukas', hull: 'stable', power: 1.0, endurance: 0.9, pace: 0.99, kick: 180 },
  { name: 'Freya', hull: 'club', power: 0.94, endurance: 1.05, pace: 1.02, kick: 100 },
  { name: 'Mateo', hull: 'racing', power: 0.96, endurance: 0.9, pace: 1.0, kick: 160 },
];

// Division 3, for the long Hasler course (Divisions 1 to 6): club racers in
// racing boats, quicker on the beat and stronger for longer.
export const DIVISION_3 = [
  { name: 'Hannah', hull: 'racing', power: 1.04, endurance: 1.15, pace: 0.95, kick: 220 },
  { name: 'Rafael', hull: 'racing', power: 1.06, endurance: 1.05, pace: 0.94, kick: 160 },
  { name: 'Sigrún', hull: 'racing', power: 1.02, endurance: 1.2, pace: 0.96, kick: 300 },
  { name: 'Dev', hull: 'club', power: 1.05, endurance: 1.1, pace: 0.95, kick: 140 },
  { name: 'Chloe', hull: 'racing', power: 1.03, endurance: 1.1, pace: 0.95, kick: 200 },
  { name: 'Kwame', hull: 'racing', power: 1.07, endurance: 0.95, pace: 0.94, kick: 120 },
  { name: 'Elin', hull: 'club', power: 1.02, endurance: 1.15, pace: 0.96, kick: 250 },
  { name: 'Marco', hull: 'racing', power: 1.04, endurance: 1.0, pace: 0.95, kick: 180 },
  { name: 'Yuki', hull: 'racing', power: 1.03, endurance: 1.1, pace: 0.96, kick: 150 },
  { name: 'Fionn', hull: 'club', power: 1.05, endurance: 1.05, pace: 0.95, kick: 210 },
  { name: 'Leila', hull: 'racing', power: 1.02, endurance: 1.1, pace: 0.96, kick: 130 },
];

// The starter: boats come up to the line; once the line is steady, "Are you
// ready?"; then the horn after a pause you can't predict. Cross the line early
// and the start is held while everyone else comes up level with you, then it
// begins again.
const LINE_UP = 3; // seconds at least before the ready call
const NUDGE = 12; // seconds the starter waits for you before calling you up again
const READY = [1.2, 4.5]; // shortest and longest wait for the horn after it
const JUMP = 1; // metres over the line that count as jumping the start
const ON_LINE = 2.5; // a bow this close behind the line is on it

// you: the player's { power, endurance, hull }. birds: swans and ducks on the
// water (a course file's `birds` say where they crowd). traffic: other boats
// on the river (traffic.js). format: 'mass' (the
// starter, everyone on the line) or 'interval' (a time trial: see below).
// live: a race against other people ({ players: [{ id, name }], you, host }),
// whose boats are driven over the network (main.js, live.js), not by think().
export function createRace(course, { rivals = [], seed = 1, you = {}, birds = true, traffic = true, format = 'mass', live = null } = {}) {
  const race = live ? liveRace(course, { seed, you, birds, live })
    : format === 'interval' ? intervalRace(course, { rivals, seed, you, birds })
      : massRace(course, { rivals, seed, you, birds });
  race.traffic = traffic ? createTraffic(course, seed) : null;
  race.gates = [...(course.scenery?.gates ?? [])].sort((a, b) => a.s - b.s);
  race.anglers = createAnglers(course);
  race.portages = course.portages ?? [];
  return race;
}

// --- portages ----------------------------------------------------------------
// A course can make you land, run along the bank with your boat and put in
// again (`course.portages`: { from, to } along the route, where you land and
// where you put in; the route between runs over land). It's yours to do, and
// the rivals do the same:
// - Come into the beach slowly: within LAND metres of where the water ends,
//   under SLOW m/s, press both sides together (a left and a right tap within
//   PAIR seconds) and you jump out. Come in quicker and you run aground within
//   AGROUND metres: STUCK seconds before you can get out.
// - Run: every tap is a stride, any side. A comfortable 2 a second is a jog
//   (JOG m/s), each tap a second more is PER_TAP faster, up to MAX. Quicker than
//   the comfortable rate spends your sprint stamina, as paddling does; out of it,
//   you can only jog.
// - At the put-in, both sides together again to get in. The boat wobbles as you
//   sit (WOBBLE), and a stroke in the first SETTLE seconds rocks it more (RUSH):
//   keep it level, then paddle.
// OUT, IN, STUCK and SETTLE are seconds as shown (race time × warp); PAIR is real
// time, as you tap. Paddle on past without landing and, like a gate, there's no
// finishing until you've gone back for it.
export const PORTAGE = {
  land: 12, slow: 1.5, aground: 3, stuck: 3, out: 3, in: 3, settle: 4, pair: 0.2,
  comfortable: 0.5, jog: 2.5, perTap: 1, max: 4.2, cost: 0.03, wobble: 0.9, rush: 0.6,
};

// The time a portage takes as shown, run at a steady `pace` (m/s): out, along
// the bank, back in.
export function portageTime(p, pace = 3) {
  return PORTAGE.out + (p.to - p.from) / pace + PORTAGE.in;
}

// Both sides together: a left and a right tap within PAIR seconds of each
// other (or an explicit `jump`, as the rivals give).
function jumped(r, input) {
  if (input.jump) return true;
  for (const t of input.strokes ?? []) {
    const side = t.replace('back-', '');
    if (r.tap && r.tap.side !== side && r.boat.time - r.tap.at <= PORTAGE.pair) {
      r.tap = null;
      return true;
    }
    r.tap = { side, at: r.boat.time };
  }
  return false;
}

// A stride on the run: like a stroke, the pace is the average of the last two
// gaps, and quicker than comfortable costs stamina.
function stride(r) {
  const run = r.portage;
  const { boat } = r;
  const gap = boat.time - (run.last ?? -Infinity);
  const pace = Math.max(0.2, (Math.min(gap, 2) + Math.min(run.gap ?? 2, 2)) / 2);
  run.gap = gap;
  run.last = boat.time;
  let rate = 1 / pace;
  const quick = rate - 1 / PORTAGE.comfortable;
  if (quick > 0 && boat.stamina > 0) boat.stamina = Math.max(0, boat.stamina - PORTAGE.cost * quick);
  else if (quick > 0) rate = 1 / PORTAGE.comfortable;
  run.target = Math.min(PORTAGE.max, PORTAGE.jog + PORTAGE.perTap * (rate - 1 / PORTAGE.comfortable));
  // Running quicker than a jog, stamina doesn't come back (even when there's
  // none left to spend): ease to a jog to get it back.
  run.quick = quick > 0;
  boat.strokeTimes.push(boat.time);
  while (boat.strokeTimes[0] < boat.time - 6) boat.strokeTimes.shift();
}

// Puts a racer's boat at a point along the route, pointing on down it.
function setAt(race, r, s, speed = 0) {
  const c = pointAt(race.course, s);
  // Strides and strokes are counted apart: the rate starts again out of the boat and back in it.
  if (!speed) r.boat.strokeTimes = [];
  Object.assign(r.boat, { x: c.x, z: c.z, heading: Math.atan2(c.tx, -c.tz), speed, yawRate: 0, roll: 0, rollRate: 0 });
  r.loc = locate(race.course, c.x, c.z, r.loc.i);
}

// What a rival does on a portage: taps out a stride, and jumps out and in
// after a moment to react.
function portageThink(r, race) {
  const { ai, boat, portage: run } = r;
  // How quick a runner and how sharp they are: stronger rivals run quicker.
  ai.stride ??= 0.36 / Math.sqrt(boat.power) * (1 + (race.rand() - 0.5) * 0.08);
  ai.react ??= 1.5 + race.rand() * 1.5; // seconds as shown
  if (run.phase === 'run') {
    ai.strideAt ??= race.time;
    if (race.time < ai.strideAt) return { strokes: [] };
    // Easier when tired: their stamina says how hard to run.
    const gap = boat.stamina > 0.3 ? ai.stride : PORTAGE.comfortable;
    ai.strideAt = race.time + gap;
    return { strokes: [boat.lastSide === 'left' ? 'right' : 'left'] };
  }
  if (run.phase === 'beached' || run.phase === 'put') return { strokes: [], jump: run.t * (race.course.warp ?? 1) > ai.react };
  return { strokes: [] };
}

// A racer and the portages: the beach as they come up to it, and everything
// from jumping out to getting back in. Returns the event, if any: 'beach'
// (coming up to it), 'too-fast' (tried to jump out going too quick), 'aground',
// 'landed', 'run', 'at-put-in', 'put-in'. While `r.portage` is set the racer is
// out of the water and isn't paddling.
function carry(race, r, dt, input) {
  const { course } = race;
  const warp = course.warp ?? 1;
  r.portaged ??= new Set();
  const intent = r.ai && r.portage ? portageThink(r, race) : input;
  const jump = jumped(r, intent);
  if (!r.portage) {
    const k = race.portages.findIndex((p, i) => !r.portaged.has(i) && r.loc.s > p.from - 40 && r.loc.s < p.to + 40);
    const at = k >= 0 ? pointAt(course, race.portages[k].from) : null;
    const d = at ? Math.hypot(r.boat.x - at.x, r.boat.z - at.z) : Infinity;
    if (d > PORTAGE.land) {
      r.beach = null;
      return null;
    }
    const speed = Math.abs(r.boat.speed);
    if (d < PORTAGE.aground && speed > PORTAGE.slow) {
      r.portage = { k, phase: 'aground', t: 0 };
      setAt(race, r, race.portages[k].from);
      return 'aground';
    }
    if (jump && speed <= PORTAGE.slow) {
      r.portage = { k, phase: 'out', t: 0 };
      setAt(race, r, race.portages[k].from);
      return 'landed';
    }
    if (jump) return 'too-fast';
    if (r.beach !== k) {
      r.beach = k;
      return 'beach';
    }
    return null;
  }
  const run = r.portage;
  const p = race.portages[run.k];
  run.t += dt;
  r.boat.time += dt;
  const shown = run.t * warp;
  const next = (phase, event) => {
    Object.assign(run, { phase, t: 0 });
    return event;
  };
  if (run.phase === 'aground') return shown >= PORTAGE.stuck ? next('beached', null) : null;
  if (run.phase === 'beached') return jump ? next('out', 'landed') : null;
  if (run.phase === 'out') {
    if (shown < PORTAGE.out) return null;
    run.d = 0;
    run.v = 0;
    return next('run', 'run');
  }
  if (run.phase === 'run') {
    for (let n = (intent.strokes ?? []).length; n > 0; n--) stride(r);
    if (r.boat.time - (run.last ?? -Infinity) > 1) Object.assign(run, { target: 0, quick: false });
    if (!run.quick) r.boat.stamina = Math.min(1, r.boat.stamina + r.boat.hull.recover * r.boat.endurance * dt);
    run.v += ((run.target ?? 0) - run.v) * Math.min(1, 3 * dt);
    run.d += run.v * (r.boat.speedup ?? 1) * dt;
    const len = p.to - p.from;
    setAt(race, r, p.from + Math.min(run.d, len), run.v);
    return run.d >= len ? next('put', 'at-put-in') : null;
  }
  if (run.phase === 'put') return jump ? next('in', null) : null;
  // Getting in: then afloat at the put-in, from a standstill, and wobbling.
  if (shown < PORTAGE.in) return null;
  r.portaged.add(run.k);
  r.portage = null;
  setAt(race, r, p.to + 1);
  r.boat.rollRate = PORTAGE.wobble * (race.rand() < 0.5 ? -1 : 1);
  r.settle = r.boat.time + PORTAGE.settle / warp;
  return 'put-in';
}

function massRace(course, { rivals, seed, you, birds }) {
  const rand = mulberry32(seed);
  const solo = !rivals.length;
  // The rivals take the line, leaving two gaps (never at the very edge).
  const slots = [...Array(rivals.length + GAPS).keys()];
  const inner = slots.length > GAPS + 2 ? 1 : 0;
  const open = new Set();
  while (open.size < GAPS) open.add(inner + Math.floor(rand() * (slots.length - 2 * inner)));
  const taken = slots.filter((k) => !open.has(k));
  const place = (s, lateral, heading) => {
    const p = pointAt(course, s);
    return { x: p.x - p.tz * lateral, z: p.z + p.tx * lateral, heading };
  };
  const onLine = course.start - BOW - 0.3;
  const heading = headingAt(course, onLine);
  // Located on the first stretch: a course that finishes where it starts (the
  // Hasler courses, home to the club) has the finish in the same water.
  const racer = (name, boat, ai) => ({ name, boat, loc: locate(course, boat.x, boat.z, Math.round(Math.max(0, onLine - BEHIND) / 2)), finish: null, draft: 0, ai });
  // Lining up happens at true speed; the course's speedup starts with the horn.
  const player = racer('You', createBoat({ ...place(solo ? onLine : onLine - BEHIND, 0, headingAt(course, onLine - BEHIND)), ...you }), null);
  // Who is still on the way: they're a few lengths back in their own lane,
  // in two loose rows, the back row clear of you in the middle.
  const late = new Set();
  while (late.size < Math.floor(rivals.length / 2)) late.add(Math.floor(rand() * rivals.length));
  let row = 0;
  const racers = rivals.map((rival, k) => {
    const lateral = (taken[k] - (slots.length - 1) / 2) * LANE;
    let spot = { back: rand() * 0.6, lateral };
    if (late.has(k)) {
      const back = Math.abs(lateral) > 2 && row++ % 2 ? 9 + rand() * 2 : 3.5 + rand() * 2;
      spot = { back, lateral: lateral + (rand() - 0.5) * 0.6 };
    }
    const boat = createBoat({ ...place(onLine - spot.back, spot.lateral, heading), ...rival, power: rival.power * RIVAL_POWER });
    // Seconds a stroke: a touch slower than they could hold for ever (about
    // 86 a minute), so there's something left for the finish.
    const cadence = steadyBeat(boat) * rival.pace * RACE_PACE;
    return racer(rival.name, boat, {
      ...rival,
      cadence,
      interval: cadence,
      next: 0.15 + rand() * 0.35, // reaction to the horn
      creep: 0,
      side: rand() < 0.5 ? -1 : 1, // which hip of a leader to hang on
      lane: lateral * 0.5,
      grid: lateral, // where they sat on the start line
    });
  });
  racers.unshift(player);
  return {
    course, racers, player, time: 0, rand, contacts: new Set(),
    birds: birds ? createBirds(course, rand, course.scenery?.birds) : [],
    gaps: [...open].map((k) => (k - (slots.length - 1) / 2) * LANE),
    start: { phase: 'line-up', timer: LINE_UP, wait: NUDGE, line: course.start, holds: 0, calls: ['line-up'] },
  };
}

export const started = (race) => race.start.phase === 'go' || race.start.phase === 'interval';

// --- a live race -----------------------------------------------------------
// Everyone starts on the line, in lanes in the order they joined. The host's
// game runs the starter (it sees every boat, so it knows when the line is
// steady); the others follow its calls (applyCall).

function liveRace(course, { seed, you, birds, live }) {
  const rand = mulberry32(seed);
  const onLine = course.start - BOW - 0.3;
  const heading = headingAt(course, onLine);
  const n = live.players.length;
  const racers = live.players.map((p, k) => {
    const lateral = (k - (n - 1) / 2) * LANE * 1.4;
    const c = pointAt(course, onLine);
    const at = { x: c.x - c.tz * lateral, z: c.z + c.tx * lateral, heading };
    const mine = p.id === live.you;
    const boat = createBoat({ ...at, ...(mine ? you : {}) });
    return { name: mine ? 'You' : p.name, id: p.id, boat, loc: locate(course, at.x, at.z, Math.round(onLine / 2)), finish: null, draft: 0, ai: null, remote: !mine };
  });
  return {
    course, racers, player: racers.find((r) => !r.remote), time: 0, rand, contacts: new Set(),
    birds: birds ? createBirds(course, rand, course.scenery?.birds) : [],
    gaps: [], live,
    start: { phase: 'line-up', timer: LINE_UP, wait: NUDGE, line: course.start, holds: 0, calls: ['line-up'], follow: live.you !== live.host },
  };
}

// A starter's call from the host ('line-up', 'ready', 'go', 'hold'), in a live race.
export function applyCall(race, call) {
  const st = race.start;
  if (call === 'go' && st.phase !== 'go') for (const r of race.racers) r.boat.speedup = race.course.speedup ?? 1;
  st.phase = call;
  st.calls.push(call);
}

// --- a time trial ----------------------------------------------------------
// Interval starts, as at a club time trial or a head race: the boats wait in
// two columns by the banks below the start line, and are let go one at a time,
// INTERVAL apart (as shown, so a quarter of that at warp 4). Each one's clock
// runs from crossing the start line to the finish: `finish` is that time. You
// go `slot`th (counting from 0); until then your strokes don't count.
const INTERVAL = 30;
const FIRST_GO = 4; // seconds before the first boat goes
const COUNTDOWN = [10, 5, 4, 3, 2, 1];

function intervalRace(course, { rivals, seed, you, birds }) {
  const rand = mulberry32(seed);
  const slot = Math.min(rivals.length, you.slot ?? 4);
  const gap = INTERVAL / (course.warp ?? 1);
  const order = [...rivals];
  order.splice(slot, 0, null);
  const line = course.start;
  const racers = order.map((rival, k) => {
    // Two columns, a boat's length and a bit apart, nearest the line first.
    const side = k % 2 ? -1 : 1;
    const s = Math.max(BOW + 2, line - BOW - 4 - Math.floor(k / 2) * 8);
    const w = widthAt(course, s);
    const lateral = side * Math.max(1.5, (side > 0 ? w.right : w.left) - 3);
    const p = pointAt(course, s);
    const at = { x: p.x - p.tz * lateral, z: p.z + p.tx * lateral, heading: headingAt(course, s) };
    const boat = createBoat({ ...at, ...(rival ?? you), ...(rival ? { power: rival.power * RIVAL_POWER } : {}) });
    const cadence = rival && steadyBeat(boat) * rival.pace * RACE_PACE;
    return {
      // Located on the first stretch (the last, to the finish, is the same water).
      name: rival?.name ?? 'You', boat, loc: locate(course, at.x, at.z, Math.round(s / 2)), finish: null, draft: 0,
      release: FIRST_GO + k * gap, crossed: null,
      ai: rival && { ...rival, cadence, interval: cadence, next: 0, creep: 0, side: rand() < 0.5 ? -1 : 1, lane: 0, grid: lateral, spot: s },
    };
  });
  const player = racers[slot];
  return {
    course, racers, player, time: 0, rand, contacts: new Set(),
    birds: birds ? createBirds(course, rand, course.scenery?.birds) : [],
    gaps: [], format: 'interval',
    start: { phase: 'interval', line, calls: [], counted: new Set() },
  };
}

// Whether a racer has been let go (always, in a mass start once the horn's gone).
export const released = (race, r) => race.format !== 'interval' || race.time >= r.release;

// Lets boats go at their times, starts their clocks on the line, and counts
// you down to yours.
function interval(race) {
  const st = race.start;
  for (const r of race.racers) {
    if (released(race, r) && r.boat.speedup !== (race.course.speedup ?? 1)) r.boat.speedup = race.course.speedup ?? 1;
    if (r.crossed === null && released(race, r) && bowAt(r) >= st.line) r.crossed = race.time;
  }
  const left = race.player.release - race.time;
  for (const n of COUNTDOWN) {
    if (left <= n && !st.counted.has(n)) {
      st.counted.add(n);
      if (left > n - 1) st.calls.push(n === 10 ? 'ten' : 'count');
    }
  }
  if (left <= 0 && !st.counted.has(0)) {
    st.counted.add(0);
    st.calls.push('go');
  }
}

// A racer's time: so far, or (finished) at the finish, as the race clock runs.
export function elapsed(race, r) {
  if (race.format !== 'interval') return r.finish ?? race.time;
  if (r.finish !== null) return r.finish;
  return r.crossed === null ? 0 : race.time - r.crossed;
}

// What a racer still out on the course is on track for: their time so far and
// the rest at their speed (a boat yet to start, at a racing speed).
export function projected(race, r) {
  if (r.finish !== null) return r.finish;
  const k = race.course.speedup ?? 1;
  const togo = race.course.finish - Math.max(r.loc.s, race.course.start);
  return elapsed(race, r) + togo / (Math.max(r.crossed === null ? 3.3 : r.boat.speed, 2) * k);
}

// Bow position along the course.
const bowAt = (r) => r.loc.s + BOW;

// Runs the starter. Calls ('line-up', 'nudge', 'ready', 'go', 'hold') go to race.start.calls.
function starter(race, dt) {
  const st = race.start;
  if (st.phase === 'go') return;
  st.timer -= dt;
  const bow = bowAt(race.player);
  if (st.phase !== 'hold' && bow > st.line + JUMP) {
    // Jumped the start: hold everything, and move the line up to the jumper.
    Object.assign(st, { phase: 'hold', timer: 3, holds: st.holds + 1 });
    st.calls.push('hold');
  }
  const steady = race.player.boat.speed < 0.6;
  if (st.phase === 'hold') {
    st.line = Math.max(st.line, bow);
    const level = race.racers.every((r) => bowAt(r) > st.line - 1.5);
    if (st.timer <= 0 && level && steady) {
      Object.assign(st, { phase: 'line-up', timer: LINE_UP, wait: NUDGE });
      st.calls.push('line-up');
    }
  } else if (st.phase === 'line-up') {
    // The starter won't go until you're up on the line and sitting still.
    const ready = bow > st.line - ON_LINE && steady && race.racers.every((r) => bowAt(r) > st.line - ON_LINE);
    st.wait -= dt;
    if (st.timer <= 0 && ready) {
      Object.assign(st, { phase: 'ready', timer: READY[0] + race.rand() * (READY[1] - READY[0]) });
      st.calls.push('ready');
    } else if (st.wait <= 0) {
      st.wait = NUDGE;
      st.calls.push('nudge');
    }
  } else if (st.timer <= 0 && st.phase === 'ready') {
    st.phase = 'go';
    st.calls.push('go');
    for (const r of race.racers) r.boat.speedup = race.course.speedup ?? 1;
  }
}

// One fixed step. `input` drives the player. Returns { events, splashes }:
// the player's events ('stroke', 'weak', 'capsize', 'remount', 'bank', 'bump', 'line',
// 'finish') and the starter's calls ('line-up', 'nudge', 'ready', 'go', 'hold'), and
// how far away each rival stroke was, for the sound of the pack.
export function stepRace(race, dt, input) {
  const { course, racers, player } = race;
  if (race.format === 'interval') interval(race);
  else if (!race.start.follow) starter(race, dt);
  const going = started(race);
  if (going) race.time += dt;
  const splashes = [];
  let events = [];

  if (race.traffic && going) moveTraffic(race.traffic, race.time);
  const washes = racers.map((r) => totalWash(r, racers));
  racers.forEach((r, i) => {
    if (r.remote) {
      // Someone else's boat: its state comes over the network; just keep its clock and place.
      r.boat.time += dt;
      r.loc = locate(course, r.boat.x, r.boat.z, r.loc.i);
      return;
    }
    // Until you're let go in a time trial, only your balance counts.
    const intent = r.ai ? (r.portage ? {} : think(r, race)) : released(race, r) ? { ...input } : { ...input, strokes: [] };
    // On a portage: out of the boat, running along the bank, getting back in.
    const carried = going ? carry(race, r, dt, intent) : null;
    if (r === player && carried) events.push(carried);
    if (r.portage || carried === 'put-in') return;
    // Just back in: a stroke before the boat's settled rocks it.
    if (r.settle && r.boat.time < r.settle && (intent.strokes ?? []).some((t) => !t.startsWith('back-'))) {
      r.boat.rollRate += (intent.strokes.at(-1) === 'left' ? -1 : 1) * PORTAGE.rush;
      if (r === player) events.push('rushed');
    }
    r.draft = washes[i].draft;
    const rock = washes[i].rock + (race.traffic ? trafficWash(race.traffic, r.boat) : 0);
    const result = (r.boat.hull.scull ? stepScull : step)(r.boat, dt, { ...intent, draft: r.draft, rock });
    // Holding water on the line (but you can paddle up to it from behind).
    if ((!going && bowAt(r) > race.start.line - 4) || !released(race, r)) r.boat.speed *= Math.exp(-0.6 * dt);
    r.loc = locate(course, r.boat.x, r.boat.z, r.loc.i);
    // The real banks where they're mapped; else the edges of the open water.
    const w = widthAt(course, r.loc.s);
    if (course.shore ? bounceOffShore(r.boat, course.shore, dt) : bounceOffBank(r.boat, r.loc, w.left, w.right)) result.push('bank');
    if (r === player) events = [...events, ...result];
    else if (result.includes('stroke')) splashes.push(Math.hypot(r.boat.x - player.boat.x, r.boat.z - player.boat.z));
  });

  // Boats on the water (not carried along a bank on a portage).
  const afloat = racers.filter((r) => !r.portage);
  // Paddling into a swan tips you in.
  for (const r of stepBirds(race.birds, afloat, course, dt)) {
    r.boat.roll = (r.boat.hull.capsize + 0.05) * (Math.sign(r.boat.roll) || 1);
    if (r === player) events.push('swan');
  }
  // Paddling across a fishing line pulls you up short.
  for (const { racer } of snagLines(race.anglers ?? [], afloat)) if (racer === player) events.push('line');
  // So does running into another boat, or its oars; and the cox of an eight
  // coming up behind you shouts in time to move over.
  if (race.traffic && going) {
    for (const { racer: r, boat } of trafficHits(race.traffic, afloat)) {
      r.boat.roll = (r.boat.hull.capsize + 0.05) * (Math.sign(r.boat.roll) || 1);
      if (r === player) events.push(`hit-${boat.kind}`);
    }
    for (const w of trafficWarnings(race.traffic, player)) events.push(`behind-${w.side}`);
  }

  for (let i = 0; i < racers.length; i++) {
    for (let j = i + 1; j < racers.length; j++) {
      if (racers[i].portage || racers[j].portage) continue;
      if (collide(race, i, j) && (racers[i] === player || racers[j] === player)) events.push('bump');
    }
  }

  // Gates (a course file's `gates`): the course goes this way round an island
  // or up this channel. Reaching one's distance along in its water passes it;
  // anywhere else (another channel, a short cut) misses it, and then you must
  // go back for it: there's no finishing with a gate missed.
  for (const r of racers) {
    // Gone back for it: back below a missed gate, or over the missed portage.
    if (r.missed && (r.missed.portage !== undefined ? r.portaged?.has(r.missed.portage) : r.loc.s < r.missed.s - 10)) r.missed = null;
    // A portage is a gate too: past where you put in without having landed.
    if (!r.remote && !r.missed) {
      const k = race.portages.findIndex((p, i) => !r.portaged?.has(i) && r.loc.s > p.to + 5);
      if (k >= 0) {
        r.missed = { s: race.portages[k].from, portage: k, label: 'back up and land at the beach for the run' };
        if (r === player) events.push('missed');
      }
    }
    if (r.remote || !race.gates.length || r.portage) continue;
    r.gate ??= 0;
    const g = race.gates[r.gate];
    if (!g || r.missed || r.loc.s < g.s) continue;
    const w = widthAt(course, g.s);
    if (Math.abs(r.loc.lateral) <= (r.loc.lateral < 0 ? w.left : w.right) + 2) r.gate++;
    else {
      r.missed = g;
      if (r === player) events.push('missed');
    }
  }

  for (const r of racers) {
    const gated = (!race.gates.length || r.gate === race.gates.length) && !r.missed;
    if (going && !r.remote && r.finish === null && gated && r.loc.s >= course.finish && (race.format !== 'interval' || r.crossed !== null)) {
      r.finish = race.format === 'interval' ? race.time - r.crossed : race.time;
      if (r === player) events.push('finish');
    }
  }
  events.push(...race.start.calls.splice(0));
  return { events, splashes };
}

// Finished racers in order, then everyone else by how far along they are (in a
// time trial, by the time they're on track for).
export function standings(race) {
  if (race.format === 'interval') return [...race.racers].sort((a, b) => projected(race, a) - projected(race, b));
  return [...race.racers].sort((a, b) => {
    if (a.finish !== null || b.finish !== null) return (a.finish ?? Infinity) - (b.finish ?? Infinity);
    return b.loc.s - a.loc.s;
  });
}

// How much `boat` gains from `other`'s wash. Right behind the stern, or beside
// its rear half (hanging on the hip), you push less water: that's `draft`, 0..1.
// Anywhere in the wash, and most of all on the hip, the boat rocks: `rock`.
export function wash(boat, other) {
  const f = [Math.sin(other.heading), -Math.cos(other.heading)];
  const dx = boat.x - other.x;
  const dz = boat.z - other.z;
  const along = dx * f[0] + dz * f[1];
  const lateral = Math.abs(dx * f[1] * -1 + dz * f[0]);
  const bow = along + BOW; // our bow, measured along the other boat
  const strength = Math.min(1, other.speed / 3);
  if (strength <= 0) return { draft: 0, rock: 0 };

  const stern = bell(bow, -STERN - 1, 1.6) * bell(lateral, 0, 0.7);
  const hip = bell(bow, -0.9, 1.7) * bell(lateral, 1.4, 0.65);
  // The diverging waves: a V spreading back from the bow at about 20 degrees.
  const back = -along + BOW;
  const arm = back > 0 && back < 30 ? Math.exp(-((lateral - back * 0.36) ** 2) / 1.5) * (1 - back / 30) : 0;
  return {
    draft: Math.max(stern, hip * 0.85) * strength,
    rock: Math.max(stern * 0.35, hip, arm * 0.7) * strength,
  };
}

// The places to sit in a boat's wash, measured from it (metres behind its
// middle, and to its right): its two hips, where `wash` gives most, then
// tucked in behind its stern. Taken in turn they make a pack's shape: the
// two hips make a V, the stern between them a diamond, and the next boats
// take the hips of the hips, widening the V.
export const SLOTS = [
  { back: 4.2, across: -1.4 },
  { back: 4.2, across: 1.4 },
  { back: 6.3, across: 0 },
];

// The free places in the washes of the boats ahead of racer `r`, within
// `reach` metres of it, nearest first: { host, slot (index into SLOTS), s,
// lateral (along and across the course), x, z, heading, gap (metres along to
// it: less than 0 when it's behind `r`) }. A place is taken when another boat
// sits in it, or is heading for it from nearer; a boat hanging on `r` isn't offered (no going round in a ring).
// Only boats under way leave a wash worth sitting in.
export function washSlots(race, r, reach = 20) {
  const out = [];
  const { loc } = r;
  for (const host of race.racers) {
    if (host === r || host.boat.swim > 0 || host.portage || host.finish !== null || host.boat.speed < 1.5) continue;
    if (host.ai?.slot?.host === r) continue;
    const ahead = host.loc.s - loc.s;
    if (ahead < 1 || ahead > reach + 7 || Math.abs(host.loc.lateral - loc.lateral) > 8) continue;
    const f = [Math.sin(host.boat.heading), -Math.cos(host.boat.heading)];
    SLOTS.forEach(({ back, across }, slot) => {
      const s = host.loc.s - back;
      const lateral = host.loc.lateral + across;
      const gap = s - loc.s;
      if (gap > reach || gap < -4) return;
      // Taken: someone's in it, or on the way to it and nearer than r.
      const near = (o) => Math.abs(o.loc.s - s) + 1.5 * Math.abs(o.loc.lateral - lateral);
      const taken = race.racers.some((o) => o !== r && o !== host && !o.portage && o.boat.swim <= 0
        && ((Math.abs(o.loc.s - s) < 2 && Math.abs(o.loc.lateral - lateral) < 0.9)
          || (o.ai?.slot?.host === host && o.ai.slot.slot === slot && near(o) < near(r))));
      if (taken) return;
      out.push({
        host, slot, s, lateral, gap, heading: host.boat.heading,
        x: host.boat.x - f[0] * back - f[1] * across,
        z: host.boat.z - f[1] * back + f[0] * across,
      });
    });
  }
  const cost = (p) => Math.abs(p.gap) + 1.5 * Math.abs(p.lateral - loc.lateral);
  return out.sort((a, b) => cost(a) - cost(b));
}

// What the water shows racer `r` (you): up to three free places in the wash
// ahead, as [x, z, heading, brightness], brightest close up, fading out 25 m
// off, and dim once you're sitting in one. None before the start, on an
// outing, off the water or once you've finished.
export function washMarks(race, r) {
  if (race.outing || !started(race) || r.finish !== null || r.portage || r.boat.swim > 0) return [];
  return washSlots(race, r, 25).slice(0, 3).map((p) => {
    const there = Math.hypot(p.x - r.boat.x, p.z - r.boat.z) < 1.2;
    const fade = 1 - Math.min(1, Math.max(0, (p.gap - 12) / 13));
    return [p.x, p.z, p.heading, there ? 0.25 : 0.9 * fade];
  }).filter((m) => m[3] > 0.02);
}

// A rival's place in a pack: the one it had while that's still free and in
// reach, else the nearest free one (within 14 m ahead, 6 across), else none.
// `boats`: the river's boats about to pass (trafficNear): no place in their way.
function pickSlot(r, race, boats = []) {
  const { ai, loc } = r;
  // Only places it may sit in: clear of the banks, and on water used both
  // ways no more than a hip's width left of the keep-right line (see think).
  const { course } = race;
  const fits = (p) => {
    if (boats.some((b) => Math.abs(p.lateral - b.lateral) < b.out + 1.5)) return false;
    const room = widthAt(course, p.s);
    if (p.lateral < -(room.left - 2.2) || p.lateral > room.right - 2.2) return false;
    return !course.samples[p.host.loc.i]?.shared || p.lateral >= Math.min(room.right * 0.4, 8) - 1.5;
  };
  const free = washSlots(race, r, 14).filter((p) => Math.abs(p.lateral - loc.lateral) < 6 && fits(p));
  const kept = ai.slot && free.find((p) => p.host === ai.slot.host && p.slot === ai.slot.slot);
  const p = kept ?? free[0] ?? null;
  ai.slot = p && { host: p.host, slot: p.slot, back: SLOTS[p.slot].back, across: SLOTS[p.slot].across };
  return ai.slot;
}

function totalWash(r, racers) {
  let draft = 0;
  let rock = 0;
  for (const o of racers) {
    if (o === r || o.boat.swim > 0 || o.portage) continue;
    const dx = o.boat.x - r.boat.x;
    const dz = o.boat.z - r.boat.z;
    if (dx * dx + dz * dz > 40 * 40) continue;
    const w = wash(r.boat, o.boat);
    draft = Math.max(draft, w.draft);
    rock += w.rock;
  }
  return { draft, rock: Math.min(1, rock) };
}

// Equilibrium speed for a rhythm, at fairly fresh stamina: what a rival could
// hold on their own, so they know when a wash is too slow to sit on.
export function cruiseSpeed(interval, power = 1) {
  const push = (BOAT.impulse * power * 0.95) / interval;
  return (-0.02 + Math.sqrt(0.02 ** 2 + 4 * 0.067 * push)) / (2 * 0.067);
}

function think(r, race) {
  const { boat, ai, loc } = r;
  const { course, racers } = race;
  const lean = clamp(-(boat.roll * 2 + boat.rollRate * 0.6));
  if (!released(race, r)) return { strokes: [], rudder: steer(r, course, ai.grid, 10), lean };
  if (!started(race)) {
    // Drift up to the line with slow, easy strokes, then hold position on it
    // (creeping up level again when the line moves).
    const behind = race.start.line - 0.4 - bowAt(r);
    const strokes = [];
    if (behind > 0 && boat.time >= ai.creep) {
      strokes.push(boat.lastSide === 'left' ? 'right' : 'left');
      ai.creep = boat.time + (behind > 1.5 ? 1 + race.rand() * 0.5 : 1.3);
    }
    return { strokes, rudder: steer(r, course, ai.grid, 10), lean };
  }

  // On a true-size course (speedup > 1) the same moment in the race is that
  // many times further along, and a gap closes that many times quicker.
  const k = course.speedup ?? 1;
  // Just back in from a portage: sit still and keep it level until it's settled.
  if (r.settle && boat.time < r.settle) return { strokes: [], rudder: steer(r, course, 0, 10), lean };
  const beach = beachAhead(r, race);
  if (beach) return beach;
  const togo = course.finish - loc.s;
  // They sprint (paddling quicker than their comfortable beat, which spends
  // stamina) for the line, off the start, and to catch a wash: `f` of their
  // comfortable beat, about 98 a minute for the line and 100 for the rest,
  // which costs about what their old held sprints did. Cheaper sprints (96 a
  // minute) had them chasing every wash across the river: more swans hit and
  // more boats clipping them (measured over 12 and 16 races).
  let cadence = ai.cadence;
  const sprint = (f) => Math.min(ai.cadence * 0.85, steadyBeat(boat) * f);
  if (r.finish !== null) cadence = race.time - r.finish < 8 ? 0.9 : 0; // paddle off, then drift
  else if (togo < ai.kick * k && boat.stamina > 0) cadence = sprint(0.92);
  else if (loc.s < race.start.line + 100 * k) cadence = boat.stamina > 0.5 ? sprint(0.9) : cadence * 0.93; // for a place on a wash

  // Find a wash to sit on: the nearest free place in a pack (a boat's hip or
  // its stern; see washSlots), if that boat isn't too slow.
  const boatsNear = race.traffic ? trafficNear(race.traffic, r, course) : [];
  const slot = pickSlot(r, race, boatsNear);
  const leader = slot?.host ?? null;
  const kicking = togo < ai.kick * k && r.finish === null;
  // No wash to sit on, but one a little way up the river: sprint up to it.
  if (!leader && !kicking && r.finish === null && boat.stamina > 0.6 && racers.some((o) => o !== r && o.boat.swim <= 0
    && o.loc.s - loc.s > 14 && o.loc.s - loc.s < 40 && Math.abs(o.loc.lateral - loc.lateral) < 8)) cadence = sprint(0.9);
  const tooSlow = leader && leader.boat.speed < cruiseSpeed(ai.cadence, boat.power) - 0.25;
  // More than a couple of metres short of the place: sprint into it (the wash
  // there pays the sprint back). Easing up a few per cent never closed it.
  if (leader && !kicking && !tooSlow && r.finish === null && cadence && boat.stamina > 0.4
    && leader.loc.s - loc.s - slot.back > 2) cadence = Math.min(cadence, sprint(0.9));
  let lateral = ai.lane;
  if (leader && !kicking && !tooSlow && r.finish === null && cadence) {
    // Hold station on its hip (or tucked in behind): speed up when dropping
    // back, ease off when riding up. The wash makes easing off cheap.
    const spot = slot.back;
    lateral = leader.loc.lateral + slot.across;
    const target = leader.boat.speed + limit(((leader.loc.s - loc.s) - spot) * 0.25 / k, -0.6, 0.6);
    ai.interval = limit(ai.interval - (target - boat.speed) * 0.003, cadence * 0.94, cadence * 1.4);
  } else {
    if (leader && (kicking || tooSlow)) lateral = leader.loc.lateral + ai.side * 3.2; // go round
    ai.interval += (cadence - ai.interval) * 0.05;
  }

  // Where the course uses the same water both ways, keep right, and further
  // right still for a boat coming the other way.
  if (course.samples[loc.i]?.shared) {
    const right = widthAt(course, loc.s).right;
    // (A boat in a pack may sit a hip's width inside that, on the left hip of a boat keeping right.)
    const inPack = leader && !kicking && !tooSlow;
    lateral = Math.max(lateral, Math.min(right * 0.4, 8) - (inPack ? 1.5 : 0));
    const f = [Math.sin(boat.heading), -Math.cos(boat.heading)];
    for (const o of racers) {
      const dx = o.boat.x - boat.x;
      const dz = o.boat.z - boat.z;
      if (o === r || dx * dx + dz * dz > (25 * k) ** 2 || dx * f[0] + dz * f[1] < 0) continue;
      if (Math.sin(o.boat.heading) * f[0] - Math.cos(o.boat.heading) * f[1] < -0.3) lateral = Math.max(lateral, Math.min(right - 2.5, lateral + 2.5));
    }
  }

  // Keep off anyone alongside (except the boat we're hanging on, and the
  // others in its pack: a diamond's last boat sits between the two hips).
  for (const o of racers) {
    if (o === r || o === leader || (leader && o.ai?.slot?.host === leader)) continue;
    const gap = o.loc.s - loc.s;
    const apart = loc.lateral - o.loc.lateral;
    if (Math.abs(gap) < 7 && Math.abs(apart) < 1.6) lateral += Math.sign(apart || ai.side) * (1.6 - Math.abs(apart)) * 2;
  }
  // Stay off the banks, and get out from behind moored boats in good time.
  const room = roomAhead(course, loc.s, 30 * k);
  lateral = limit(lateral, -(room.left - 2.2), room.right - 2.2);
  // Steer round swans. Swans close together block the water between them, so
  // each group is passed as one, on the side we're already on (there's no
  // cutting across in front of one), unless the bank is in the way and there's
  // still time to go round the other side.
  // Other boats on the river are passed the same way (and an eight coming up
  // behind is let by), each as wide as its oars or hull reach; and an angler's
  // line, from the float in to the bank.
  const swans = [
    ...swansAhead(race.birds, r, course, 30 * k).map((b) => ({ ...b, half: 2.6 })),
    ...boatsNear.map((b) => ({ ...b, half: b.out + 1.5 })),
    ...linesAhead(race.anglers ?? [], r, course, 30 * k),
  ];
  const fits = (x) => x >= -(room.left - 2.2) && x <= room.right - 2.2;
  const blocks = [];
  for (const b of [...swans].sort((a, c) => a.lateral - a.half - (c.lateral - c.half))) {
    const last = blocks.at(-1);
    if (last && b.lateral - b.half < last.hi) Object.assign(last, { hi: Math.max(last.hi, b.lateral + b.half), near: Math.min(last.near, b.s - loc.s), pass: last.pass ?? b.pass });
    else blocks.push({ lo: b.lateral - b.half, hi: b.lateral + b.half, near: b.s - loc.s, pass: b.pass });
  }
  // (Where it's heading, or where it is with the swan or boat close: a boat
  // steering for its place in a pack can be in the way while the place isn't.)
  const block = blocks.find((b) => lateral > b.lo && lateral < b.hi)
    ?? (leader ? blocks.find((b) => loc.lateral > b.lo && loc.lateral < b.hi && b.near < 15 * k) : undefined);
  if (block?.pass) {
    // A boat: by the rule of the river, unless there's no room that side.
    const [mine, other] = block.pass > 0 ? [block.hi, block.lo] : [block.lo, block.hi];
    lateral = fits(mine) || !fits(other) ? mine : other;
  } else if (block) {
    const [mine, other] = loc.lateral < (block.lo + block.hi) / 2 ? [block.lo, block.hi] : [block.hi, block.lo];
    lateral = fits(mine) || block.near < 15 * k ? mine : other;
  }

  const strokes = [];
  if (cadence && race.time >= ai.next) {
    strokes.push(boat.lastSide === 'left' ? 'right' : 'left');
    ai.next = race.time + ai.interval * (1 + (race.rand() - 0.5) * 0.05);
  }

  // Look nearer ahead to swerve round a swan, or to get out of a boat's way.
  const swerve = swans.some((b) => b.pass || b.s - loc.s < 15 * k);
  return { strokes, rudder: steer(r, course, lateral, (swerve ? 7 : 18) * Math.sqrt(k)), lean };
}

// A rival coming up to a portage's beach: stop paddling well before it and
// coast in, back-paddling if still too quick, and jump out once slow enough
// (nudging on if they've stopped short). Null when there's no beach ahead.
function beachAhead(r, race) {
  const { boat, loc } = r;
  const k = race.portages.findIndex((p, i) => !r.portaged?.has(i) && loc.s > p.from - 90 && loc.s < p.from + 5);
  if (k < 0) return null;
  const at = pointAt(race.course, race.portages[k].from);
  const togo = Math.hypot(at.x - boat.x, at.z - boat.z);
  if (togo > 70) return null;
  const lean = clamp(-(boat.roll * 2 + boat.rollRate * 0.6));
  const rudder = steer(r, race.course, 0, Math.max(3, Math.min(togo, 12)));
  const strokes = [];
  const slow = PORTAGE.slow * 0.8;
  if (togo <= PORTAGE.land - 1 && boat.speed <= slow) return { strokes, jump: true, rudder, lean };
  if (race.time >= (r.ai.next ?? 0)) {
    if (boat.speed > slow && togo < 35) strokes.push(boat.lastSide === 'left' ? 'back-right' : 'back-left');
    else if (boat.speed < 0.5 && togo > PORTAGE.land - 1) strokes.push(boat.lastSide === 'left' ? 'right' : 'left');
    if (strokes.length) r.ai.next = race.time + 0.6;
  }
  return { strokes, rudder, lean };
}

// Rudder towards a point `ahead` metres down the river, `lateral` off the middle.
function steer({ boat, loc }, course, lateral, ahead) {
  const aim = pointAt(course, loc.s + ahead);
  const ax = aim.x - aim.tz * lateral;
  const az = aim.z + aim.tx * lateral;
  const err = wrap(Math.atan2(ax - boat.x, -(az - boat.z)) - boat.heading);
  return clamp(err * 3 - boat.yawRate * 0.5);
}

// Hulls as line segments from stern to bow. Overlapping boats are pushed
// apart; the first moment of contact costs both some speed and a wobble.
function collide(race, i, j) {
  const a = race.racers[i].boat;
  const b = race.racers[j].boat;
  if ((a.x - b.x) ** 2 + (a.z - b.z) ** 2 > 7 * 7 || a.swim > 0 || b.swim > 0) return false;
  const key = `${i}-${j}`;
  const ha = hull(a);
  const hb = hull(b);
  let best = null;
  for (let k = 0; k <= 6; k++) {
    for (const [p, seg, sign] of [[lerp(ha, k / 6), hb, 1], [lerp(hb, k / 6), ha, -1]]) {
      const q = closest(seg, p);
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (!best || d < best.d) best = { d, n: [(p[0] - q[0]) * sign, (p[1] - q[1]) * sign] };
    }
  }
  if (best.d >= BEAM) {
    if (best.d > BEAM + 0.4) race.contacts.delete(key); // clear of each other: the next touch is a new hit
    return false;
  }
  const len = best.d || 1;
  const n = best.d ? [best.n[0] / len, best.n[1] / len] : [Math.cos(a.heading), Math.sin(a.heading)];
  const push = (BEAM - best.d) / 2;
  a.x += n[0] * push;
  a.z += n[1] * push;
  b.x -= n[0] * push;
  b.z -= n[1] * push;
  const fresh = !race.contacts.has(key);
  race.contacts.add(key);
  for (const [boat, dir] of [[a, 1], [b, -1]]) {
    // Which way this boat is being shoved: +1 to its right.
    const side = Math.sign((n[0] * Math.cos(boat.heading) + n[1] * Math.sin(boat.heading)) * dir);
    if (fresh) {
      boat.speed *= 0.9;
      boat.rhythm = Math.max(0, boat.rhythm - 0.3);
      boat.rollRate += side * 0.5; // shoved sideways, the hull rolls away from the hit
    } else {
      boat.speed *= 0.9995;
    }
    boat.heading += side * 0.004; // hulls grinding together glance apart
  }
  return fresh;
}

function hull(b) {
  const f = [Math.sin(b.heading), -Math.cos(b.heading)];
  return [[b.x - f[0] * STERN, b.z - f[1] * STERN], [b.x + f[0] * BOW, b.z + f[1] * BOW]];
}

function lerp([a, b], t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function closest([a, b], p) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const t = clamp01(((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz));
  return [a[0] + dx * t, a[1] + dz * t];
}

function bell(x, centre, width) {
  const u = (x - centre) / width;
  return Math.max(0, 1 - u * u);
}

const limit = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const clamp = (v) => limit(v, -1, 1);
const clamp01 = (v) => limit(v, 0, 1);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
