// A single scull: one rower, two oars, one in each hand. Pure state and maths,
// no DOM, so it runs under Node for tests. Same units and directions as
// sim.js (metres, seconds, radians; heading 0 down -z, clockwise; roll > 0
// leans right), and the same boat object (sim.js createBoat with `hull:
// SCULL`), so race.js races it: it steps a scull here instead of sim.js step().
//
// Each oar is its own: press its side (← or →, a thumb, a trigger) and it
// catches, drives for `drive` seconds and recovers. Pressed together (within
// `pair`) the two pull as one stroke and the boat runs straight; one oar, or
// one a little ahead of the other, turns it, as a sculler steers. Uneven
// pulling rocks the boat (gentler than a kayak: the oars on the water hold it
// up), and far enough over you catch a crab: an oar digs in, the boat lurches
// and nearly stops. Paddling into a swan or a boat still tips you in.
import { BOAT } from './sim.js';

export const SCULL = {
  ...BOAT, // the fields the race and the HUD read on any boat
  name: 'Single scull',
  scull: true,
  length: 8.2,
  beam: 0.3,
  // The stroke. An oar's drive lasts `drive`; it can't catch again until it's
  // been round the recovery, `recover` at the quickest: about 40 a minute.
  drive: 0.7,
  recover: 0.8,
  pair: 0.2, // seconds apart that still count as one stroke of both oars
  // Each full stroke adds `impulse` m/s, spread over the drive: tuned to a club
  // sculler, about 12 km/h at an easy 22, 15 km/h at a racing 32, 16-17 flat out.
  impulse: 1.9,
  drag: 0.052,
  linearDrag: 0.015,
  // Turning: one oar alone swings the bow round; the fin damps the turn
  // away, more quickly with speed.
  oarYaw: 1.6, // radians a second per second of one oar's drive
  fin: 1.2,
  finSpeed: 0.5,
  // Balance: the hull tips over on its own, slowly; the oars hold it up,
  // more while they're in the water, and most sitting still with the blades
  // flat on the water. Pulling one oar harder than the other rolls it.
  tip: 1.4,
  stabilityStill: 2.6,
  stabilitySpeed: 0.6,
  stableSpeed: 3.5,
  rollDamp: 1.6,
  brace: 1.4,
  lean: 1.4,
  oarRoll: 3.2, // roll from one oar's catch with no other to balance it
  lone: 0.8, // the pull left when one oar's in alone
  chop: 0.3,
  washRock: 0.9,
  crabAt: 0.32, // radians over: an oar digs in
  crabTime: 1.4, // seconds to get going again
  capsize: 0.9, // only a knock tips you this far: a swan, a boat
  swimTime: 4,
  fallCost: 0.4,
  // Pace: quicker than `comfortable` strokes a minute spends stamina, which
  // comes back at that rate or slower; out of it, strokes pull no harder.
  comfortable: 30,
  cost: 0.02,
  refill: 1 / 25,
  boost: 0.12, // a sprint stroke pulls this much harder at 40 a minute
  // Rhythm: strokes of both oars together, at a steady rate, build it; it's
  // worth up to `rhythmBonus` more power.
  rhythmBonus: 0.06,
};

const CATCH = 0.15; // seconds of an oar's catch

// A boat's rowing state, added on its first step.
const fresh = () => ({ left: { at: -Infinity, end: -Infinity, ready: -Infinity }, right: { at: -Infinity, end: -Infinity, ready: -Infinity }, cycle: -Infinity, gap: 2.5, crab: 0, lastRate: 0 });

