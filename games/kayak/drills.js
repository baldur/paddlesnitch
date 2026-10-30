// Practice drills on the Reading river: starts, wash hanging and the portage.
// Pure, no DOM: main.js makes the race (on the drill's course, with its
// rivals), sets it up with setupDrill, and feeds every step to trackDrill,
// which keeps the drill's numbers, gives a line to show while you're at it,
// and says when a go is done and how it went.
import { pointAt, locate } from './course.js';
import { DIVISION_9 } from './race.js';

// Which course each drill is on and who's with you. Times and distances are
// as shown (race time × warp; on the Reading courses a metre along is a metre).
export const DRILLS = {
  // On the line with a few rivals: the horn, your reaction and the first 100 m.
  start: { course: 'practice', rivals: DIVISION_9.slice(0, 4), distance: 100 },
  // One pacer paddling steadily up the river: sit on its wash as long as you can.
  wash: { course: 'hasler79', rivals: DIVISION_9.slice(1, 2), from: 600, length: 1500 },
  // 150 m below the Mapledurham beach: land, run, get in, and 100 m away.
  portage: { course: 'hasler16', rivals: [], before: 150, after: 100 },
};

// A racer moving at `speed` at `s` along the course, `lateral` off its line,
// with the gates behind them counted as passed.
function put(race, r, s, lateral, speed) {
  const { course } = race;
  const c = pointAt(course, s);
  const x = c.x - c.tz * lateral;
  const z = c.z + c.tx * lateral;
  Object.assign(r.boat, { x, z, heading: Math.atan2(c.tx, -c.tz), speed, speedup: course.speedup ?? 1, roll: 0, rollRate: 0, yawRate: 0 });
  r.loc = locate(course, x, z, course.samples.findIndex((q) => q.s >= s));
  const next = race.gates.findIndex((g) => g.s > s);
  r.gate = next < 0 ? race.gates.length : next;
}

const shown = (race, t) => t * (race.course.warp ?? 1);
const metres = (race, ds) => (ds * (race.course.warp ?? 1)) / (race.course.speedup ?? 1);

// Sets a new race up for the drill and returns its tracker.
export function setupDrill(race, kind) {
  const d = { kind, done: false, readout: '' };
  if (kind === 'wash') {
    const s = race.course.start + DRILLS.wash.from;
    const [pacer] = race.racers.filter((r) => r.ai);
    // Under way already, the pacer just ahead at a steady club pace that it
    // keeps (no sprinting off, no kick for a finish it won't reach).
    put(race, pacer, s + 8, 0, 3.4);
    Object.assign(pacer.ai, { kick: 0, cadence: 0.72, interval: 0.72 });
    put(race, race.player, s, 0, 3.4);
    race.start.phase = 'go';
    Object.assign(d, { end: s + DRILLS.wash.length, pacer, on: 0, streak: 0, best: 0, time: 0 });
  }
  if (kind === 'portage') {
    const p = race.course.portages[0];
    put(race, race.player, p.from - DRILLS.portage.before, 0, 3.5);
    race.start.phase = 'go';
    Object.assign(d, { p, t0: race.time, splits: {}, at: {}, aground: false });
  }
  if (kind === 'start') Object.assign(d, { go: null, reaction: null, falseStarts: 0 });
  return d;
}

