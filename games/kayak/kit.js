// Your paddler and boat, as chosen in the menu: remembered on this device, and
// on your account when you're signed in (games.kit). Colours are "#rrggbb".
// Pure: no DOM.
import { BOATS, DEFAULT_BOAT, DECKS as DECK_SHAPES, HULL_SHAPES, PADDLES, FROM_HULL, boatById } from './boats.js';

// Skin tones, lightest to deepest, from real skin. Picked from a set rather
// than a free colour picker so every choice looks like a person; none is the
// default (a first visit gets one at random) and none has a name.
export const SKIN_TONES = ['#f3d6c1', '#e8bf9f', '#d9a47c', '#c48a60', '#a96f47', '#8b5534', '#6c3f25', '#4b2a19'];

export const HEADS = ['cap', 'hair'];
export const SLEEVES = ['short', 'long'];
export const GLASSES = { none: 'None', wrap: 'Wraparound', round: 'Round', aviator: 'Aviator', square: 'Square' };

const HEX = /^#[0-9a-f]{6}$/;
const colour = (v, fallback) => (typeof v === 'string' && HEX.test(v.toLowerCase()) ? v.toLowerCase() : fallback);
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);

const DEFAULT = {
  skin: SKIN_TONES[3],
  head: 'cap', headColour: '#1d4ed8',
  sleeves: 'short', top: '#facc15',
  glasses: 'none', glassesColour: '#0ea5e9',
  boat: DEFAULT_BOAT, deck: '#dc2626', hullColour: '#f2ede0', stripe: '#f5f5f4', deckShape: 'modern', hullShape: 'round',
  paddle: 'wing', shaftColour: '#3a3b42', bladeColour: '#facc15',
};

// Anything read back (storage, the account, another player) made safe and
// complete: unknown values fall back, so a bad copy can't break the game.
export function cleanKit(raw, fallback = DEFAULT) {
  const k = raw && typeof raw === 'object' ? raw : {};
  return {
    skin: oneOf(k.skin, SKIN_TONES, fallback.skin),
    head: oneOf(k.head, HEADS, fallback.head),
    headColour: colour(k.headColour, fallback.headColour),
    sleeves: oneOf(k.sleeves, SLEEVES, fallback.sleeves),
    top: colour(k.top, fallback.top),
    glasses: oneOf(k.glasses, Object.keys(GLASSES), fallback.glasses),
    glassesColour: colour(k.glassesColour, fallback.glassesColour),
    boat: boatById(k.boat) ? k.boat : FROM_HULL[k.boat] ?? fallback.boat,
    deck: colour(k.deck, fallback.deck),
    hullColour: colour(k.hullColour, fallback.hullColour),
    stripe: colour(k.stripe, fallback.stripe),
    deckShape: oneOf(k.deckShape, Object.keys(DECK_SHAPES), fallback.deckShape),
    hullShape: oneOf(k.hullShape, Object.keys(HULL_SHAPES), fallback.hullShape),
    paddle: oneOf(k.paddle, Object.keys(PADDLES), fallback.paddle),
    shaftColour: colour(k.shaftColour, fallback.shaftColour),
    bladeColour: colour(k.bladeColour, fallback.bladeColour),
  };
}

const TOPS = ['#facc15', '#2563eb', '#16a34a', '#dc2626', '#9333ea', '#f97316', '#0891b2', '#111827'];
const DECKS = ['#dc2626', '#facc15', '#2563eb', '#16a34a', '#f97316', '#e5e5e5', '#0891b2', '#9333ea'];
const LENSES = ['#0ea5e9', '#f97316', '#18181b', '#a855f7', '#16a34a'];
const HAIR = ['#1c1410', '#3b2414', '#6b4423', '#a0703c', '#d6b370', '#8c8c8c', '#b5452b'];

// A first visit's paddler: a random skin tone, cap or hair, colours; the
// middle boat. rand: () => 0..1.
export function randomKit(rand = Math.random, hull = null) {
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const head = pick(HEADS);
  return cleanKit({
    skin: pick(SKIN_TONES),
    head,
    headColour: head === 'hair' ? pick(HAIR) : pick(TOPS),
    sleeves: pick(SLEEVES),
    top: pick(TOPS),
    glasses: pick(Object.keys(GLASSES)),
    glassesColour: pick(LENSES),
    boat: FROM_HULL[hull] ?? DEFAULT_BOAT,
    deck: pick(DECKS),
    hullColour: '#f2ede0',
    stripe: '#f5f5f4',
    paddle: 'wing',
    shaftColour: pick(['#3a3b42', '#18181b', '#e5e5e5']),
    bladeColour: pick(DECKS),
  });
}

export const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

// The colours the boat and paddler meshes take (meshes.js), and a key that
// changes whenever any of them does.
export function livery(kit) {
  return {
    deck: rgb(kit.deck), hull: rgb(kit.hullColour), stripe: rgb(kit.stripe),
    top: rgb(kit.top), skin: rgb(kit.skin), cap: rgb(kit.headColour), head: kit.head, sleeves: kit.sleeves,
    glasses: kit.glasses, lens: rgb(kit.glassesColour), wings: kit.deckShape === 'wings', vee: kit.hullShape === 'vee',
    shaft: rgb(kit.shaftColour), blade: rgb(kit.bladeColour), flat: kit.paddle === 'flat',
  };
}
export const kitKey = (kit) => Object.values(cleanKit(kit)).join(',');

export const BOAT_IDS = BOATS.map((b) => b.id);
