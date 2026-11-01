// The canoe club's kayak erg: a paddling machine in front of a mirror (no
// screen on it, as on the real ones). A 500 m piece, just for fun. Pure, no DOM.
//
// You paddle it as you paddle the boat: a stroke each side in turn (← and →,
// a thumb each side, LT and RT). Each stroke puts work into the flywheel; its
// power is that work at the rate you paddle, eased over a few strokes, and the
// pace follows from power as the rowing erg's does (erg.js). Up to a steady 90
// a minute is free; quicker is a sprint, which pulls harder and spends stamina,
// and empty you pull no harder than at 90. Two on the same side are weak, as
// in the boat. About 2:38 a 500 m at 60 and 2:14 at 90; a sprint at 110 lasts
// about 40 s and takes about 4 s off.
import { speedOf, paceOf } from './erg.js';

export const KAYAK_ERG = {
  piece: 500, // metres
  quickest: 0.25, // seconds between strokes: quicker taps don't count
  work: 70, // joules a stroke, plus `perRate` for each stroke a minute
  perRate: 0.32,
  sameSide: 0.45, // a second stroke on the same side
  steady: 90, // strokes a minute that cost nothing
  tire: 0.00068, // stamina a stroke for each stroke a minute over `steady`
  refill: 1 / 20, // a second, at `steady` or slower
  ease: 2.5, // seconds the power takes to follow the strokes
  spinDown: 1.5, // seconds for the wheel to lose most of its speed with no strokes
};

export function createKayakErg({ piece = KAYAK_ERG.piece } = {}) {
  return {
    time: 0, // since the first stroke
    started: false,
    metres: 0,
    power: 0,
    stamina: 1,
    last: -Infinity, // the last stroke's time
    side: null, // its side
    gaps: [], // the last two gaps between strokes
    rate: 0, // strokes a minute, both sides counted
    strokes: 0,
    stroke: 0, // the last stroke's work
    piece,
    done: null,
  };
}

// One step. `strokes`: the sides pressed since the last ('left', 'right').
// Returns 'stroke', 'weak' (the same side again) and 'done'.
export function stepKayakErg(erg, dt, { strokes = [] } = {}) {
  const events = [];
  if (erg.done !== null) return events;
  const K = KAYAK_ERG;
  for (const side of strokes) {
    if (side !== 'left' && side !== 'right') continue;
    const now = erg.started ? erg.time : 0;
    // Too quick to count, but it's still the side you paddled on: the next
    // stroke on the other side isn't a weak one.
    if (erg.started && now - erg.last < K.quickest) {
      erg.side = side;
      continue;
    }
    if (!erg.started) {
      erg.started = true;
      erg.time = 0;
    } else {
      erg.gaps = [...erg.gaps, now - erg.last].slice(-2);
    }
    const gap = erg.gaps.length ? erg.gaps.reduce((a, b) => a + b, 0) / erg.gaps.length : 60 / K.steady;
    erg.rate = Math.round(60 / Math.max(gap, K.quickest));
    // A sprint spends stamina; empty, it pulls as a steady beat does.
    const over = Math.max(0, erg.rate - K.steady);
    erg.stamina = Math.max(0, erg.stamina - K.tire * over);
    const pulls = erg.stamina > 0 ? Math.min(erg.rate, 120) : Math.min(erg.rate, K.steady);
    const same = side === erg.side;
    erg.stroke = (K.work + K.perRate * pulls) * (same ? K.sameSide : 1) * (pulls / Math.max(erg.rate, 1));
    erg.last = now;
    erg.side = side;
    erg.strokes++;
    events.push(same ? 'weak' : 'stroke');
  }
  if (!erg.started) return events;
  erg.time += dt;
  const idle = erg.time - erg.last;
  const gap = erg.gaps.length ? erg.gaps[erg.gaps.length - 1] : 60 / K.steady;
  const pulling = idle < Math.max(gap, 0.5) * 1.5 ? erg.stroke * (erg.rate / 60) : 0;
  erg.power += (pulling - erg.power) * Math.min(1, dt / (pulling ? K.ease : K.spinDown));
  if (!pulling && idle > 4) erg.rate = 0;
  if (erg.rate <= K.steady) erg.stamina = Math.min(1, erg.stamina + K.refill * dt);
  erg.metres += speedOf(erg.power) * dt;
  if (erg.metres >= erg.piece) {
    const v = speedOf(erg.power) || 1;
    erg.done = erg.time - (erg.metres - erg.piece) / v;
    erg.metres = erg.piece;
    events.push('done');
  }
  return events;
}

// The numbers: time, metres to go, pace a 500 m, rate, stamina.
export function kayakErgNumbers(erg) {
  return {
    time: erg.done ?? (erg.started ? erg.time : 0),
    left: Math.max(0, Math.ceil(erg.piece - erg.metres)),
    pace: paceOf(erg.power),
    rate: erg.rate,
    stamina: erg.stamina,
  };
}

// For drawing the paddler: the side of the last stroke and when it was, as a
// boat's paddle is kept (`{ at, side }` on the erg's own clock).
export const ergPaddle = (erg) => ({ at: erg.started ? erg.last : -Infinity, side: erg.side });
