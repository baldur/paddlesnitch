// Analytics from play (kayak/metrics.js) and the games' batched sender
// (shared/analytics.js): what's recorded, that it never says who, and that it
// fits the site's endpoint (at most 10 string props of 200 characters an event).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { beginPlay, playEvent, kitEvent, createSession, setVisible, sessionEvent } from '../kayak/metrics.js';
import { cleanKit, randomKit, SKIN_TONES } from '../kayak/kit.js';
import { PLACES } from '../kayak/club.js';

const fits = ({ props }) => {
  assert.ok(Object.keys(props).length <= 10, `${Object.keys(props).length} props`);
  // The endpoint's filter: lower-case words, numbers and comma lists only.
  for (const [k, v] of Object.entries(props)) assert.match(v, /^[a-z0-9][a-z0-9_.,-]{0,59}$/, k);
};

test('each kind of play is told apart: a race, a time trial, a live race, practice, a drill, an outing', () => {
  const kind = (mode, o) => beginPlay(mode, o).mode;
  assert.equal(kind({ key: 'loop' }, { format: 'mass' }), 'race');
  assert.equal(kind({ key: 'loop' }, { format: 'interval' }), 'trial');
  assert.equal(kind({ key: 'hasler79' }, { live: true }), 'live');
  assert.equal(kind({ key: 'practice', solo: true }), 'practice');
  assert.equal(kind({ key: 'drill-wash', drill: 'wash', solo: true }), 'drill');
  assert.equal(beginPlay({ key: 'hire', outing: 'hire', solo: true }).course, 'hire');
});

test('a race reports how it ended, how long it took, the place and the swims', () => {
  const play = beginPlay({ key: 'hasler79' }, { from: 'walk', now: 100 });
  const e = playEvent(play, { end: 'finished', now: 520.4, place: 3, swims: 1 });
  assert.equal(e.event, 'game_play');
  assert.deepEqual(e.props, { mode: 'race', course: 'hasler79', end: 'finished', secs: '420', swims: '1', from: 'walk', place: '3' });
  fits(e);
});

test('an outing reports exploring or mischief: how far, how many bumps, how many rowers and kayakers knocked in', () => {
  const play = beginPlay({ key: 'hire', outing: 'hire' }, { now: 0 });
  Object.assign(play, { knocked: 2, bumps: 5, metres: 3456 });
  const e = playEvent(play, { end: 'quit', now: 300 });
  assert.equal(e.props.knocked, '2');
  assert.equal(e.props.bumps, '5');
  assert.equal(e.props.km, '3.46');
  assert.equal(e.props.end, 'quit');
  fits(e);
});

