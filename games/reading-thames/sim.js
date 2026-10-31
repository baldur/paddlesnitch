// Kayak physics. Pure state and maths: no DOM, so it runs under Node for tests.
// Units are metres, seconds and radians. Heading 0 points down -z and grows
// clockwise seen from above, so turning right increases it. Roll > 0 leans right.

export const BOAT = {
  // Strokes: each one adds speed; drag takes it away again. Tuned to real K1
  // marathon paddling, counting every blade: about 10 km/h at an easy 60,
  // 13 km/h at a racing 85-90, and 15-16 km/h sprinting at 100-110.
  impulse: 0.7, // m/s from a clean stroke at full stamina
  minInterval: 0.5, // strokes closer together than this catch less water, and rush the rhythm
  minGap: 0.4, // a stroke can't start while the last blade is still in the water: 150 a minute at most
  sameSide: 0.45, // power of a second stroke on the same side
  drag: 0.067, // quadratic
  linearDrag: 0.02,
  strokeTime: 0.5, // how long the blade is in the water

  // Stamina is sprint energy. Paddling quicker than your comfortable beat
  // (`costBeat`: 90 a minute) is a sprint: each stroke pulls harder, up to
  // `sprintBoost` more at `sprintBeat` of the comfortable beat (about 110 a
  // minute), and costs stamina, `cost` a stroke at full sprint, more the
  // quicker the beat. At 90 or under paddling is free and stamina refills.
  // Out of stamina, a quicker beat pulls no harder than the comfortable one.
  // A wash refills it several times faster: sprint up to someone, then rest
  // on their wash.
  cost: 0.035,
  sprintBoost: 0.2,
  sprintBeat: 0.82,
  costBeat: 2 / 3,
  recover: 1 / 30, // per second, at the comfortable beat or slower
  washRecover: 1 / 8, // more per second, at the sweet spot of a wash

  // Flow: holding the rhythm (above `flowRhythm`) slowly builds up to
  // `flowBonus` more power over `flowTime` seconds. Losing the rhythm loses it
  // in a few seconds.
  flowBonus: 0.06,
  flowTime: 20,
  flowRhythm: 0.8,

  // Back strokes: to brake, back off a bank or the start line, or turn on the
  // spot. Each pushes `backImpulse` backwards (so it brakes first), up to
  // `backMax` astern, where the boat drags `backDrag` times more (stern first),
  // and swings the bow towards its side, `backYaw` times as hard as a forward stroke does.
  backImpulse: 0.35,
  backMax: 1.5,
  backDrag: 2,
  backYaw: 4,

  // Steering: the rudder needs speed to bite; strokes nudge the bow.
  rudder: 0.16, // target yaw rate per m/s of speed
  rudderMaxSpeed: 6,
  yawResponse: 2.5,
  strokeYaw: 0.05,

  // Balance: the hull always slowly tips over on its own. At a standstill it
  // goes quickly; with speed, and while a blade is in the water to brace on,
  // it drifts slowly enough that the odd correction keeps you upright.
  tip: 3.0,
  stabilityStill: 2.5,
  stabilitySpeed: 0.3,
  stableSpeed: 3.5,
  rollDamp: 0.9,
  brace: 0.8,
  lean: 2.2,
  turnRoll: 0.35, // turning throws you to the outside
  strokeRoll: 0.25,
  chop: 0.7, // background wobble from the water
  washRock: 1.6, // extra rocking while riding another boat's wash
  capsize: 0.8,
  swimTime: 3.5,

  // Riding another boat's wash: less drag for the same effort.
  draft: 0.3, // drag saved at the sweet spot

  // Rhythm, 0..1: built by a steady, alternating beat, and lost by irregular
  // strokes, pauses, steering and knocks. Strokes out of rhythm pull only
  // `rhythmBase` of their power, so finding your beat again after a bend or a
  // move onto someone's wash costs a burst of effort.
  rhythmGain: 0.1, // per stroke right on the beat
  rhythmSlop: 0.2, // how far off the beat (as a fraction) still counts
  rhythmBase: 0.8,
  slowBeat: 0.8, // seconds per stroke: a lazier beat than this caps your rhythm
  steerCost: 0.2, // rhythm lost per second of full rudder, which also stops it building
  fallCost: 0.4, // a capsize costs this much more speed, and some stamina
  beam: 1, // hull width, for the mesh
};

