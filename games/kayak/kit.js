// Your paddler and boat, as chosen in the menu: remembered on this device, and
// on your account when you're signed in (games.kit). Colours are "#rrggbb".
// Pure: no DOM.
import { BOATS, DEFAULT_BOAT, DECKS as DECK_SHAPES, HULL_SHAPES, PADDLES, FROM_HULL, boatById } from './boats.js';
import { SCULLS, SCULL_COLOURS, cleanRow, scullById } from './scull.js';

// Skin tones, lightest to deepest, from real skin. Picked from a set rather
// than a free colour picker so every choice looks like a person; none is the
// default (a first visit gets one at random) and none has a name.
export const SKIN_TONES = ['#f3d6c1', '#e8bf9f', '#d9a47c', '#c48a60', '#a96f47', '#8b5534', '#6c3f25', '#4b2a19'];

// Body types: the shape of the shoulders, chest and waist, nothing more. None
// is tied to a gender, and everything else (hair, hats, a beard) goes with any.
export const BODIES = { broad: 'Broad', slim: 'Slim', curvy: 'Curvy' };
export const HAIRS = { short: 'Short', crop: 'Cropped', ponytail: 'Ponytail', bun: 'Bun', long: 'Long', none: 'Shaved' };
export const HATS = { none: 'None', cap: 'Cap', visor: 'Visor', beanie: 'Beanie' };
export const BEARDS = { none: 'None', stubble: 'Stubble', moustache: 'Moustache', beard: 'Beard' };
export const SLEEVES = ['short', 'long'];
export const GLASSES = { none: 'None', wrap: 'Wraparound', round: 'Round', aviator: 'Aviator', square: 'Square' };

const HEX = /^#[0-9a-f]{6}$/;
const colour = (v, fallback) => (typeof v === 'string' && HEX.test(v.toLowerCase()) ? v.toLowerCase() : fallback);
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);

const DEFAULT = {
  skin: SKIN_TONES[3],
  body: 'broad',
  hair: 'short', hairColour: '#3b2414',
  hat: 'cap', hatColour: '#1d4ed8',
  beard: 'none',
  sleeves: 'short', top: '#facc15',
  aid: false, aidColour: '#dc2626',
  glasses: 'none', glassesColour: '#0ea5e9',
  boat: DEFAULT_BOAT, deck: '#dc2626', hullColour: '#f2ede0', stripe: '#f5f5f4', deckShape: 'modern', hullShape: 'round',
  paddle: 'wing', shaftColour: '#3a3b42', bladeColour: '#facc15',
  // The rowing club's: your single scull, and its colour from the set.
  scull: 'club', scullColour: SCULL_COLOURS[0],
};

// Anything read back (storage, the account, another player) made safe and
// complete: unknown values fall back, so a bad copy can't break the game.
export function cleanKit(raw, fallback = DEFAULT) {
  const k = { ...older(raw && typeof raw === 'object' ? raw : {}) };
  return {
    skin: oneOf(k.skin, SKIN_TONES, fallback.skin),
    body: oneOf(k.body, Object.keys(BODIES), fallback.body),
    hair: oneOf(k.hair, Object.keys(HAIRS), fallback.hair),
    hairColour: colour(k.hairColour, fallback.hairColour),
    hat: oneOf(k.hat, Object.keys(HATS), fallback.hat),
    hatColour: colour(k.hatColour, fallback.hatColour),
    beard: oneOf(k.beard, Object.keys(BEARDS), fallback.beard),
    sleeves: oneOf(k.sleeves, SLEEVES, fallback.sleeves),
    top: colour(k.top, fallback.top),
    aid: typeof k.aid === 'boolean' ? k.aid : fallback.aid,
    aidColour: colour(k.aidColour, fallback.aidColour),
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
    scull: oneOf(k.scull, SCULLS.map((b) => b.id), fallback.scull),
    scullColour: oneOf(colour(k.scullColour, ''), SCULL_COLOURS, fallback.scullColour),
  };
}

