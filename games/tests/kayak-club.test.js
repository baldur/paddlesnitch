// The walk to the club (club.js, prototype behind #club): the places, their
// camera shots on the real Thames at Reading, the doors, and the rooms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { courseFromFile, locate } from '../reading-thames/course.js';
import { waterMap } from '../reading-thames/water.js';
import { groundAt, bridgeBay, BRIDGE, bridgeTriangles } from '../reading-thames/world.js';
import { WIDE, PLACES, START, DOOR_LABELS, ROOMS, STANDING, MY_ERG, MIRROR, SWAN_LOOP, firstPlace, clubShots, clubMesh, glide, confusedSwan, legsMesh, swanLegsMesh, bridgeSwanMesh } from '../reading-thames/club.js';

const data = async (id) => JSON.parse(await readFile(new URL(`../reading-thames/courses/${id}.json`, import.meta.url), 'utf8'));
const loop = async () => courseFromFile(await data('loop'));

test('every door leads to another place; both clubs open off the bridge, each with its rooms and a way to the water', () => {
  for (const [name, place] of Object.entries(PLACES)) {
    assert.ok(place.label, name);
    for (const to of place.doors) {
      assert.ok(PLACES[to], `${name} -> ${to}`);
      assert.ok(DOOR_LABELS[to], `${to} has a label`);
    }
  }
  assert.deepEqual(PLACES.path.doors, ['club', 'rclub']);
  assert.ok(PLACES.club.doors.includes('pontoon'));
  assert.ok(PLACES.rclub.doors.includes('rpontoon') && PLACES.rclub.doors.includes('erg'));
  // Every room's one door is back out to its own club.
  for (const [room, r] of Object.entries(ROOMS)) assert.deepEqual(PLACES[room].doors, [r.club === 'rowing' ? 'rclub' : 'club']);
});

test("the rowing club's shots: from its land side, the landing stage at its water, the erg room with your erg in front of you", async () => {
  const course = await loop();
  const shots = clubShots(course);
  const land = waterMap((await data('reading')).water);
  const { rclub, rpontoon, erg } = shots.places;
  assert.ok(!land.inside(rclub.eye[0], rclub.eye[2]), 'on land');
  const r = course.scenery.buildings.find((b) => b.style === 'rowing-club');
  const [cx, cz] = r.shape.reduce((a, p) => [a[0] + p[0] / r.shape.length, a[1] + p[1] / r.shape.length], [0, 0]);
  assert.ok(Math.hypot(rclub.eye[0] - cx, rclub.eye[2] - cz) < 40, 'at the rowing club');
  assert.ok(Math.hypot(rpontoon.eye[0] - cx, rpontoon.eye[2] - cz) < 60, 'its landing stage');
  assert.ok(Math.abs(rpontoon.eye[1] - 1.6) < 1e-9);
  // Underground, like the canoe club's rooms, and apart from them.
  for (const name of ['rchanging', 'rboathouse', 'rclubhouse', 'erg']) {
    const at = shots.roomAt(name);
    assert.ok(at[1] < -50, `${name} is under ground`);
    assert.ok(Math.hypot(at[0] - cx, at[2] - cz) < 200, `${name} is under the rowing club`);
  }
  // Your erg is in front of you, the rest of the room beyond it.
  const mine = shots.ergs[MY_ERG];
  const toErg = Math.hypot(mine[0] - erg.eye[0], mine[2] - erg.eye[2]);
  assert.ok(toErg > 2 && toErg < 5, `${toErg} m to your erg`);
  // The sculls (8.2 m) fit the boathouse, each with its label.
  assert.ok(ROOMS.rboathouse.width > 8.2 + 1);
  assert.equal(shots.sculls.length, 3);
  assert.equal(shots.scullLabels.length, 3);
});

