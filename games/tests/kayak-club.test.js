// The walk to the club (club.js, prototype behind #club): the places, their
// camera shots on the real Thames at Reading, the doors, and the rooms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { courseFromFile, locate } from '../kayak/course.js';
import { waterMap } from '../kayak/water.js';
import { groundAt } from '../kayak/world.js';
import { PLACES, START, DOOR_LABELS, ROOMS, PARAPET, SWAN_LOOP, firstPlace, clubShots, clubMesh, glide, confusedSwan, legsMesh, swanLegsMesh } from '../kayak/club.js';

const data = async (id) => JSON.parse(await readFile(new URL(`../kayak/courses/${id}.json`, import.meta.url), 'utf8'));
const loop = async () => courseFromFile(await data('loop'));

test('every door leads somewhere: another place, or the rowing club (closed: red boards)', () => {
  for (const [name, place] of Object.entries(PLACES)) {
    assert.ok(place.label, name);
    for (const to of place.doors) {
      assert.ok(PLACES[to] || to === 'rowing', `${name} -> ${to}`);
      assert.ok(DOOR_LABELS[to], `${to} has a label`);
    }
  }
  // You can always get back out to the pontoon, and from every room back to the club.
  assert.ok(PLACES.club.doors.includes('pontoon'));
  for (const room of Object.keys(ROOMS)) assert.deepEqual(PLACES[room].doors, ['club']);
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
  assert.ok(path.eye[1] > 8, 'up on the deck');
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

test('the rooms and the red boards are a small mesh with no NaN', async () => {
  const { vertices, count } = clubMesh(clubShots(await loop()));
  assert.ok(vertices.every(Number.isFinite));
  assert.ok(count / 3 < 3000, `${count / 3} triangles`);
});

test('the swan on the bridge sits, stands, waddles one way, turns round, waddles back and sits, with no jumps where the loop starts again', () => {
  const at = (t) => confusedSwan(t);
  assert.equal(at(1).stand, 0, 'sitting to begin with');
  assert.equal(at(6).stand, 1, 'then standing');
  assert.ok(at(8).along > at(5).along + 0.5, 'waddles up its stretch');
  assert.ok(at(8).turn < 0.1 && at(10.3).turn > 0.9, 'and turns round');
  assert.ok(at(12.7).along < at(10.3).along - 0.5, 'and waddles back');
  assert.equal(at(15).stand, 0, 'and sits down');
  for (let t = 0; t < SWAN_LOOP * 2; t += 0.05) {
    const [a, b] = [at(t), at(t + 0.05)];
    for (const k of ['along', 'turn', 'stand']) assert.ok(Math.abs(a[k] - b[k]) < 0.1, `${k} jumps at ${t.toFixed(2)} s`);
    assert.ok(a.along >= 0 && a.along <= 1);
  }
});

test("the swan paces the bridge's far parapet, in front of you", async () => {
  const shots = clubShots(await loop());
  const { eye, look } = shots.places.path;
  for (const p of [shots.swan.from, shots.swan.to]) {
    assert.equal(p[1], PARAPET);
    const ahead = (p[0] - eye[0]) * (look[0] - eye[0]) + (p[2] - eye[2]) * (look[2] - eye[2]);
    assert.ok(ahead > 0, 'in front of the camera');
  }
  const len = Math.hypot(shots.swan.to[0] - shots.swan.from[0], shots.swan.to[2] - shots.swan.from[2]);
  assert.ok(len > 3 && len < 8, `${len} m of parapet`);
});

test('your paddler standing in the changing room has legs to the floor; the swan has legs too', async () => {
  const shots = clubShots(await loop());
  const floor = shots.roomAt('changing')[1];
  const legs = legsMesh([0.6, 0.4, 0.3]);
  let low = Infinity;
  for (let i = 1; i < legs.vertices.length; i += 9) low = Math.min(low, legs.vertices[i]);
  assert.ok(Math.abs(shots.changingStand[1] + low - floor) < 0.01, 'shoes on the floor');
  assert.ok(swanLegsMesh().vertices.every(Number.isFinite));
});