// One step of the drill: the step's events (stepRace's, for the player).
// Updates `d.readout`; sets `d.done` and `d.result` ({ title, lines, best })
// when a go is over.
export function trackDrill(d, race, events, dt) {
  if (d.done) return d;
  const r = race.player;
  if (d.kind === 'start') {
    if (events.includes('hold')) d.falseStarts++;
    if (events.includes('go')) d.go = race.time;
    if (d.go === null) {
      d.readout = d.falseStarts ? `False starts: ${d.falseStarts}. Wait for the horn` : 'Paddle up to the line, stop, and wait for the horn';
      return d;
    }
    if (d.reaction === null && events.some((e) => e === 'stroke' || e === 'weak')) d.reaction = race.time - d.go;
    const along = metres(race, r.loc.s - race.start.line);
    const t = shown(race, race.time - d.go);
    d.readout = `${Math.max(0, Math.round(along))} m  ${t.toFixed(1)} s${d.reaction !== null ? `  reaction ${d.reaction.toFixed(2)} s` : ''}`;
    if (along >= DRILLS.start.distance) {
      const place = [...race.racers].sort((a, b) => b.loc.s - a.loc.s).indexOf(r) + 1;
      d.done = true;
      d.result = {
        title: `${DRILLS.start.distance} m in ${t.toFixed(1)} s`,
        lines: [`Reaction to the horn ${d.reaction === null ? '-' : `${d.reaction.toFixed(2)} s`}`, `${ordinal(place)} of ${race.racers.length} at ${DRILLS.start.distance} m`, ...(d.falseStarts ? [`${d.falseStarts} false start${d.falseStarts > 1 ? 's' : ''}`] : [])],
        best: t,
      };
    }
    return d;
  }
  if (d.kind === 'wash') {
    const step = shown(race, dt);
    d.time += step;
    const gap = metres(race, d.pacer.loc.s - r.loc.s);
    if (r.draft > 0.3) {
      d.on += step;
      d.streak += step;
      d.best = Math.max(d.best, d.streak);
      d.readout = `On the wash ${d.streak.toFixed(0)} s  best ${d.best.toFixed(0)} s`;
    } else {
      d.streak = 0;
      d.readout = gap > 1.5 ? `Off the wash: ${gap.toFixed(1)} m back  best ${d.best.toFixed(0)} s` : gap < -1.5 ? `You're past it: ease off and drop back on` : 'Alongside: drop onto its back half';
    }
    if (d.pacer.loc.s >= d.end || r.loc.s >= d.end) {
      d.done = true;
      d.result = {
        title: `Longest on the wash: ${d.best.toFixed(0)} s`,
        lines: [`On it ${Math.round((100 * d.on) / Math.max(1, d.time))}% of ${(d.time / 60).toFixed(1)} minutes`],
        best: -d.best, // longer is better
      };
    }
    return d;
  }
  // The portage: from the start to the beach, out and along the bank, back in, and 100 m away.
  const now = shown(race, race.time - d.t0);
  for (const e of events) {
    if (e === 'aground') d.aground = true;
    if (e === 'landed' || e === 'at-put-in' || e === 'put-in') d.at[e] ??= now;
  }
  const { at } = d;
  const phase = r.portage?.phase;
  d.readout = !at.landed ? (r.beach !== null && r.beach !== undefined ? 'Slow down, then press both sides together to jump out' : 'Paddle in to the beach, slowly')
    : !at['at-put-in'] ? (phase === 'run' ? `Run: tap left, right  ${(r.portage.v * 3.6).toFixed(1)} km/h` : 'Getting out…')
      : !at['put-in'] ? (phase === 'put' ? 'Press both sides together to get in' : 'Getting in…')
        : 'Keep it level, then paddle away';
  if (at['put-in'] !== undefined && metres(race, r.loc.s - d.p.to) >= DRILLS.portage.after) {
    d.done = true;
    d.result = {
      title: `Portage in ${now.toFixed(1)} s`,
      lines: [
        `In to the beach and out ${at.landed.toFixed(1)} s${d.aground ? ' (ran aground)' : ''}`,
        `The run ${(at['at-put-in'] - at.landed).toFixed(1)} s`,
        `Back in ${(at['put-in'] - at['at-put-in']).toFixed(1)} s`,
        `Away ${DRILLS.portage.after} m ${(now - at['put-in']).toFixed(1)} s${r.boat.capsizes ? `, ${r.boat.capsizes} capsize${r.boat.capsizes > 1 ? 's' : ''}` : ''}`,
      ],
      best: now,
    };
  }
  return d;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
