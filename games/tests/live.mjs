#!/usr/bin/env node
// A live race between two browsers, end to end: two new accounts, one makes a
// race, the other joins from the link, both connect to the relay, the host
// starts it, and each sees the other's boat move. Needs the site and the games
// together (games:site also runs the relay):
//
//   pnpm dev                 # :3000
//   pnpm games:site          # :8001
//   node games/tests/live.mjs
//
// Against production: GAMES_SITE=https://paddlesnitch.com node games/tests/live.mjs
// (makes two real accounts, live-…@example.com).
import { createRequire } from 'module';
import { randomUUID } from 'crypto';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const BASE = process.env.GAMES_SITE ?? 'http://localhost:8001';
const PROD = BASE.includes('paddlesnitch.com');

async function player(browser, name) {
  const context = await browser.newContext({ viewport: { width: 900, height: 560 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // A new account, through the site's sign-up API (which signs you in).
  const res = await context.request.post(`${BASE}/att/api/auth/signup`, {
    data: { email: `live-${randomUUID().slice(0, 8)}@example.com`, displayName: name, password: 'Password123', acceptedTosVersion: '002' },
  });
  if (!res.ok()) throw new Error(`sign-up failed: ${res.status()} ${await res.text()}`);
  return { page, errors, context };
}

// The relay on its own, without the game's frame loop (headless browsers draw
// slowly, which holds up their messages): two plain WebSockets with the
// players' tickets, timing echoes there and back.
async function relayRoundTrips(code, a, b, n = 20) {
  const open = async (p) => {
    const res = await p.context.request.post(`${BASE}/api/trpc/games.live.ticket`, { data: { code } });
    const { url, ticket } = (await res.json()).result.data;
    const ws = new WebSocket(`${url ?? BASE.replace(/^http/, 'ws') + '/live'}?ticket=${ticket}`);
    await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
    return ws;
  };
  const [wa, wb] = [await open(a), await open(b)];
  wb.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.m?.type === 'probe') wb.send(JSON.stringify({ m: { type: 'probed', t: msg.m.t }, to: msg.from }));
  };
  const times = [];
  for (let i = 0; i < n; i++) {
    times.push(await new Promise((ok) => {
      wa.onmessage = (e) => { const msg = JSON.parse(e.data); if (msg.m?.type === 'probed') ok(Math.round(performance.now() - msg.m.t)); };
      wa.send(JSON.stringify({ m: { type: 'probe', t: performance.now() } }));
    }));
    await new Promise((ok) => setTimeout(ok, 100));
  }
  wa.close();
  wb.close();
  return times.sort((x, y) => x - y);
}

const kayak = (page, fn, arg) => page.evaluate(fn, arg);
// A first visit makes your paddler, boat and paddle (Next, Next, Done), then the races.
async function toRaces(page) {
  for (let i = 0; i < 3 && await page.locator('#stepHome').isHidden(); i++) await page.click('#menu .step:not([hidden]) .step-buttons .next');
}
const check = (ok, message) => {
  if (!ok) throw new Error(message);
  console.log(`✔ ${message}`);
};

const browser = await chromium.launch();
try {
  const ann = await player(browser, 'Ann Host');
  const bob = await player(browser, 'Bob Guest');

  // Ann makes a race on the practice river.
  await ann.page.goto(`${BASE}/games/reading-thames/#debug&menu`);
  await ann.page.waitForFunction(() => window.kayak?.gpu, null, { timeout: 30_000 });
  await ann.page.waitForFunction(() => document.getElementById('account').textContent.includes('Signed in'), null, { timeout: 10_000 });
  // Ann makes her paddler: a curvy body type, a ponytail, the darkest skin tone.
  await ann.page.check('#menu input[name="body"][value="curvy"]');
  await ann.page.check('#menu input[name="hair"][value="ponytail"]');
  await ann.page.check('#menu input[name="skin"] >> nth=7');
  await toRaces(ann.page);
  await ann.page.click('#menu button[value="live"]');
  await ann.page.selectOption('#liveCourse', 'practice');
  await ann.page.click('#liveCreate');
  await ann.page.waitForFunction(() => /^[A-Z]{4}$/.test(document.getElementById('liveCodeShow').textContent), null, { timeout: 10_000 });
  const code = await ann.page.textContent('#liveCodeShow');
  check(true, `Ann made race ${code}`);

  // Bob opens the link.
  await bob.page.goto(`${BASE}/games/reading-thames/#debug&race=${code}`);
  await bob.page.waitForFunction(() => window.kayak?.gpu, null, { timeout: 30_000 });
  await bob.page.waitForFunction(() => document.getElementById('livePlayers').children.length === 2, null, { timeout: 15_000 }).catch(async (e) => {
    console.log(await bob.page.evaluate(() => ({ error: document.getElementById('liveError').textContent, live: document.getElementById('live').open, menu: document.getElementById('menu').open, hash: location.hash, account: document.getElementById('account').textContent, players: document.getElementById('livePlayers').textContent })), bob.errors);
    throw e;
  });
  check(true, 'Bob joined from the link');
  await bob.page.waitForFunction(() => document.querySelectorAll('#livePlayers .face').length === 2, null, { timeout: 15_000 });
  check(true, "Bob's lobby shows both paddlers");

  // Both are connected to the relay, and can measure the round trip through it.
  await ann.page.waitForFunction(() => !document.getElementById('liveStart').disabled, null, { timeout: 30_000 });
  check(await bob.page.evaluate(() => document.getElementById('livePlayers').textContent.includes('connected')), 'Ann and Bob are connected');
  await ann.page.waitForFunction(() => { const l = window.kayak.lobby; return l.rtt(l.players.find((p) => p.id !== l.you).id) !== null; }, null, { timeout: 15_000 });
  const rtts = [];
  for (let i = 0; i < 5; i++) {
    await ann.page.waitForTimeout(2100);
    rtts.push(await kayak(ann.page, () => { const l = window.kayak.lobby; return l.rtt(l.players.find((p) => p.id !== l.you).id); }));
  }
  check(true, `round trip Ann → relay → Bob → relay → Ann: ${rtts.join(', ')} ms`);

  // Neither will fall in while the test paddles without balancing.
  await ann.page.click('#liveStart');
  for (const p of [ann, bob]) {
    await p.page.waitForFunction(() => window.kayak.live && window.kayak.state === 'start', null, { timeout: 20_000 });
    await kayak(p.page, () => { window.kayak.boat.hull = { ...window.kayak.boat.hull, capsize: 10 }; });
  }
  const names = await kayak(bob.page, () => window.kayak.race.racers.map((r) => r.name));
  check(names.includes('You') && names.includes('Ann H.'), `Bob's race has ${names.join(' and ')}`);
  const annKit = await kayak(ann.page, () => JSON.parse(localStorage.getItem('snitchmedia:kayak:kit')));
  const annLook = await kayak(bob.page, () => window.kayak.liveries.get(window.kayak.race.racers.find((r) => r.remote)).key);
  check(annLook.startsWith(`${annKit.skin},curvy,ponytail,`), "and Ann's paddler, as she made her");

  // Ann's starter calls the start, and Bob's game follows it.
  for (const p of [ann, bob]) await p.page.waitForFunction(() => window.kayak.state === 'racing', null, { timeout: 60_000 });
  check(true, 'the horn went for both');

  // Ann paddles; Bob sees her boat move, about where she is.
  const annOnBob = () => window.kayak.race.racers.find((r) => r.remote).boat;
  const before = await kayak(bob.page, annOnBob);
  for (let i = 0; i < 12; i++) {
    await ann.page.keyboard.press(i % 2 ? 'ArrowRight' : 'ArrowLeft');
    await ann.page.waitForTimeout(650);
  }
  const annSelf = await kayak(ann.page, () => ({ x: window.kayak.boat.x, z: window.kayak.boat.z, s: window.kayak.loc.s }));
  const after = await kayak(bob.page, annOnBob);
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  const off = Math.hypot(after.x - annSelf.x, after.z - annSelf.z);
  check(moved > 5, `Bob saw Ann's boat move ${moved.toFixed(1)} m`);
  check(off < 3, `and within ${off.toFixed(1)} m of where Ann has it`);
  const bobOnAnn = await kayak(ann.page, () => window.kayak.race.racers.find((r) => r.remote).boat);
  const bobSelf = await kayak(bob.page, () => window.kayak.boat);
  check(Math.hypot(bobOnAnn.x - bobSelf.x, bobOnAnn.z - bobSelf.z) < 3, 'and Ann sees Bob where he is');
  const rt = await relayRoundTrips(code, ann, bob);
  check(true, `the relay alone, there and back: median ${rt[rt.length >> 1]} ms, best ${rt[0]}, worst ${rt.at(-1)} (one way is about half)`);

  // The leaderboard (not on production: no test times on the real boards).
  if (!PROD) {
    const posted = await kayak(ann.page, () => fetch('/api/trpc/games.submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ course: 'practice', time: 260.4, hull: 'club' }) }).then((r) => r.json()));
    check(posted.result?.data?.best === true, 'a practice time went on the leaderboard');
    // Ann's paddler is on her account: a device that hasn't seen it gets it.
    await kayak(ann.page, () => localStorage.clear());
    await ann.page.goto(`${BASE}/games/reading-thames/#debug&menu`);
    await ann.page.waitForFunction((skin) => document.querySelector('#menu input[name="skin"]:checked')?.value === skin
      && document.querySelector('#menu input[name="body"]:checked')?.value === 'curvy'
      && document.querySelector('#menu input[name="hair"]:checked')?.value === 'ponytail', annKit.skin, { timeout: 15_000 });
    check(true, "Ann's paddler came back from her account");

    const fresh = await (await browser.newContext()).newPage();
    await fresh.goto(`${BASE}/games/reading-thames/#menu`);
    await toRaces(fresh);
    await fresh.waitForFunction(() => !document.getElementById('boards').hidden, null, { timeout: 15_000 });
    await fresh.click('#boards');
    await fresh.waitForFunction(() => /Ann H\.\s*4:20\.4/.test(document.getElementById('boardlist').textContent), null, { timeout: 15_000 });
    check(true, 'anyone can see it on the leaderboards page: Ann H. 4:20.4');
    await fresh.click('#stepBoards .back');

    // Signed out, a race button goes to sign in; practice doesn't.
    await fresh.waitForFunction(() => document.getElementById('account').textContent.includes('Sign in'));
    await Promise.all([fresh.waitForURL(/\/signin\?next=\/games\/reading-thames\//, { timeout: 15_000 }), fresh.click('#menu button[value="race"]')]);
    check(true, 'signed out, Division 9 sends you to sign in');
  }

  check(!ann.errors.length && !bob.errors.length, `no page errors${[...ann.errors, ...bob.errors].map((e) => `: ${e}`).join('')}`);
} finally {
  await browser.close();
}