test("the canoe club's erg room: a door from the club, under it, the kayak erg between you and the mirror", async () => {
  assert.ok(PLACES.club.doors.includes('kerg'));
  assert.equal(PLACES.kerg.up, 'club');
  const course = await loop();
  const shots = clubShots(course);
  const c = course.scenery.buildings.find((b) => b.style === 'canoe-club');
  const [cx, cz] = c.shape.reduce((a, p) => [a[0] + p[0] / c.shape.length, a[1] + p[1] / c.shape.length], [0, 0]);
  const at = shots.roomAt('kerg');
  assert.ok(at[1] < -50 && Math.hypot(at[0] - cx, at[2] - cz) < 200, 'under the canoe club');
  const { eye, look } = shots.places.kerg;
  // Looking at the mirror's wall, over the erg: you see your back, and the mirror beyond.
  const toMirror = shots.mirrorZ - eye[2];
  const toErg = shots.kerg[2] - eye[2];
  assert.ok(Math.sign(look[2] - eye[2]) === Math.sign(toMirror), 'facing the mirror');
  assert.ok(Math.abs(toErg) > 1 && Math.abs(toErg) < Math.abs(toMirror), `the erg ${toErg} m, the mirror ${toMirror} m`);
  // The erg's middle is in front of the mirror, which is wider than you on it.
  assert.ok(Math.abs(shots.kerg[0] - at[0]) < MIRROR.x1 && MIRROR.x1 - MIRROR.x0 > 2);
  // The room behind the mirror stays clear of the other rooms (each 40 m along).
  assert.ok(ROOMS.kerg.depth * 2 < 40 && ROOMS.kerg.width < 40);
  // The button to start is in the room, in view.
  assert.ok(Math.hypot(shots.kergLabel[0] - shots.kerg[0], shots.kergLabel[2] - shots.kerg[2]) < 2);
});

test('Back always leads to the bridge: from every place, one level up at a time, through a door that place has', () => {
  assert.equal(PLACES[START].up, null);
  for (const [name, place] of Object.entries(PLACES)) {
    let at = name;
    for (let steps = 0; at !== START; steps++) {
      assert.ok(steps < 4, `${name} never gets back to the bridge`);
      assert.ok(PLACES[at].doors.includes(PLACES[at].up), `${at}: Back goes through one of its doors`);
      at = PLACES[at].up;
    }
  }
});

test('the walk starts on the path, at the club when invited, and where you were last (never inside a room)', () => {
  assert.equal(firstPlace(), 'path');
  assert.equal(firstPlace({ invited: true, last: 'pontoon' }), 'club');
  assert.equal(firstPlace({ last: 'pontoon' }), 'pontoon');
  assert.equal(firstPlace({ last: 'boathouse' }), 'path');
  assert.equal(firstPlace({ last: 'nowhere' }), 'path');
});

test('a glide starts and ends on the shots, eased at both ends', () => {
  const a = { eye: [0, 0, 0], look: [0, 0, -1] };
  const b = { eye: [10, 2, 0], look: [10, 2, -1] };
  assert.deepEqual(glide(a, b, 0), a);
  assert.deepEqual(glide(a, b, 1), b);
  assert.deepEqual(glide(a, b, 0.5).eye, [5, 1, 0]);
  assert.ok(glide(a, b, 0.1).eye[0] < 1, 'slow off the mark');
});