// The hulls you can race. Narrower is faster and tippier, needs a quicker,
// steadier beat, and a swim costs more. Wider is slower and forgiving.
export const HULLS = {
  stable: {
    ...BOAT, name: 'Stable', beam: 1.3,
    drag: 0.074, tip: 2.5, stabilitySpeed: 0.6,
    rhythmBase: 0.85, rhythmSlop: 0.25, slowBeat: 0.92, swimTime: 3, fallCost: 0.3,
  },
  club: { ...BOAT, name: 'Club racer' },
  racing: {
    ...BOAT, name: 'Racing', beam: 0.8,
    drag: 0.06, tip: 3.6, stabilityStill: 2.4, brace: 0.6,
    rhythmBase: 0.75, slowBeat: 0.74, rhythmSlop: 0.14, swimTime: 5, fallCost: 0.55,
  },
};

// power scales every stroke and endurance scales stamina recovery, so rivals
// can be fitter or weaker than you on the same boat.
// speedup: the course's (see course.js); the boat moves this many times its speed.
// hull: a key of HULLS, or a hull itself (boats.js hullFor).
export function createBoat({ x = 0, z = 0, heading = 0, power = 1, endurance = 1, hull = 'club', speedup = 1 } = {}) {
  return {
    x, z, heading, power, endurance, speedup,
    hull: typeof hull === 'object' ? hull : HULLS[hull],
    rhythm: 0,
    flow: 0, // 0..1, built by holding the rhythm
    sprinting: false, // the last stroke was quicker than the comfortable beat, with stamina to spend
    beat: null, // the stroke interval you've settled into
    steer: 0, // how hard the rudder is working, 0..1
    speed: 0,
    yawRate: 0,
    roll: 0,
    rollRate: 0,
    stamina: 1,
    time: 0,
    lastSide: null,
    lastStroke: -Infinity,
    lastGap: Infinity, // seconds between the last two strokes
    strokeTimes: [], // recent stroke times, for the stroke rate
    paddle: { side: null, at: -Infinity }, // last stroke, for the paddle animation
    swim: 0, // seconds left climbing back in after a capsize
    onBank: false,
    capsizes: 0,
  };
}