test("the paddler's choices are reported, never a colour or skin tone, and only when they've changed", () => {
  for (let i = 0; i < 30; i++) fits(kitEvent(randomKit())); // every boat id and choice passes the filter
  const kit = cleanKit({ ...randomKit(() => 0.3), body: 'slim', hair: 'bun', hat: 'visor', beard: 'none', aid: true });
  const e = kitEvent(kit);
  assert.equal(e.event, 'game_kit');
  assert.equal(e.props.body, 'slim');
  assert.equal(e.props.hair, 'bun');
  assert.equal(e.props.aid, 'true');
  fits(e);
  const values = Object.values(e.props).join(' ');
  assert.ok(!/#[0-9a-f]{6}/i.test(values), 'no colours');
  for (const tone of SKIN_TONES) assert.ok(!values.includes(tone), 'no skin tone');
  assert.equal(kitEvent(kit, e.key), null, 'the same again: nothing to send');
  assert.ok(kitEvent({ ...kit, hat: 'cap' }, e.key), 'a change: sent');
});

test('a visit counts only the time the page is in view, sent as what was added since the last send', () => {
  const s = createSession(0, 'walk');
  s.places.add('path');
  s.places.add('club');
  s.inputs.add('touch');
  s.plays = 1;
  setVisible(s, false, 60); // 60 s in view, then hidden
  const first = sessionEvent(s, 500); // hidden all that while: still 60
  assert.deepEqual(first.props, { secs: '60', plays: '1', from: 'walk', places: 'path,club', input: 'touch' });
  fits(first);
  assert.equal(sessionEvent(s, 600), null, 'nothing new while hidden');
  const all = createSession(0, 'walk');
  for (const p of Object.keys(PLACES)) all.places.add(p); // both clubs, every room
  for (const i of ['keys', 'mouse', 'pad', 'touch']) all.inputs.add(i);
  fits(sessionEvent(all, 10, 'webgl2')); // every place on the walk and every control, still short enough
  assert.ok(!('places' in sessionEvent(createSession(0, 'menu'), 5).props), 'no places: left out, not empty');
  setVisible(s, true, 600);
  const second = sessionEvent(s, 630, 'webgpu');
  assert.equal(second.props.secs, '30', 'only the new 30 s');
  assert.equal(second.props.gpu, 'webgpu');
});

// The sender, run as a page would run it, with a pretend browser.
async function page(hostname = 'localhost') {
  const listeners = {};
  const beacons = [];
  const win = {
    location: { hostname, pathname: '/games/kayak/' },
    sessionStorage: { store: {}, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = v; } },
    crypto: { randomUUID: () => 'abcd-1234' },
    navigator: { sendBeacon: (url, body) => beacons.push({ url, body: JSON.parse(body) }) },
    document: { visibilityState: 'visible', addEventListener: (t, fn) => (listeners[t] = fn) },
    addEventListener: (t, fn) => (listeners[t] = fn),
    setInterval: (fn) => { listeners.interval = fn; return 0; },
  };
  win.window = win;
  vm.runInNewContext(await readFile(new URL('../shared/analytics.js', import.meta.url), 'utf8'), win);
  return { win, listeners, beacons };
}

test('the sender counts the visit at once, then sends a game\'s events together when the page is hidden', async () => {
  const { win, listeners, beacons } = await page('paddlesnitch.com');
  assert.equal(beacons.length, 1);
  assert.equal(beacons[0].body.events[0].event, 'pageview');
  win.gameMetrics.beforeSend(() => win.gameMetrics.track('game_session', { secs: '42' }));
  win.gameMetrics.track('game_play', { mode: 'race' });
  win.gameMetrics.track('game_kit', { body: 'broad' });
  assert.equal(beacons.length, 1, 'held until the page is hidden');
  win.document.visibilityState = 'hidden';
  listeners.visibilitychange();
  assert.equal(beacons.length, 2, 'one beacon for all three');
  const { url, body } = beacons[1];
  assert.equal(url, '/att/api/track');
  assert.equal(body.sid, 'abcd-1234');
  assert.deepEqual(body.events.map((e) => e.event), ['game_play', 'game_kit', 'game_session']);
  assert.ok(body.events.every((e) => e.path === '/games/kayak/' && typeof e.t === 'number'));
});

test('the sender never sends more than 20 events at once, and off the real site keeps them to look at instead', async () => {
  const { win, beacons } = await page('localhost');
  for (let i = 0; i < 45; i++) win.gameMetrics.track('game_play', { n: String(i) });
  win.gameMetrics.send();
  assert.equal(beacons.length, 0, 'nothing leaves a local copy');
  assert.ok(win.gameMetrics.sent.every((b) => b.events.length <= 20));
  assert.equal(win.gameMetrics.sent.reduce((n, b) => n + b.events.length, 0), 46, 'the pageview and all 45');
});

test('the sender also goes once a minute while something waits, and when the page is left; showing the page again sends nothing', async () => {
  const { win, listeners, beacons } = await page('paddlesnitch.com');
  const sent = () => beacons.length;
  const before = sent();
  listeners.interval();
  assert.equal(sent(), before, 'nothing waiting: nothing sent');
  win.gameMetrics.track('game_play', { mode: 'race' });
  listeners.interval();
  assert.equal(sent(), before + 1, 'once a minute with something waiting');
  win.gameMetrics.track('game_play', { mode: 'trial' });
  win.document.visibilityState = 'visible';
  listeners.visibilitychange();
  assert.equal(sent(), before + 1, 'coming back into view sends nothing');
  listeners.pagehide();
  assert.equal(sent(), before + 2, 'leaving the page sends what waits');
  assert.equal(beacons.at(-1).body.events[0].props.mode, 'trial');
});
