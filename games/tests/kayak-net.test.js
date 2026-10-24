import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoat } from '../kayak/sim.js';
import { encodeState, decodeState, createTrack, receive, sample, applyState, DELAY } from '../kayak/net.js';

test('a boat\'s state goes over the wire and back', () => {
  const boat = Object.assign(createBoat({ x: 12.3456, z: -40.1, heading: 0.5 }), { speed: 3.21, roll: 0.05, time: 10, paddle: { side: 'right', at: 9.8 } });
  const msg = JSON.parse(JSON.stringify(encodeState(1.2345, boat)));
  assert.deepEqual(decodeState(msg), { t: 1.235, x: 12.35, z: -40.1, heading: 0.5, speed: 3.21, roll: 0.05, side: 'right', since: 0.2, swim: false });
  assert.equal(decodeState(['s', 1, 2]), null, 'malformed');
  assert.equal(decodeState(['s', 1, 2, 3, 4, 5, 6, 7, 8, 'x']), null, 'not a number');
  assert.equal(decodeState({}), null);
});

// States from a boat heading up -z at 3 m/s, sent every 1/15 s, arriving 50 ms later.
const sent = (t) => ({ t, x: 0, z: -3 * t, heading: 0, speed: 3, roll: 0, side: null, since: 0, swim: false });

test('the others\' boats are shown a little behind, smoothly between states', () => {
  const track = createTrack();
  const offset = 100; // the receiver's clock is 100 s ahead of the sender's
  for (let k = 0; k <= 15; k++) receive(track, sent(k / 15), k / 15 + offset + 0.05);
  const now = 1 + offset + 0.05;
  const at = sample(track, now);
  // Shown DELAY behind the sender: 0.95 - 0.1 s into the run.
  assert.ok(Math.abs(at.z - -3 * (1 - DELAY)) < 1e-6, `z ${at.z}`);
});

test('a late or repeated state slots in where it belongs; a lost one is bridged', () => {
  const track = createTrack();
  for (const k of [0, 1, 3, 2, 2, 5]) receive(track, sent(k / 15), k / 15 + 0.05);
  assert.deepEqual(track.states.map((s) => Math.round(s.t * 15)), [0, 1, 2, 3, 5]);
  const at = sample(track, 4 / 15 + DELAY + track.offset); // between 3 and 5
  assert.ok(Math.abs(at.z - -3 * (4 / 15)) < 1e-6);
});

test('with nothing new, a boat coasts on for half a second, then waits', () => {
  const track = createTrack();
  receive(track, sent(0), 0);
  receive(track, sent(0.1), 0.1);
  assert.ok(Math.abs(sample(track, 0.1 + DELAY + 0.2, 4).z - -3 * (0.1 + 0.2 * 4)) < 1e-6, 'coasting at speedup 4');
  assert.equal(sample(track, 5, 1).z, sample(track, 9, 1).z, 'stops after half a second');
  assert.equal(sample(createTrack(), 0), null);
});

test('a received state drives a boat, paddle and all', () => {
  const boat = createBoat();
  boat.time = 20;
  applyState(boat, { x: 1, z: 2, heading: 3, speed: 4, roll: 0.1, side: 'left', since: 0.25, swim: true });
  assert.deepEqual([boat.x, boat.z, boat.heading, boat.speed, boat.roll, boat.swim > 0], [1, 2, 3, 4, 0.1, true]);
  assert.deepEqual(boat.paddle, { side: 'left', at: 19.75 });
});