// input: { strokes: ['left' | 'right' | 'back-left' | 'back-right', ...],
//          rudder: -1..1, lean: -1..1, draft: 0..1, rock: 0..1 } (draft and rock come from race.js's wash())
// Returns the events that happened, for sound and the HUD:
// 'stroke' | 'weak' | 'back' | 'capsize' | 'remount'.
export function step(boat, dt, input) {
  const H = boat.hull;
  const events = [];
  boat.time += dt;

  if (boat.swim > 0) {
    boat.swim -= dt;
    boat.speed *= Math.exp(-3 * dt);
    if (boat.swim <= 0) {
      Object.assign(boat, { swim: 0, roll: 0, rollRate: 0, yawRate: 0, lastSide: null, rhythm: 0, flow: 0, beat: null, lastGap: Infinity });
      events.push('remount');
    }
    move(boat, dt);
    return events;
  }

  for (const side of input.strokes ?? []) {
    if (boat.time - boat.lastStroke < H.minGap) continue;
    events.push(side.startsWith('back-') ? backStroke(boat, side.slice(5)) : stroke(boat, side));
  }

  // A sprint lasts until a stroke at the comfortable beat or slower, or a pause.
  if (boat.stamina <= 0 || boat.time - boat.lastStroke > steadyBeat(boat) * 1.2) boat.sprinting = false;
  if (!boat.sprinting) boat.stamina = Math.min(1, boat.stamina + (H.recover * boat.endurance + H.washRecover * (input.draft ?? 0)) * dt);
  boat.flow = boat.rhythm >= H.flowRhythm
    ? Math.min(1, boat.flow + dt / H.flowTime)
    : Math.max(0, boat.flow - dt / 3);
  // Drag, against the way the boat is going (more going backwards), never past a standstill.
  const drag = (1 - H.draft * (input.draft ?? 0)) * (boat.speed < 0 ? H.backDrag : 1);
  const slow = drag * (H.drag * boat.speed ** 2 + H.linearDrag * Math.abs(boat.speed)) * dt;
  boat.speed = boat.speed > 0 ? Math.max(0, boat.speed - slow) : Math.min(0, boat.speed + slow);

  // Lose the beat: by pausing, and by leaning on the rudder.
  if (boat.beat && boat.time - boat.lastStroke > boat.beat * 1.6) boat.rhythm = Math.max(0, boat.rhythm - 0.6 * dt);
  // Going backwards the rudder works the other way round, as on a real boat.
  const bite = Math.max(-H.backMax, Math.min(boat.speed, H.rudderMaxSpeed));
  boat.steer = Math.abs(input.rudder ?? 0) * Math.min(1, Math.abs(bite) / 2);
  boat.rhythm = Math.max(0, boat.rhythm - H.steerCost * boat.steer * dt);
  const target = (input.rudder ?? 0) * H.rudder * bite;
  boat.yawRate += (target - boat.yawRate) * Math.min(1, H.yawResponse * dt);
  boat.heading += boat.yawRate * dt;

  const braced = boat.time - boat.paddle.at < H.strokeTime;
  const stability = H.stabilityStill + H.stabilitySpeed * Math.min(Math.abs(boat.speed) / H.stableSpeed, 1);
  const accel = H.tip * Math.sin(boat.roll)
    - stability * boat.roll
    - (H.rollDamp + (braced ? H.brace : 0)) * boat.rollRate
    + H.lean * (input.lean ?? 0)
    - H.turnRoll * boat.yawRate * boat.speed
    + H.chop * chop(boat.time)
    + H.washRock * (input.rock ?? 0) * slap(boat.time);
  boat.rollRate += accel * dt;
  boat.roll += boat.rollRate * dt;

  if (Math.abs(boat.roll) > H.capsize) {
    boat.swim = H.swimTime;
    boat.capsizes++;
    boat.speed *= 0.3 * (1 - H.fallCost);
    boat.stamina = Math.max(0, boat.stamina - H.fallCost * 0.3);
    events.push('capsize');
  }

  move(boat, dt);
  return events;
}

function stroke(boat, side) {
  const H = boat.hull;
  const gap = boat.time - boat.lastStroke;
  let quality = Math.min(1, gap / H.minInterval);
  const repeat = side === boat.lastSide;
  if (repeat) quality *= H.sameSide;
  // Quicker than the comfortable beat is a sprint: the stroke pulls harder and
  // spends stamina. Out of stamina, it pulls no harder than the comfortable
  // beat would. The pace is the average of the last two gaps, so one hurried
  // tap isn't a sprint but two are.
  const comfortable = steadyBeat(boat);
  const pace = Math.max((gap + Math.min(boat.lastGap, 2)) / 2, H.minInterval);
  boat.lastGap = gap;
  const sprint = Math.max(0, Math.min(1, (comfortable / pace - 1) / (1 / H.sprintBeat - 1))); // 0 at 90 a minute, 1 at about 110
  boat.sprinting = sprint > 0 && boat.stamina > 0;
  if (boat.sprinting) {
    quality *= 1 + H.sprintBoost * sprint;
    boat.stamina = Math.max(0, boat.stamina - H.cost * sprint * (comfortable / pace) ** 2);
  } else if (pace < comfortable) {
    quality *= pace / comfortable;
  }
  keepTime(boat, gap, repeat);

  const dir = side === 'left' ? 1 : -1; // a left stroke turns the bow right
  boat.speed += H.impulse * boat.power * quality * (H.rhythmBase + (1 - H.rhythmBase) * boat.rhythm) * (1 + H.flowBonus * boat.flow);
  boat.yawRate += dir * H.strokeYaw * (repeat ? 2.5 : 1) * Math.max(quality, 0.3);
  boat.rollRate += -dir * H.strokeRoll * (repeat ? 2 : 1);

  boat.lastSide = side;
  boat.lastStroke = boat.time;
  boat.paddle = { side, at: boat.time };
  boat.strokeTimes.push(boat.time);
  while (boat.strokeTimes[0] < boat.time - 6) boat.strokeTimes.shift();
  return quality < 0.6 ? 'weak' : 'stroke';
}

