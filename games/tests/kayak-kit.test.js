import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOATS, FROM_HULL, hullFor, hullOf, boatById } from '../kayak/boats.js';
import { SKIN_TONES, BODIES, HAIRS, HATS, BEARDS, cleanKit, randomKit, kitKey, livery, withOldScull, moveOldScull, boardHull, isScullHull, scullHullName } from '../kayak/kit.js';
import { SCULLS, SCULL_COLOURS } from '../kayak/scull.js';
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
  const bad = cleanKit({ skin: '#00ff00', body: 'man', hair: 'mohican', hairColour: 'red', hat: 'helmet', hatColour: 'blue', beard: 'goatee', aid: 'yes', aidColour: '#zzzzzz', sleeves: 'none', top: '#ABCDEF', boat: 'canoe', deck: '#12345', stripe: null, glasses: 'monocle', deckShape: 'sail', hullShape: 'flat' });
  assert.equal(bad.glasses, 'none');
  assert.equal(bad.deckShape, 'modern');
  assert.equal(bad.hullShape, 'round');
  assert.ok(SKIN_TONES.includes(bad.skin), 'skin only from the tones');
  assert.equal(bad.body, 'broad');
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

test("a first visit's body type, hair and beard are each picked on their own: every pairing turns up", () => {
  const seen = new Set();
  let n = 7919;
  const rand = () => ((n = (n * 16807 + 11) % 2147483647) / 2147483647);
  for (let i = 0; i < 400; i++) {
    const k = randomKit(rand);
    seen.add(`${k.body}:${k.beard !== 'none'}`);
    seen.add(`${k.body}:${k.hair}`);
  }
  for (const body of Object.keys(BODIES)) {
    for (const beard of [true, false]) assert.ok(seen.has(`${body}:${beard}`), `${body} with${beard ? '' : 'out'} a beard`);
    for (const hair of Object.keys(HAIRS)) assert.ok(seen.has(`${body}:${hair}`), `${body} with ${hair} hair`);
  }
});

test('the body types differ in shape only: narrower shoulders than broad, and the arms from those shoulders', () => {
  const l = livery(cleanKit({}));
  const widest = (mesh, y0, y1) => {
    let w = 0;
    for (let i = 0; i < mesh.vertices.length; i += 9) if (mesh.vertices[i + 1] > y0 && mesh.vertices[i + 1] < y1) w = Math.max(w, Math.abs(mesh.vertices[i]));
    return w;
  };
  const broad = paddlerMesh({ ...l, body: 'broad' });
  for (const body of ['slim', 'curvy']) {
    const mesh = paddlerMesh({ ...l, body });
    assert.notDeepEqual(mesh.vertices, broad.vertices);
    assert.ok(widest(mesh, 0.55, 0.62) < widest(broad, 0.55, 0.62), `${body}: narrower at the shoulders`);
    assert.ok(shoulderOf(body).x < shoulderOf('broad').x);
  }
  assert.equal(shoulderOf(undefined), shoulderOf('broad'), 'a rival with no body type set is broad');
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
  assert.ok(paddlerMesh({ ...l, body: 'curvy', hair: 'long', hat: 'beanie', beard: 'beard', aid: [1, 0, 0], glasses: 'round' }).count / 3 < 900);
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

test('your scull and its colour are in the kit, read back safely, so they follow you on the account', () => {
  const kit = cleanKit({ scull: 'fine', scullColour: SCULL_COLOURS[3] });
  assert.equal(kit.scull, 'fine');
  assert.equal(kit.scullColour, SCULL_COLOURS[3]);
  const bad = cleanKit({ scull: 'eight', scullColour: '#123456' });
  assert.equal(bad.scull, 'club', 'an unknown scull: the club single');
  assert.equal(bad.scullColour, SCULL_COLOURS[0], 'a colour not in the set: the first');
  assert.ok(SCULLS.some((b) => b.id === cleanKit({}).scull));
  assert.notEqual(kitKey(kit), kitKey({ ...kit, scull: 'trainer' }));
});

test('a scull picked on this device before it went in the kit carries over, unless the saved kit has one', () => {
  const kit = cleanKit({});
  assert.deepEqual(withOldScull(kit, { body: 'slim' }, { scull: 'fine', colour: SCULL_COLOURS[2] }), { ...kit, scull: 'fine', scullColour: SCULL_COLOURS[2] });
  assert.equal(withOldScull(kit, { scull: 'trainer' }, { scull: 'fine' }), kit, 'the saved one wins');
  assert.equal(withOldScull(kit, null, null), kit);
  assert.equal(withOldScull(kit, null, { scull: 'canoe', colour: 'red' }).scull, 'club');
});

test("a leaderboard time records your kayak, or in a row your scull, and the board names it", () => {
  const kit = cleanKit({ boat: 'kirton-typhoon', scull: 'fine' });
  assert.equal(boardHull(kit, false), 'kirton-typhoon');
  assert.equal(boardHull(kit, true), 'scull-fine');
  assert.ok(isScullHull('scull-club') && !isScullHull('club'), "the kayak's old 'club' hull isn't a scull");
  assert.equal(scullHullName('scull-trainer'), 'Trainer single');
});

test('an old scull kept on the device moves into the saved kit once, and a corrupt one is just dropped', () => {
  const store = (init) => {
    const data = new Map(Object.entries(init));
    return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k), data };
  };
  const keys = { rowKey: 'row', kitKey: 'kit' };
  const saved = { body: 'slim', hair: 'bun' }; // as saved before sculls were in the kit
  const s = store({ kit: JSON.stringify(saved), row: JSON.stringify({ scull: 'fine', colour: SCULL_COLOURS[2] }) });
  const kit = moveOldScull(s, cleanKit(saved), saved, keys);
  assert.equal(kit.scull, 'fine');
  assert.equal(JSON.parse(s.data.get('kit')).scull, 'fine', 'saved, so the next load has it');
  assert.ok(!s.data.has('row'), 'the old value gone');
  assert.equal(moveOldScull(s, kit, JSON.parse(s.data.get('kit')), keys), kit, 'a second load does nothing');
  // A first visit (no saved kit yet) still takes it.
  const fresh = store({ row: JSON.stringify({ scull: 'trainer' }) });
  assert.equal(moveOldScull(fresh, cleanKit({}), null, keys).scull, 'trainer');
  // Corrupt: dropped, and the saved kit kept as it was.
  const bad = store({ kit: JSON.stringify(saved), row: '{not json' });
  const kept = cleanKit(saved);
  assert.equal(moveOldScull(bad, kept, saved, keys), kept);
  assert.ok(!bad.data.has('row'));
});

test("a live-race peer's kit with a scull the game doesn't know reads back as the club single", () => {
  assert.equal(cleanKit({ scull: 'quad', scullColour: 'pink' }).scull, 'club');
});