test('the shots are on the real Reading river: the bridge view from Caversham Bridge, the club from its land side, the pontoon at its water', async () => {
  const course = await loop();
  const shots = clubShots(course);
  assert.ok(shots, 'both clubs are in the world');
  const land = waterMap((await data('reading')).water);
  const { path, club, pontoon } = shots.places;
  for (const shot of Object.values(shots.places)) assert.ok([...shot.eye, ...shot.look].every(Number.isFinite));
  // On the bridge: above the water, by Caversham Bridge.
  const bridge = course.scenery.bridges.find((b) => b.name === 'Caversham Bridge');
  assert.ok(Math.abs(locate(course.scenery.river, path.eye[0], path.eye[2]).s - bridge.s) < 15);
  assert.ok(Math.abs(path.eye[1] - BRIDGE.deck - STANDING.eye) < 1e-9, "standing on the deck, a person's eye height up");
  const bay = bridgeBay(course.scenery.river, bridge);
  const across = (p) => ((p[0] - bay.origin[0]) * bay.fwd[0] + (p[2] - bay.origin[2]) * bay.fwd[1]) * bay.e;
  assert.ok(across(path.eye) > 0 && across(path.eye) < BRIDGE.half - 2, 'on the upstream side of the bridge, back from the parapet');
  assert.ok(across(path.look) > across(path.eye) + 10, 'looking out over the parapet, through the bay');
  // The club from the road: standing on dry land, eye at a person's height.
  assert.ok(!land.inside(club.eye[0], club.eye[2]), 'on land');
  assert.ok(Math.abs(club.eye[1] - groundAt(course, club.eye[0], club.eye[2]) - 1.7) < 0.01);
  // The pontoon: at the water's edge, looking out over it.
  assert.ok(!land.inside(pontoon.eye[0], pontoon.eye[2]));
  assert.ok(land.inside(pontoon.look[0], pontoon.look[2]), 'looking at the water');
});

test('inside, you stand in a closed room under the ground, so the sky and river never show', async () => {
  const course = await loop();
  const shots = clubShots(course);
  for (const [name, size] of Object.entries(ROOMS)) {
    const o = shots.roomAt(name);
    const { eye, look } = shots.places[name];
    for (const p of [eye, look]) {
      assert.ok(Math.abs(p[0] - o[0]) <= size.width / 2 && Math.abs(p[2] - o[2]) <= size.depth / 2, `${name}: inside the walls`);
      assert.ok(p[1] > o[1] && p[1] < o[1] + size.height, `${name}: between floor and ceiling`);
    }
    assert.ok(o[1] + size.height < -20, `${name}: well under the river`);
    // The rooms don't overlap.
    for (const [other, s2] of Object.entries(ROOMS)) {
      if (other === name) continue;
      assert.ok(Math.abs(shots.roomAt(other)[0] - o[0]) > (size.width + s2.width) / 2, `${name} and ${other}`);
    }
  }
  // The nine boats' places are on the boathouse's racks, all different.
  const o = shots.roomAt('boathouse');
  assert.equal(shots.rack.length, 9);
  assert.equal(new Set(shots.rack.map((p) => p.join())).size, 9);
  for (const p of shots.rack) assert.ok(Math.abs(p[0] - o[0]) + 2.6 <= ROOMS.boathouse.width / 2, 'a 5.2 m boat fits on the rack');
});

test('the rooms under both clubs, with the mural, are a small mesh with no NaN', async () => {
  const { vertices, count } = clubMesh(clubShots(await loop()));
  assert.ok(vertices.every(Number.isFinite));
  assert.ok(count / 3 < 3500, `${count / 3} triangles`); // (the kayak erg's room is built twice: once behind its mirror)
});

