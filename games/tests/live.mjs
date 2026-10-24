#!/usr/bin/env node
// A live race between two browsers, end to end: two new accounts, one makes a
// race, the other joins from the link, they connect (our API for the
// handshake, then WebRTC), the host starts it, and each sees the other's boat
// move. Needs the site and the games together:
//
//   pnpm dev                 # :3000
//   pnpm games:site          # :8001
//   node games/tests/live.mjs
import { createRequire } from 'module';
import { randomUUID } from 'crypto';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const BASE = process.env.GAMES_SITE ?? 'http://localhost:8001';

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
  return { page, errors };
}

const kayak = (page, fn, arg) => page.evaluate(fn, arg);
const check = (ok, message) => {
  if (!ok) throw new Error(message);
  console.log(`✔ ${message}`);
};

const browser = await chromium.launch();
try {
  const ann = await player(browser, 'Ann Host');
  const bob = await player(browser, 'Bob Guest');

  // Ann makes a race on the practice river.
  await ann.page.goto(`${BASE}/games/kayak/#debug`);
  await ann.page.waitForFunction(() => window.kayak?.gpu, null, { timeout: 30_000 });
  await ann.page.waitForFunction(() => document.getElementById('account').textContent.includes('Signed in'), null, { timeout: 10_000 });
  await ann.page.click('#menu button[value="live"]');
  await ann.page.selectOption('#liveCourse', 'practice');
  await ann.page.click('#liveCreate');
  await ann.page.waitForFunction(() => /^[A-Z]{4}$/.test(document.getElementById('liveCodeShow').textContent), null, { timeout: 10_000 });
  const code = await ann.page.textContent('#liveCodeShow');
  check(true, `Ann made race ${code}`);

  // Bob opens the link.
  await bob.page.goto(`${BASE}/games/kayak/#debug&race=${code}`);
  await bob.page.waitForFunction(() => window.kayak?.gpu, null, { timeout: 30_000 });
  await bob.page.waitForFunction(() => document.getElementById('livePlayers').children.length === 2, null, { timeout: 15_000 }).catch(async (e) => {
    console.log(await bob.page.evaluate(() => ({ error: document.getElementById('liveError').textContent, live: document.getElementById('live').open, menu: document.getElementById('menu').open, hash: location.hash, account: document.getElementById('account').textContent, players: document.getElementById('livePlayers').textContent })), bob.errors);
    throw e;
  });
  check(true, 'Bob joined from the link');

  // They connect browser to browser.
  await ann.page.waitForFunction(() => !document.getElementById('liveStart').disabled, null, { timeout: 30_000 });
  check(await bob.page.evaluate(() => document.getElementById('livePlayers').textContent.includes('connected')), 'Ann and Bob are connected');

  // Neither will fall in while the test paddles without balancing.
  await ann.page.click('#liveStart');
  for (const p of [ann, bob]) {
    await p.page.waitForFunction(() => window.kayak.live && window.kayak.state === 'start', null, { timeout: 20_000 });
    await kayak(p.page, () => { window.kayak.boat.hull = { ...window.kayak.boat.hull, capsize: 10 }; });
  }
  const names = await kayak(bob.page, () => window.kayak.race.racers.map((r) => r.name));
  check(names.includes('You') && names.includes('Ann H.'), `Bob's race has ${names.join(' and ')}`);

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
  // The leaderboard: a time posted from the game shows in the menu's list.
  const posted = await kayak(ann.page, () => fetch('/api/trpc/games.submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ course: 'practice', time: 260.4, hull: 'club' }) }).then((r) => r.json()));
  check(posted.result?.data?.best === true, 'a practice time went on the leaderboard');
  const fresh = await (await browser.newContext()).newPage();
  await fresh.goto(`${BASE}/games/kayak/`);
  await fresh.waitForFunction(() => !document.getElementById('boards').hidden, null, { timeout: 15_000 });
  await fresh.click('#boards summary');
  await fresh.waitForFunction(() => document.getElementById('boardlist').textContent.includes('Ann H. 4:20.4'), null, { timeout: 15_000 });
  check(true, 'anyone can see it in the menu: Ann H. 4:20.4');

  // Signed out, a race button goes to sign in; practice doesn't.
  await fresh.waitForFunction(() => document.getElementById('account').textContent.includes('Sign in'));
  await Promise.all([fresh.waitForURL(/\/signin\?next=/, { timeout: 15_000 }), fresh.click('#menu button[value="race"]')]);
  check(true, 'signed out, Division 9 sends you to sign in');

  check(!ann.errors.length && !bob.errors.length, `no page errors${[...ann.errors, ...bob.errors].map((e) => `: ${e}`).join('')}`);
} finally {
  await browser.close();
}