export function stepScull(boat, dt, input) {
  const H = boat.hull;
  const events = [];
  const o = (boat.oars ??= fresh());
  boat.time += dt;
  const t = boat.time;

  if (boat.swim > 0) {
    boat.swim -= dt;
    boat.speed *= Math.exp(-3 * dt);
    if (boat.swim <= 0) {
      Object.assign(boat, { swim: 0, roll: 0, rollRate: 0, yawRate: 0, rhythm: 0 });
      boat.oars = fresh();
      events.push('remount');
    }
    move(boat, dt);
    return events;
  }

  // A crab: no rowing until the oar's free and you're sat up again.
  if (o.crab > 0) {
    o.crab -= dt;
    boat.speed *= Math.exp(-2.5 * dt);
  } else {
    for (const s of input.strokes ?? []) {
      const side = s.endsWith('left') ? 'left' : 'right';
      const oar = o[side];
      if (t < oar.ready) {
        events.push('rush'); // still on the recovery
        continue;
      }
      oar.at = t;
      oar.end = t + H.drive;
      oar.ready = t + H.drive + H.recover;
      oar.back = s.startsWith('back-');
      const other = o[side === 'left' ? 'right' : 'left'];
      if (t - other.at < H.pair && !other.back === !oar.back) {
        // The two finish together, so the oar in first pulls the longer
        // stroke and the bow comes round a little: steering by timing.
        oar.end = other.end;
        oar.ready = other.ready;
        o.alone = false;
        // The second oar of a stroke of both: how well they were together.
        boat.rhythm = Math.min(1, boat.rhythm + 0.12 * (1 - (t - other.at) / H.pair));
        events.push('stroke');
        continue;
      }
      // A new stroke: its rate, for the coach and the stamina.
      const gap = t - o.cycle;
      if (gap < 6) {
        o.gap = gap;
        // Steady strokes of both oars keep it; a change of pace or a lone oar costs it.
        const off = Math.abs(gap - (o.lastGap ?? gap)) / gap;
        if (off > 0.15 || o.alone) boat.rhythm = Math.max(0, boat.rhythm - 0.15);
      } else {
        boat.rhythm = Math.max(0, boat.rhythm - 0.3);
      }
      o.lastGap = gap;
      o.cycle = t;
      const rate = 60 / Math.max(gap, 0.5); // (alternating oars count each as a stroke: it costs)
      const sprint = gap < 6 ? Math.max(0, (rate - H.comfortable) / 10) : 0;
      boat.sprinting = sprint > 0 && boat.stamina > 0;
      if (boat.sprinting) boat.stamina = Math.max(0, boat.stamina - H.cost * sprint * 2);
      o.power = boat.sprinting ? 1 + H.boost * Math.min(1, sprint) : 1;
      o.alone = true; // until the other oar joins it
      boat.strokeTimes.push(t);
      while (boat.strokeTimes[0] < t - 8) boat.strokeTimes.shift();
      boat.lastStroke = t;
      boat.paddle = { side, at: t };
      events.push(oar.back ? 'back' : 'stroke');
    }
  }
  if (!boat.sprinting || t - o.cycle > 4) {
    boat.sprinting = false;
    boat.stamina = Math.min(1, boat.stamina + H.refill * boat.endurance * dt);
  }

  // Each oar in the water pulls (or, backing down, pushes) half a stroke and
  // turns the bow away from its side; a lone oar also rolls the boat.
  let thrust = 0;
  let yaw = 0;
  let roll = 0;
  let inWater = 0;
  for (const side of ['left', 'right']) {
    const oar = o[side];
    if (t >= oar.end) continue;
    inWater++;
    const dir = side === 'left' ? 1 : -1; // the left oar turns the bow right
    const push = oar.back ? -0.6 : 1;
    thrust += push * (H.impulse / 2 / H.drive) * boat.power * (o.alone ? 1 : o.power ?? 1) * (1 + H.rhythmBonus * boat.rhythm);
    yaw += push * dir * H.oarYaw;
    // The catch jolts the boat towards a lone oar's side (the other blade,
    // resting on the water, steadies it after that).
    if (t - oar.at < CATCH) roll += -dir * H.oarRoll / CATCH * 0.15;
  }
  // Two oars in together: their turns and rolls cancel, near enough; one
  // alone wastes some of its pull swinging the bow round.
  if (inWater === 2) roll *= 0.1;
  else thrust *= H.lone;
  boat.speed += thrust * dt;
  const slow = (H.drag * boat.speed ** 2 + H.linearDrag * Math.abs(boat.speed)) * dt * (boat.speed < 0 ? 3 : 1);
  boat.speed = boat.speed > 0 ? Math.max(0, boat.speed - slow) : Math.min(0, boat.speed + slow);

  boat.yawRate += (yaw - boat.yawRate * (H.fin + H.finSpeed * Math.abs(boat.speed))) * dt;
  // The rudder (a phone's twist, or a finger slid): a gentle nudge, as a
  // sculler leans on one hand a little harder.
  boat.yawRate += (input.rudder ?? 0) * 0.25 * Math.min(1, Math.abs(boat.speed) / 2) * dt;
  boat.heading += boat.yawRate * dt;

  const resting = inWater === 0 && t - Math.max(o.left.at, o.right.at) > H.drive + 0.3;
  const stability = H.stabilityStill * (resting && boat.speed < 1 ? 1.3 : 1) + H.stabilitySpeed * Math.min(Math.abs(boat.speed) / H.stableSpeed, 1);
  const accel = H.tip * Math.sin(boat.roll) - stability * boat.roll
    - (H.rollDamp + (inWater ? H.brace : 0)) * boat.rollRate
    + H.lean * (input.lean ?? 0) + roll
    + H.chop * chop(t) + H.washRock * (input.rock ?? 0) * slap(t);
  boat.rollRate += accel * dt;
  boat.roll += boat.rollRate * dt;

  if (Math.abs(boat.roll) > H.capsize) {
    boat.swim = H.swimTime;
    boat.capsizes++;
    boat.speed *= 0.3 * (1 - H.fallCost);
    events.push('capsize');
  } else if (Math.abs(boat.roll) > H.crabAt && o.crab <= 0) {
    // Too far over: the low oar digs in and stops the boat; you sit it level again.
    o.crab = H.crabTime;
    boat.crabs = (boat.crabs ?? 0) + 1;
    boat.speed *= 0.35;
    boat.rollRate = -Math.sign(boat.roll) * 0.6;
    boat.rhythm = 0;
    o.left.at = o.right.at = o.left.end = o.right.end = -Infinity;
    events.push('crab');
  }

  move(boat, dt);
  return events;
}