// A back stroke on `side`: pushes the boat backwards (braking first) and
// swings the bow towards that side. It breaks your beat, costs no stamina,
// and doesn't count in the stroke rate.
function backStroke(boat, side) {
  const H = boat.hull;
  const dir = side === 'left' ? -1 : 1; // a left back stroke swings the bow left
  boat.speed = Math.max(-H.backMax, boat.speed - H.backImpulse * boat.power);
  boat.yawRate += dir * H.strokeYaw * H.backYaw;
  boat.rollRate += dir * H.strokeRoll;
  boat.rhythm = Math.max(0, boat.rhythm - 0.2);
  boat.beat = null;
  boat.lastGap = Infinity;
  boat.lastSide = null;
  boat.lastStroke = boat.time;
  boat.paddle = { side, at: boat.time, back: true };
  return 'back';
}

// The comfortable beat: quicker than this only pays while sprinting. Fitter
// paddlers (more endurance) have a quicker one.
export function steadyBeat(boat) {
  return boat.hull.costBeat / Math.cbrt(boat.endurance);
}

// Rhythm bookkeeping for one stroke, `gap` seconds after the previous one.
function keepTime(boat, gap, repeat) {
  const H = boat.hull;
  if (repeat) {
    boat.rhythm -= 0.2;
  } else if (gap < H.minInterval) {
    boat.rhythm -= 0.15; // rushing: snatching at the water instead of driving through it
  } else if (!boat.beat || gap > boat.beat * 2) {
    if (boat.beat) boat.rhythm -= 0.25;
    boat.beat = Math.min(gap, 1.3); // starting up: this gap is the first guess at a beat
  } else {
    const off = Math.abs(gap - boat.beat) / boat.beat;
    boat.rhythm += off < H.rhythmSlop ? H.rhythmGain * (1 - off / H.rhythmSlop) * (1 - boat.steer) : -Math.min(0.3, off - H.rhythmSlop);
    boat.beat += (gap - boat.beat) * 0.25; // speeding up or easing off gradually keeps the rhythm
  }
  const cap = Math.min(1, 1 - (boat.beat - H.slowBeat) * 2.5);
  boat.rhythm = Math.max(0, Math.min(cap, boat.rhythm));
}

function move(boat, dt) {
  boat.x += Math.sin(boat.heading) * boat.speed * boat.speedup * dt;
  boat.z -= Math.cos(boat.heading) * boat.speed * boat.speedup * dt;
}

// Strokes per minute over the last few seconds. Measured between strokes, so a
// steady rhythm reads steady; once you stop, the gap since the last stroke drags it down.
export function strokeRate(boat) {
  const recent = boat.strokeTimes.filter((t) => t > boat.time - 6);
  if (recent.length < 2) return 0;
  const intervals = recent.length - 1;
  const span = recent.at(-1) - recent[0];
  const idle = boat.time - recent.at(-1);
  const window = idle > (span / intervals) * 1.5 ? boat.time - recent[0] : span;
  return Math.round((intervals / window) * 60);
}

// A deterministic, irregular wobble so the water never feels perfectly still.
function chop(t) {
  return Math.sin(1.7 * t) * Math.sin(0.37 * t + 1) + 0.5 * Math.sin(2.9 * t + 2) * Math.sin(0.23 * t);
}

