import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOATS, FROM_HULL, hullFor, hullOf, boatById } from '../kayak/boats.js';
import { SKIN_TONES, cleanKit, randomKit, kitKey, livery } from '../kayak/kit.js';
import { HULLS, createBoat } from '../kayak/sim.js';
import { paddlerMesh, limbMesh, kayakMesh } from '../kayak/meshes.js';

test('nine boats, one for each stability from 1 (tippy) to 9 (stable)', () => {
  assert.deepEqual(BOATS.map((b) => b.stability), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(new Set(BOATS.map((b) => b.id)).size, 9);
  for (const b of BOATS) assert.ok(['Nelo', 'Vajda', 'Kirton', 'Marsport', 'Plastex'].includes(b.maker));
  assert.ok(BOATS.some((b) => b.name === 'Kirton Typhoon'));
});

test('a boat handles like the old hulls at 1, 5 and 9, and in between between them', () => {
  const handling = ({ name, ...h }) => h;
  assert.deepEqual(hullFor(1), handling(HULLS.racing));
  assert.deepEqual(hullFor(5), handling(HULLS.club));
  assert.deepEqual(hullFor(9), handling(HULLS.stable));
  const hulls = BOATS.map((b) => hullFor(b.stability));
  for (let i = 1; i < hulls.length; i++) {
    assert.ok(hulls[i].tip <= hulls[i - 1].tip, 'a more stable boat tips no quicker');
    assert.ok(hulls[i].drag >= hulls[i - 1].drag, 'and is no faster');
    assert.ok(hulls[i].beam >= hulls[i - 1].beam, 'and no narrower');
  }
  // A boat races with its own handling.
  assert.equal(createBoat({ hull: hullFor(3) }).hull.tip, hullFor(3).tip);
  assert.equal(createBoat({ hull: 'club' }).hull, HULLS.club);
});

test('wings let you lean further for a touch of drag; a V keel holds a line and turns wider', () => {
  const plain = hullOf({ boat: 'kirton-typhoon' });
  assert.deepEqual(plain, hullFor(3));
  const winged = hullOf({ boat: 'kirton-typhoon', deckShape: 'wings' });
  assert.ok(winged.capsize > plain.capsize && winged.drag > plain.drag);
  const vee = hullOf({ boat: 'kirton-typhoon', hullShape: 'vee' });
  assert.ok(vee.strokeYaw < plain.strokeYaw && vee.rudder < plain.rudder);
  assert.equal(vee.capsize, plain.capsize);
});

test('a saved look is read back safely: anything unknown falls back', () => {
  const kit = randomKit(() => 0.5);
  assert.deepEqual(cleanKit(kit), kit);
  const bad = cleanKit({ skin: '#00ff00', head: 'helmet', headColour: 'red', sleeves: 'none', top: '#ABCDEF', boat: 'canoe', deck: '#12345', stripe: null, glasses: 'monocle', deckShape: 'sail', hullShape: 'flat' });
  assert.equal(bad.glasses, 'none');
  assert.equal(bad.deckShape, 'modern');
  assert.equal(bad.hullShape, 'round');
  assert.ok(SKIN_TONES.includes(bad.skin), 'skin only from the tones');
  assert.equal(bad.head, 'cap');
  assert.equal(bad.sleeves, 'short');
  assert.equal(bad.top, '#abcdef');
  assert.ok(boatById(bad.boat));
  assert.match(bad.deck, /^#[0-9a-f]{6}$/);
  assert.deepEqual(Object.keys(cleanKit(null)), Object.keys(kit));
  // The boat chosen before there were boats carries over.
  assert.equal(cleanKit({ boat: 'racing' }).boat, FROM_HULL.racing);
  assert.equal(randomKit(Math.random, 'stable').boat, FROM_HULL.stable);
});

test('a first visit gets a skin tone at random, each one possible', () => {
  const seen = new Set();
  for (let i = 0; i < SKIN_TONES.length; i++) seen.add(randomKit(() => (i + 0.5) / SKIN_TONES.length).skin);
  assert.equal(seen.size, SKIN_TONES.length);
});

test('the look reaches the meshes: hair or a cap, short sleeves or long', () => {
  const kit = cleanKit({ head: 'hair', sleeves: 'short', top: '#ff0000', skin: SKIN_TONES[5] });
  const l = livery(kit);
  assert.deepEqual(l.top, [1, 0, 0]);
  assert.notDeepEqual(paddlerMesh(l).vertices, paddlerMesh({ ...l, head: 'cap' }).vertices);
  assert.ok(paddlerMesh({ ...l, glasses: 'wrap' }).count > paddlerMesh({ ...l, glasses: 'none' }).count);
  assert.notDeepEqual(kayakMesh({ ...l, wings: true }).vertices, kayakMesh(l).vertices);
  assert.notDeepEqual(kayakMesh({ ...l, vee: true }).vertices, kayakMesh(l).vertices);
  assert.ok(limbMesh(l.top, { skin: l.skin, sleeve: 0.4 }).count > limbMesh(l.top).count);
  assert.notEqual(kitKey(kit), kitKey({ ...kit, deck: '#000000' }));
});