test('the swan on the bridge sits facing you, stands, waddles off one way or the other, turns round, comes back and sits, with no jumps', () => {
  const at = (t, seed = 0) => confusedSwan(t, 1, seed);
  assert.equal(at(1).stand, 0, 'sitting to begin with');
  assert.ok(Math.abs(at(1).face - Math.PI / 2) < 1e-9, 'facing you');
  assert.equal(at(6).stand, 1, 'then standing');
  const out = at(8);
  assert.ok(Math.abs(out.along - 0.5) > 0.35, 'waddles off to one end');
  assert.ok(Math.abs(at(12.7).along - 0.5) < 0.05, 'and back to the middle');
  assert.equal(at(15).stand, 0, 'and sits down');
  // Some times one way, some times the other.
  const ways = new Set(Array.from({ length: 20 }, (_, n) => confusedSwan(n * SWAN_LOOP + 8, 1).dir));
  assert.deepEqual([...ways].sort(), [-1, 1]);
  for (const seed of [0, 7, 99]) {
    for (let t = 0; t < SWAN_LOOP * 6; t += 0.05) {
      const [a, b] = [at(t, seed), at(t + 0.05, seed)];
      for (const k of ['along', 'stand', 'face']) {
        const d = k === 'face' ? Math.abs(((b[k] - a[k] + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) : Math.abs(a[k] - b[k]);
        // A turn of up to 5 radians a second is a swan turning; more is a jump.
        assert.ok(d < (k === 'face' ? 0.25 : 0.15), `${k} jumps at ${t.toFixed(2)} s (seed ${seed})`);
      }
      assert.ok(a.along >= 0 && a.along <= 1);
    }
  }
});

test("the swan paces the viewing bay's paving in front of you, clear of its balustrade", async () => {
  const course = await loop();
  const shots = clubShots(course);
  const { eye, look } = shots.places.path;
  const bay = bridgeBay(course.scenery.river, course.scenery.bridges.find((b) => b.name === 'Caversham Bridge'));
  const across = (p) => ((p[0] - bay.origin[0]) * bay.fwd[0] + (p[2] - bay.origin[2]) * bay.fwd[1]) * bay.e;
  for (const p of [shots.swan.from, shots.swan.to]) {
    assert.ok(Math.abs(p[1] - BRIDGE.deck - 0.14) < 1e-9, 'on the paving');
    assert.ok(across(p) > across(eye) + 2 && across(p) < BRIDGE.half + BRIDGE.out - 0.6, 'in the bay, clear of its front');
    assert.ok(Math.abs((p[0] - bay.origin[0]) * bay.right[0] + (p[2] - bay.origin[2]) * bay.right[1] - bay.t) < BRIDGE.bay - 0.6, 'and of its sides');
    const ahead = (p[0] - eye[0]) * (look[0] - eye[0]) + (p[2] - eye[2]) * (look[2] - eye[2]);
    assert.ok(ahead > 0, 'in front of the camera');
  }
  const len = Math.hypot(shots.swan.to[0] - shots.swan.from[0], shots.swan.to[2] - shots.swan.from[2]);
  assert.ok(len > 3 && len < 8, `${len} m of paving`);
});

test('your paddler standing in the changing room has legs to the floor; the swan has legs too', async () => {
  const shots = clubShots(await loop());
  const floor = shots.roomAt('changing')[1];
  const legs = legsMesh([0.6, 0.4, 0.3]);
  let low = Infinity;
  for (let i = 1; i < legs.vertices.length; i += 9) low = Math.min(low, legs.vertices[i]);
  assert.ok(Math.abs(shots.changingStand[1] + low - floor) < 0.01, 'shoes on the floor');
  assert.ok(swanLegsMesh().vertices.every(Number.isFinite));
  assert.ok(bridgeSwanMesh().vertices.every(Number.isFinite));
});

test("Caversham Bridge with its bay, balustrade and lamps stays inside its own share of the river's triangles", async () => {
  const course = await loop();
  const bridge = course.scenery.bridges.find((b) => b.name === 'Caversham Bridge');
  const n = bridgeTriangles(course.scenery.river, bridge);
  assert.ok(n < 9000, `${n} triangles`);
});

test("a glide blends a shot's wider view into the next, and adds none between two ordinary shots", async () => {
  const shots = clubShots(await loop());
  const bridge = shots.places.path;
  assert.equal(bridge.wide, 100);
  const club = shots.places.club;
  assert.equal(glide(bridge, club, 0.5).wide, (100 + WIDE) / 2);
  assert.equal(glide(bridge, club, 1).wide, WIDE);
  assert.ok(!('wide' in glide(club, shots.places.pontoon, 0.5)));
});
