// The walk to the club (club.js, prototype behind #club): the places, their
// camera shots on the real Thames at Reading, the doors, and the rooms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { courseFromFile, locate } from '../kayak/course.js';
import { waterMap } from '../kayak/water.js';
import { groundAt } from '../kayak/world.js';
import { PLACES, DOOR_LABELS, ROOMS, firstPlace, clubShots, clubMesh, glide } from '../kayak/club.js';

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
