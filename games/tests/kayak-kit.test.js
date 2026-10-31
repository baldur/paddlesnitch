import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOATS, FROM_HULL, hullFor, hullOf, boatById } from '../kayak/boats.js';
import { SKIN_TONES, BODIES, HAIRS, HATS, BEARDS, cleanKit, randomKit, kitKey, livery } from '../kayak/kit.js';
import { HULLS, createBoat } from '../kayak/sim.js';
import { paddlerMesh, limbMesh, kayakMesh, paddleMesh, shoulderOf } from '../kayak/meshes.js';
import { paddlerSvg } from '../kayak/picture.js';

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
  // A flat paddle braces better, a wing pulls harder.
  const flat = hullOf({ boat: 'kirton-typhoon', paddle: 'flat' });
  assert.ok(flat.brace > plain.brace && flat.impulse < plain.impulse);
});

test('a saved look is read back safely: anything unknown falls back', () => {
  const kit = randomKit(() => 0.5);
  assert.deepEqual(cleanKit(kit), kit);
  assert.equal(cleanKit({ paddle: 'canoe' }).paddle, 'wing');
  const bad = cleanKit({ skin: '#00ff00', body: 'robot', hair: 'mohican', hairColour: 'red', hat: 'helmet', hatColour: 'blue', beard: 'goatee', aid: 'yes', aidColour: '#zzzzzz', sleeves: 'none', top: '#ABCDEF', boat: 'canoe', deck: '#12345', stripe: null, glasses: 'monocle', deckShape: 'sail', hullShape: 'flat' });
  assert.equal(bad.glasses, 'none');
  assert.equal(bad.deckShape, 'modern');
  assert.equal(bad.hullShape, 'round');
  assert.ok(SKIN_TONES.includes(bad.skin), 'skin only from the tones');
  assert.equal(bad.body, 'man');
  assert.equal(bad.hair, 'short');
  assert.equal(bad.hat, 'cap');
  assert.equal(bad.beard, 'none');
  assert.equal(bad.aid, false);
  assert.match(bad.hairColour, /^#[0-9a-f]{6}$/);
  assert.match(bad.aidColour, /^#[0-9a-f]{6}$/);
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

test('a paddler saved before body types keeps their look: a cap stays a cap, hair keeps its colour', () => {
  const capped = cleanKit({ head: 'cap', headColour: '#123456', top: '#ff0000' });
  assert.equal(capped.hat, 'cap');
  assert.equal(capped.hatColour, '#123456');
  assert.equal(capped.top, '#ff0000');
  const haired = cleanKit({ head: 'hair', headColour: '#a0703c' });
  assert.equal(haired.hat, 'none');
  assert.equal(haired.hair, 'short');
  assert.equal(haired.hairColour, '#a0703c');
  assert.ok(!('head' in haired) && !('headColour' in haired), 'the old fields are gone');
});

test('a first visit can be a man or a woman, and a beard only comes with a man', () => {
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    let n = i * 7919;
    const k = randomKit(() => ((n = (n * 16807 + 11) % 2147483647) / 2147483647));
    seen.add(k.body);
    if (k.body === 'woman') assert.equal(k.beard, 'none');
  }
  assert.deepEqual([...seen].sort(), ['man', 'woman']);
});

test("a woman's build: narrower shoulders, a waist, and the arms from her shoulders", () => {
  const l = livery(cleanKit({ body: 'woman' }));
  const man = paddlerMesh({ ...l, body: 'man' });
  const woman = paddlerMesh(l);
  assert.notDeepEqual(woman.vertices, man.vertices);
  const widest = (mesh, y0, y1) => {
    let w = 0;
    for (let i = 0; i < mesh.vertices.length; i += 9) if (mesh.vertices[i + 1] > y0 && mesh.vertices[i + 1] < y1) w = Math.max(w, Math.abs(mesh.vertices[i]));
    return w;
  };
  assert.ok(widest(woman, 0.55, 0.62) < widest(man, 0.55, 0.62), 'narrower at the shoulders');
  assert.ok(shoulderOf('woman').x < shoulderOf('man').x);
  assert.equal(shoulderOf(undefined), shoulderOf('man'), "a rival with no body set is a man's build");
});

test('every hair, hat and beard is drawn, and a buoyancy aid goes over the top', () => {
  const l = livery(cleanKit({ hat: 'none', hair: 'short', beard: 'none' }));
  const look = (o) => [...paddlerMesh({ ...l, ...o }).vertices].join();
  for (const [field, list] of [['hair', HAIRS], ['hat', HATS], ['beard', BEARDS], ['body', BODIES]]) {
    const drawn = Object.keys(list).map((v) => look({ [field]: v }));
    assert.equal(new Set(drawn).size, drawn.length, `each ${field} looks different`);
    const pictures = Object.keys(list).map((v) => paddlerSvg(cleanKit({ [field]: v, hat: field === 'hat' ? v : 'none' })));
    assert.equal(new Set(pictures).size, pictures.length, `and each ${field} has its own picture`);
  }
  assert.ok(paddlerMesh({ ...l, aid: [1, 0, 0] }).count > paddlerMesh(l).count);
  assert.notEqual(paddlerSvg(cleanKit({ aid: true })), paddlerSvg(cleanKit({ aid: false })));
  // Small enough for a pack of rivals.
  assert.ok(paddlerMesh({ ...l, body: 'woman', hair: 'long', hat: 'beanie', beard: 'beard', aid: [1, 0, 0], glasses: 'round' }).count / 3 < 900);
});

test('the look reaches the meshes: short sleeves or long', () => {
  const kit = cleanKit({ hair: 'short', sleeves: 'short', top: '#ff0000', skin: SKIN_TONES[5] });
  const l = livery(kit);
  assert.deepEqual(l.top, [1, 0, 0]);
  assert.ok(paddlerMesh({ ...l, glasses: 'wrap' }).count > paddlerMesh({ ...l, glasses: 'none' }).count);
  assert.notDeepEqual(kayakMesh({ ...l, wings: true }).vertices, kayakMesh(l).vertices);
  assert.notDeepEqual(kayakMesh({ ...l, vee: true }).vertices, kayakMesh(l).vertices);
  assert.notDeepEqual(paddleMesh({ ...l, flat: true }).vertices, paddleMesh({ ...l, flat: false }).vertices);
  assert.deepEqual(livery(cleanKit({ hullColour: '#000000' })).hull, [0, 0, 0]);
  assert.ok(limbMesh(l.top, { skin: l.skin, sleeve: 0.4 }).count > limbMesh(l.top).count);
  assert.notEqual(kitKey(kit), kitKey({ ...kit, deck: '#000000' }));
});