// A kit saved before body types (2026-10-31) had one thing on the head, a cap
// or hair, in one colour: a cap keeps short hair under it, hair keeps its colour.
function older(k) {
  if (k.hat !== undefined || k.hair !== undefined || k.head === undefined) return k;
  return k.head === 'hair'
    ? { ...k, hat: 'none', hair: 'short', hairColour: k.headColour }
    : { ...k, hat: 'cap', hatColour: k.headColour };
}

const TOPS = ['#facc15', '#2563eb', '#16a34a', '#dc2626', '#9333ea', '#f97316', '#0891b2', '#111827'];
const DECKS = ['#dc2626', '#facc15', '#2563eb', '#16a34a', '#f97316', '#e5e5e5', '#0891b2', '#9333ea'];
const LENSES = ['#0ea5e9', '#f97316', '#18181b', '#a855f7', '#16a34a'];
const HAIR = ['#1c1410', '#3b2414', '#6b4423', '#a0703c', '#d6b370', '#8c8c8c', '#b5452b'];

// A first visit's paddler: a random skin tone, body type, hair, hat and
// colours, each picked on its own; the middle boat. rand: () => 0..1.
export function randomKit(rand = Math.random, hull = null) {
  const pick = (list) => list[Math.floor(rand() * list.length)];
  return cleanKit({
    skin: pick(SKIN_TONES),
    body: pick(Object.keys(BODIES)),
    hair: pick(Object.keys(HAIRS)),
    hairColour: pick(HAIR),
    hat: pick(['none', 'cap', 'cap', 'visor']),
    hatColour: pick(TOPS),
    beard: pick(['none', 'none', 'none', 'stubble', 'moustache', 'beard']),
    sleeves: pick(SLEEVES),
    top: pick(TOPS),
    aid: rand() < 0.3,
    aidColour: pick(DECKS),
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
    top: rgb(kit.top), skin: rgb(kit.skin), body: kit.body, sleeves: kit.sleeves,
    hair: kit.hair, hairColour: rgb(kit.hairColour), hat: kit.hat, cap: rgb(kit.hatColour), beard: kit.beard,
    aid: kit.aid ? rgb(kit.aidColour) : null,
    glasses: kit.glasses, lens: rgb(kit.glassesColour), wings: kit.deckShape === 'wings', vee: kit.hullShape === 'vee',
    shaft: rgb(kit.shaftColour), blade: rgb(kit.bladeColour), flat: kit.paddle === 'flat',
  };
}
export const kitKey = (kit) => Object.values(cleanKit(kit)).join(',');

export const BOAT_IDS = BOATS.map((b) => b.id);

// A scull picked before it went in the kit was kept on the device on its own
// (`row`, { scull, colour }): it carries over, unless the kit saved already has one.
export function withOldScull(kit, saved, row) {
  if (!row || saved?.scull) return kit;
  const { scull, colour } = cleanRow(row);
  return cleanKit({ ...kit, scull, scullColour: colour }, kit);
}

// The boat a leaderboard time records: your kayak, or in a row your scull
// (`scull-` before its id: 'club' was one of the kayak's hulls once). And its name.
export const boardHull = (kit, rowing) => (rowing ? `scull-${kit.scull}` : kit.boat);
export const isScullHull = (hull) => typeof hull === 'string' && hull.startsWith('scull-');
export const scullHullName = (hull) => scullById(hull.slice(6)).name;

// On load: a scull kept on its own on this device (`rowKey`, from before it
// went in the kit) is moved into the kit and the kit saved (`kitKey`), the old
// value removed: once only. A value that can't be read is just dropped.
// `storage` is localStorage (or anything like it); returns the kit.
export function moveOldScull(storage, kit, saved, { rowKey, kitKey: key }) {
  let raw = null;
  try { raw = storage.getItem(rowKey); } catch { return kit; }
  if (raw === null) return kit;
  let row = null;
  try { row = JSON.parse(raw); } catch {}
  const moved = withOldScull(kit, saved, row);
  try {
    if (moved !== kit) storage.setItem(key, JSON.stringify(moved));
    storage.removeItem(rowKey);
  } catch {}
  return moved;
}