function move(boat, dt) {
  boat.x += Math.sin(boat.heading) * boat.speed * boat.speedup * dt;
  boat.z -= Math.cos(boat.heading) * boat.speed * boat.speedup * dt;
}

// Strokes a minute, from the gap between the last two (the coach's number).
export function scullRate(boat) {
  const o = boat.oars;
  if (!o || boat.time - o.cycle > 6) return 0;
  return Math.round(60 / Math.max(o.gap, boat.time - o.cycle, 0.5));
}

// Seconds per 500 m at the boat's speed (through the world, as the HUD shows
// it, `warp` its distances), or null when hardly moving.
export function split(boat, warp = 1) {
  const v = boat.speed * warp;
  return v > 0.3 ? 500 / v : null;
}

// How the rower and the oars look now, for drawing. `slide` 0 at the finish
// (sat back, legs flat, hands in) to 1 at the catch (knees up, arms out);
// each oar's `sweep` -1 at the catch (hands reaching towards the stern, so
// the blade out towards the bow) to 1 at the finish (hands in, blade towards
// the stern), its `depth` 0 (out) to 1 (buried) and `feather` (the blade flat
// on the recovery).
export function scullPose(boat) {
  const H = boat.hull;
  const o = boat.oars ?? fresh();
  const t = boat.time;
  const smooth = (x) => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k); };
  const oar = (side) => {
    const p = t - o[side].at;
    const len = o[side].end - o[side].at;
    if (t < o[side].end) {
      // The drive: in at the catch, through, out at the finish (a second oar
      // in late starts further through, so both come out together).
      const k = 1 - (o[side].end - t) / H.drive;
      return { sweep: -1 + 2 * smooth(k), depth: Math.min(1, k / 0.12, (1 - k) / 0.12), feather: false };
    }
    // The recovery: hands away, then up the slide to the catch, at the rate rowed.
    const back = Math.max(H.recover, Math.min(o.gap - H.drive, 2));
    const k = (p - len) / back;
    return { sweep: 1 - 2 * smooth((k - 0.15) / 0.85), depth: 0, feather: k > 0.05 && k < 0.92 && p < len + back * 1.2 };
  };
  const left = oar('left');
  const right = oar('right');
  // The slide follows the oar most recently in.
  const lead = o.left.at > o.right.at ? left : right;
  const idle = t - Math.max(o.left.at, o.right.at) > H.drive + Math.max(H.recover, Math.min(o.gap - H.drive, 2)) * 1.2;
  const slide = idle ? 0.15 : (1 - lead.sweep) / 2;
  if (idle) {
    // Sitting easy: blades flat on the water, square to the boat.
    for (const b of [left, right]) Object.assign(b, { sweep: 0.3, depth: 0, feather: true });
  }
  return { slide, left, right, crab: o.crab > 0 };
}

function chop(t) {
  return Math.sin(1.7 * t) * Math.sin(0.37 * t + 1) + 0.5 * Math.sin(2.9 * t + 2) * Math.sin(0.23 * t);
}
function slap(t) {
  return Math.sin(5.3 * t) * (0.6 + 0.4 * Math.sin(0.9 * t + 1)) + 0.4 * Math.sin(8.1 * t + 0.5);
}

// The rowing club's three sculls, on its boathouse rack: a wide trainer that
// forgives, the club's racing single, and a fine boat that's quick and twitchy.
export const SCULLS = [
  { id: 'trainer', name: 'Trainer single', line: 'Wide and steady: hard to catch a crab', hull: { ...SCULL, name: 'Trainer single', beam: 0.38, drag: 0.058, crabAt: 0.4, tip: 1.1, stabilityStill: 3 } },
  { id: 'club', name: 'Club single', line: 'The club racer: quick enough, forgiving enough', hull: SCULL },
  { id: 'fine', name: 'Fine single', line: 'Narrow and quick: keep it level', hull: { ...SCULL, name: 'Fine single', beam: 0.26, drag: 0.047, crabAt: 0.26, tip: 1.7, stabilityStill: 2.3 } },
];
export const scullById = (id) => SCULLS.find((s) => s.id === id) ?? SCULLS[1];
// A scull's colours, picked from a set (painting it in the boathouse goes round them).
export const SCULL_COLOURS = ['#f2ede0', '#f5d33a', '#2f6fd1', '#c8332b', '#1f8a5b', '#222428'];
