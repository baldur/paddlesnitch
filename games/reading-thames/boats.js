// The boats you can race: nine real marathon K1s, one for each step from 1
// (a narrow elite hull, fast and tippy) to 9 (a wide, forgiving trainer).
// Stability ratings are the usual club chart's (0 to 10; the Typhoon is 3.5
// and the Swift 7.5 there); widths in cm where known. Pure: no DOM.
import { HULLS } from './sim.js';

export const BOATS = [
  { id: 'nelo-vanquish-3', maker: 'Nelo', model: 'Vanquish III', stability: 1, width: 40 },
  { id: 'vajda-supersonic', maker: 'Vajda', model: 'Supersonic', stability: 2, width: 42 },
  { id: 'kirton-typhoon', maker: 'Kirton', model: 'Typhoon', stability: 3, width: 40 },
  { id: 'marsport-macros', maker: 'Marsport', model: 'Macros', stability: 4, width: 51 },
  { id: 'vajda-cruiser', maker: 'Vajda', model: 'Cruiser', stability: 5 },
  { id: 'nelo-viper-51', maker: 'Nelo', model: 'Viper 51', stability: 6, width: 51 },
  { id: 'plastex-swift', maker: 'Plastex', model: 'Swift', stability: 7, width: 46 },
  { id: 'kirton-pulsar', maker: 'Kirton', model: 'Pulsar', stability: 8, width: 51 },
  { id: 'vajda-voyageur', maker: 'Vajda', model: 'Voyageur', stability: 9 },
];
for (const b of BOATS) b.name = `${b.maker} ${b.model}`;

export const DEFAULT_BOAT = 'vajda-cruiser';
// The three hulls the game had before, for a saved choice from then.
export const FROM_HULL = { racing: 'nelo-vanquish-3', club: 'vajda-cruiser', stable: 'vajda-voyageur' };

export const boatById = (id) => BOATS.find((b) => b.id === id) ?? null;

// A boat's handling: 1 is the old racing hull, 5 the club racer, 9 the stable
// one, and every number in between is a straight line between those.
export function hullFor(stability) {
  const s = Math.max(1, Math.min(9, stability));
  const [a, b, f] = s <= 5 ? [HULLS.racing, HULLS.club, (s - 1) / 4] : [HULLS.club, HULLS.stable, (s - 5) / 4];
  const hull = {};
  for (const key of Object.keys(a)) if (typeof a[key] === 'number') hull[key] = a[key] + (b[key] - a[key]) * f;
  return hull;
}

// The boat's shape, on top of its stability. Until about 2000 the rules said
// a K1 had to be at least 51 cm wide, so racing hulls were narrow at the water
// with "wings" flaring out at the cockpit to make the width: a diamond deck.
// Wings catch you a little as you lean (you go further before you're in) for
// a touch more drag. A V'd keel (Kirton's Talisman has one) holds a line
// better: strokes push the bow about less, and it turns a little wider.
export const DECKS = { modern: 'Modern', wings: 'Diamond, with wings' };
export const HULL_SHAPES = { round: 'Rounded', vee: "V'd keel" };
// And the paddle: a wing blade (what racers use since the 1980s) pulls
// cleaner; a flat one gives a firmer brace when the boat wobbles.
export const PADDLES = { wing: 'Wing', flat: 'Flat' };
export function hullOf({ boat, deckShape = 'modern', hullShape = 'round', paddle = 'wing' }) {
  const hull = hullFor(boatById(boat)?.stability ?? 5);
  if (deckShape === 'wings') {
    hull.capsize *= 1.1;
    hull.drag *= 1.015;
  }
  if (hullShape === 'vee') {
    hull.strokeYaw *= 0.7;
    hull.rudder *= 0.92;
  }
  if (paddle === 'flat') {
    hull.impulse *= 0.97;
    hull.brace *= 1.2;
  }
  return hull;
}

// What the boat picker says about a boat.
export function describe(boat) {
  const s = boat.stability;
  const feel = s <= 2 ? 'Elite: fast, and tippy. Needs a quick, steady beat'
    : s <= 4 ? 'Quick, and it rewards a tidy stroke'
      : s <= 6 ? 'In between: a club racer'
        : s <= 8 ? 'Steady and forgiving, and slower'
          : 'The steadiest: a trainer to learn in';
  return boat.width ? `${feel}. ${boat.width} cm wide` : feel;
}
