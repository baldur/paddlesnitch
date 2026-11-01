// The rowing club's ergs: a 500 m piece, just for fun. Pure, no DOM.
//
// A stroke is either side (both together count once). Each puts work into the
// flywheel; its power is that work at the rate you're rowing, eased over a
// few strokes as a real monitor does, and the pace follows from power the way
// rowing machines work it out: watts = 2.8 / (seconds per metre)³. A 500 m
// takes about 2:28 at an easy 20, 2:03 at 30 and 1:55 flat out at 38 (where
// the legs give out), holding a steady rate; stop and the wheel runs down.
export const ERG = {
  piece: 500, // metres
  drive: 0.8,
  recover: 0.7, // at the quickest: about 40 a minute
  pair: 0.2, // both sides this close are one stroke
  work: 330, // joules a stroke at an easy rate
  perRate: 6, // more a stroke for each stroke a minute above 20 (you pull harder rating up)
  comfortable: 30,
  tire: 0.012, // stamina a stroke for each stroke a minute above `comfortable`
  refill: 1 / 20,
  ease: 2.5, // seconds the shown power takes to follow
  spinDown: 1.5, // seconds for the wheel to lose most of its speed with no strokes
};

export function createErg({ piece = ERG.piece, pace = null } = {}) {
  return {
    time: 0, // since the first stroke
    started: false,
    metres: 0,
    power: 0, // watts, as shown
    stamina: 1,
    last: -Infinity, // the last stroke's catch
    gap: 2.5,
    rate: 0,
    strokes: 0,
    piece,
    done: null, // the time, once the piece is rowed
    // Someone on the next erg, rowing a steady `pace` (seconds a 500 m).
    other: pace ? { pace, metres: 0 } : null,
  };
}

export const paceOf = (watts) => (watts > 1 ? 500 * Math.cbrt(2.8 / watts) : null); // seconds a 500 m
export const speedOf = (watts) => (watts > 1 ? Math.cbrt(watts / 2.8) : 0); // metres a second

// One step. `strokes`: the sides pressed since the last ('left', 'right').
// Returns 'stroke', 'rush' (still on the recovery) or 'done'.
export function stepErg(erg, dt, { strokes = [] } = {}) {
  const events = [];
  if (erg.done !== null) return events; // the piece is rowed: the monitor holds the time
  const now = erg.started ? erg.time : 0;
  for (const s of strokes) {
    void s;
    const since = now - erg.last;
    if (since < ERG.pair) continue; // the other hand of the same stroke
    if (erg.started && since < ERG.drive + ERG.recover) {
      events.push('rush');
      continue;
    }
    if (!erg.started) {
      erg.started = true;
      erg.time = 0;
    }
    const gap = erg.time - erg.last;
    erg.gap = gap < 8 ? gap : erg.gap;
    erg.last = erg.time;
    erg.strokes++;
    erg.rate = Math.round(60 / Math.max(erg.gap, 1.2));
    const over = Math.max(0, erg.rate - ERG.comfortable);
    erg.stamina = Math.max(0, erg.stamina - ERG.tire * over);
    // Harder the higher you rate, while you've the legs for it.
    const work = ERG.work + ERG.perRate * Math.max(0, Math.min(erg.rate, 40) - 20) * (erg.stamina > 0 ? 1 : 0.3);
    erg.stroke = work;
    events.push('stroke');
  }
  if (!erg.started) return events;
  erg.time += dt;
  // The power the strokes are putting in, and the shown power easing to it.
  const idle = erg.time - erg.last;
  const pulling = idle < Math.max(erg.gap, ERG.drive + ERG.recover) * 1.3 ? (erg.stroke ?? 0) / Math.max(erg.gap, 1.2) : 0;
  erg.power += (pulling - erg.power) * Math.min(1, dt / (pulling ? ERG.ease : ERG.spinDown));
  if (!pulling && erg.rate) erg.rate = idle > 6 ? 0 : erg.rate;
  if (erg.rate <= ERG.comfortable) erg.stamina = Math.min(1, erg.stamina + ERG.refill * dt);
  erg.metres += speedOf(erg.power) * dt;
  if (erg.other) erg.other.metres += (500 / erg.other.pace) * dt;
  if (erg.metres >= erg.piece) {
    // The finish, to the tenth, from where in this step it was crossed.
    const v = speedOf(erg.power) || 1;
    erg.done = erg.time - (erg.metres - erg.piece) / v;
    erg.metres = erg.piece;
    events.push('done');
  }
  return events;
}

// The monitor's numbers.
export function monitor(erg) {
  return {
    time: erg.done ?? (erg.started ? erg.time : 0),
    metres: Math.floor(erg.metres),
    left: Math.max(0, Math.ceil(erg.piece - erg.metres)),
    pace: paceOf(erg.power),
    watts: Math.round(erg.power),
    rate: erg.rate,
    other: erg.other ? Math.floor(erg.other.metres) : null,
  };
}

// The rower's pose for drawing: `slide` 0 at the finish (legs flat, handle
// in) to 1 at the catch; `arms` how far out the hands reach (0 in, 1 out).
export function ergPose(erg) {
  const smooth = (x) => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k); };
  const p = erg.started ? erg.time - erg.last : Infinity;
  if (p < ERG.drive) {
    const k = p / ERG.drive;
    // Legs, then back, then arms.
    return { slide: 1 - smooth(k / 0.7), arms: 1 - smooth((k - 0.5) / 0.5) };
  }
  const back = Math.max(ERG.recover, Math.min(erg.gap - ERG.drive, 2.5));
  const k = (p - ERG.drive) / back;
  if (k > 1.3) return { slide: 0.05, arms: 0.4 }; // easy, handle resting
  // Arms away, then up the slide.
  return { slide: smooth((k - 0.25) / 0.75), arms: smooth(k / 0.25) };
}

// What you're told at the end of a piece: the time, a new best or the old one,
// and whether you beat the rower next to you.
export function ergResult(done, best, otherMetres, piece = ERG.piece) {
  const record = !best || done < best;
  const parts = [`500 m in ${clock(done)}${record && best ? ', a new best!' : '.'}`];
  if (!record) parts.push(`Your best: ${clock(best)}.`);
  if (otherMetres < piece) parts.push('You beat the rower next to you.');
  return { text: parts.join(' '), record };
}
const clock = (t) => `${Math.floor(t / 60)}:${(t - Math.floor(t / 60) * 60).toFixed(1).padStart(4, '0')}`;