// The quicker slap of wash waves against the hull.
function slap(t) {
  return Math.sin(5.3 * t) * (0.6 + 0.4 * Math.sin(0.9 * t + 1)) + 0.4 * Math.sin(8.1 * t + 0.5);
}

// Keeps the boat inside the river. `loc` comes from course.locate(); `left` and
// `right` are how far the open water reaches each side of the centreline (a
// moored boat counts as bank). Hitting the bank costs speed once; after that
// the boat scrapes along it with the bow turned slightly away. Returns true on
// the moment of impact.
export function bounceOffBank(boat, loc, left, right = left) {
  const limit = (loc.lateral < 0 ? left : right) - 1;
  if (Math.abs(loc.lateral) <= limit) {
    boat.onBank = false;
    return false;
  }
  const side = Math.sign(loc.lateral);
  const push = Math.abs(loc.lateral) - limit;
  boat.x -= -loc.tz * side * push;
  boat.z -= loc.tx * side * push;
  const along = Math.atan2(loc.tx, -loc.tz);
  if (wrap(boat.heading - along) * side > 0) {
    boat.heading = along - side * 0.05;
    boat.yawRate = 0;
  }
  const impact = !boat.onBank;
  boat.speed *= impact ? 0.6 : 0.998;
  if (impact) boat.rhythm = Math.max(0, boat.rhythm - 0.4);
  boat.onBank = true;
  return impact;
}

// On a real river (course.shore, water.js): the real banks, islands and moored
// boats. Points along the hull, stern to bow, that are on land or in a boat
// are moved back onto the water; heading into the bank, the boat turns along
// it, at a paddler's rate (`dt` the step): turned in one step, at an island's
// end, where the bank's direction swings round, the view jerked about.
// Returns true at the moment of impact (like bounceOffBank).
const HULL_POINTS = [-1.9, -0.5, 1.6, 3.3]; // metres along from the boat's origin
const BANK_TURN = 6; // radians a second
export function bounceOffShore(boat, shore, dt) {
  const f = [Math.sin(boat.heading), -Math.cos(boat.heading)];
  let push = null;
  // A boat with its own size (a hired narrowboat's `shape`) is checked along its whole length.
  const S = boat.shape;
  const n = S ? Math.ceil((S.bow + S.stern) / 1.5) : 0;
  const points = S ? Array.from({ length: n + 1 }, (_, i) => -S.stern + (i * (S.bow + S.stern)) / n) : HULL_POINTS;
  for (const d of points) {
    const x = boat.x + f[0] * d;
    const z = boat.z + f[1] * d;
    if (!shore.dry(x, z)) continue;
    const out = shore.out(x, z);
    if (!out) continue;
    const by = Math.hypot(out.x - x, out.z - z) + 0.15;
    if (!push || by > push.by) push = { by, nx: out.nx, nz: out.nz };
  }
  if (!push) {
    boat.onBank = false;
    return false;
  }
  boat.x += push.nx * push.by;
  boat.z += push.nz * push.by;
  // Heading into the bank: turn along it, whichever way is nearer.
  const into = -(f[0] * push.nx + f[1] * push.nz);
  if (into > 0) {
    const along = [f[0] + push.nx * into, f[1] + push.nz * into];
    if (Math.hypot(along[0], along[1]) > 0.2) {
      const turn = wrap(Math.atan2(along[0], -along[1]) - boat.heading);
      boat.heading += Math.max(-BANK_TURN * dt, Math.min(BANK_TURN * dt, turn));
    }
    boat.yawRate = 0;
  }
  const impact = !boat.onBank;
  boat.speed *= impact ? 0.6 - 0.3 * Math.max(0, into) : 0.998;
  if (impact) boat.rhythm = Math.max(0, boat.rhythm - 0.4);
  boat.onBank = true;
  return impact;
}

export function wrap(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
