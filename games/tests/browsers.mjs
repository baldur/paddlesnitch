// Plays each game in real browser engines, desktop and phone, and fails on
// any error. Covers both kayak renderers (WebGPU where the engine has it,
// the WebGL 2 fallback where it doesn't or with ?webgl) and browsers missing
// optional features (gamepads, speech, vibration, motion sensors, full
// screen, storage). Not part of `pnpm test:games`: it needs the browsers.
//
//   pnpm --filter web exec playwright install chromium webkit firefox   # once
//   pnpm test:games:browsers            # add --gpu to also use the installed Chrome's GPU
//
// Phones are emulated (screen size, touch, user agent), not real devices.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

// Playwright lives in the web app's dependencies; games/ has none of its own.
const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium, webkit, firefox, devices } = require('@playwright/test');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  // (also under /games/, as on the site: a case standing in for the site's API loads it there)
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '').replace(/^\/games\//, '/');
  if (path === '/favicon.ico') return res.writeHead(204).end(); // the site's, not ours
  try {
    const file = join(ROOT, path.endsWith('/') ? `${path}index.html` : path);
    const body = await readFile(file); // before the headers: a missing file (the site's API, say) is a 404
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;

// Take features away, as browsers without them would be.
const STRIP = `
  delete Navigator.prototype.gpu;
  delete Navigator.prototype.getGamepads;
  delete Navigator.prototype.vibrate;
  delete Navigator.prototype.sendBeacon;
  delete window.speechSynthesis; delete window.SpeechSynthesisUtterance;
  delete window.DeviceOrientationEvent; delete window.DeviceMotionEvent;
  Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false });
  for (const s of ['localStorage', 'sessionStorage']) {
    try { Object.defineProperty(window, s, { get() { throw new Error('blocked'); } }); } catch {}
  }
`;

const desktop = { viewport: { width: 1280, height: 720 } };
const landscape = (name) => {
  const { defaultBrowserType, ...d } = devices[name];
  return { ...d, viewport: { width: d.viewport.height, height: d.viewport.width } };
};
const gpu = { channel: 'chrome', args: ['--enable-unsafe-webgpu'] };
const CASES = [
  { name: 'chromium, desktop', engine: chromium, ctx: desktop },
  { name: 'chromium, desktop, ?webgl', engine: chromium, ctx: desktop, query: '?webgl' },
  { name: 'chrome GPU, desktop', engine: chromium, launch: gpu, ctx: desktop, gpuOnly: true, expect: 'webgpu' },
  { name: 'chrome GPU, desktop, ?webgl', engine: chromium, launch: gpu, ctx: desktop, gpuOnly: true, query: '?webgl', expect: 'webgl2' },
  { name: 'android chrome', engine: chromium, ctx: landscape('Pixel 7'), touch: true },
  { name: 'android, features missing', engine: chromium, ctx: landscape('Pixel 7'), touch: true, strip: true, expect: 'webgl2' },
  { name: 'webkit, desktop', engine: webkit, ctx: desktop, skip: true },
  { name: 'iphone safari', engine: webkit, ctx: landscape('iPhone 15'), touch: true },
  { name: 'iphone, features missing', engine: webkit, ctx: landscape('iPhone 15'), touch: true, strip: true, expect: 'webgl2' },
  { name: 'firefox, desktop', engine: firefox, ctx: desktop },
  { name: 'firefox, features missing', engine: firefox, ctx: desktop, strip: true, expect: 'webgl2' },
  // Every course is on the real river at Reading (the cases above paddle its
  // practice kilometre): a race with the pack, boats moving at speedup. In
  // WebKit: CI's Chromium draws the river in software, 4 to 6 minutes a case,
  // and the job has 30 (the Chromium cases above already play the full river).
  { name: 'webkit, desktop, Hasler Div 7-9 race', engine: webkit, ctx: desktop, course: 'hasler79', format: 'mass' },
  { name: 'iphone safari, Hasler Div 1-6 race', engine: webkit, ctx: landscape('iPhone 15'), touch: true, course: 'hasler16', format: 'mass' },
  { name: 'small iphone, Hasler Div 7-9 race', engine: webkit, ctx: landscape('iPhone 13 Mini'), touch: true, course: 'hasler79', format: 'mass' },
  { name: 'chrome GPU, desktop, Hasler Div 7-9 race', engine: chromium, launch: gpu, ctx: desktop, gpuOnly: true, course: 'hasler79', format: 'mass', expect: 'webgpu' },
  // A time trial, with interval starts.
  { name: 'webkit, desktop, Time Trial Loop time trial', engine: webkit, ctx: desktop, course: 'loop', format: 'interval' },
  { name: 'iphone safari, Time Trial Loop time trial', engine: webkit, ctx: landscape('iPhone 15'), touch: true, course: 'loop', format: 'interval' },
  // A practice drill: under way below the Mapledurham beach, no starter.
  { name: 'webkit, desktop, portage drill', engine: webkit, ctx: desktop, course: 'drill-portage' },
  // The walk to the club (#club, prototype): from the bridge to the club, to the water, and off.
  { name: 'iphone safari, the walk to the club', engine: webkit, ctx: landscape('iPhone 15'), touch: true, club: true },
  // Signed out, a time trial picked last time: Try it now is still a race, the open one.
  { name: 'webkit, desktop, try it now from the bridge, signed out', engine: webkit, ctx: desktop, club: true, tryIt: true, site: true, signedOut: true },
  // The outings from Caversham Pier: the river cruise, and a hired launch driven with the keys.
  // A race link goes to its race, not the walk; with no graphics at all (CI's Firefox) the walk falls back to the menu.
  { name: 'webkit, desktop, a race link', engine: webkit, ctx: desktop, raceLink: true },
  { name: 'webkit, desktop, race friends from the bridge', engine: webkit, ctx: desktop, club: true, friends: true, site: true },
  { name: 'firefox, features missing, the walk', engine: firefox, ctx: desktop, strip: true, club: true, expect: 'webgl2' },
  { name: 'webkit, desktop, river cruise', engine: webkit, ctx: desktop, club: true, outing: 'River cruise' },
  { name: 'webkit, desktop, hire a boat', engine: webkit, ctx: desktop, club: true, outing: 'Hire a boat', boat: 'Electric launch' },
  { name: 'iphone safari, hire a speedboat', engine: webkit, ctx: landscape('iPhone 15'), touch: true, club: true, outing: 'Hire a boat', boat: 'Speedboat' },
  // The rowing club: a practice row in a single scull, and a 500 m on the ergs.
  { name: 'webkit, desktop, a practice row', engine: webkit, ctx: desktop, club: true, row: true },
  { name: 'iphone safari, a practice row', engine: webkit, ctx: landscape('iPhone 15'), touch: true, club: true, row: true },
  { name: 'iphone safari, the ergs', engine: webkit, ctx: landscape('iPhone 15'), touch: true, club: true, row: true, erg: true },
];

// Plays one case in a fresh page. Returns a line describing what it saw;
// anything wrong goes into `errors`.
async function play(c, page, errors) {
  // A case with the site: under /games/, signed in as a stand-in player (the game only asks who's signed in).
  if (c.site) {
    await page.route('**/api/trpc/**', (r) => r.fulfill({ json: { result: { data: r.request().url().includes('/api/trpc/me') ? { user: c.signedOut ? null : { id: 'test', displayName: 'Pat R.' } } : null } } }));
  }
  if (c.tryIt) await page.addInitScript(() => localStorage.setItem('snitchmedia:kayak:format', 'interval'));
  // Racing friends: someone who's paddled before (a first visit's bridge leads with Try it now instead).
  if (c.friends) await page.addInitScript(() => localStorage.setItem('snitchmedia:kayak:last', 'loop'));
  await page.goto(`${base}${c.site ? '/games' : ''}/reading-thames/${c.query ?? ''}#debug${c.raceLink ? '&race=ABCD' : c.club ? '' : '&menu'}`); // the walk opens unless #menu (or a race link)
  // A machine with no graphics at all (CI's Firefox) can't run the game;
  // there the fallback is the menu's message, so check that instead.
  if (!(await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2')))) {
    const msg = page.locator('#nogpu');
    await msg.waitFor({ state: 'visible', timeout: 30_000 });
    if (!(await page.locator('#menu button[value="practice"]').isDisabled())) errors.push('no WebGL 2, but the race buttons are enabled');
    return `no WebGL 2 on this machine, so it says: "${(await msg.textContent()).slice(0, 50)}…"`;
  }
  await page.waitForFunction(() => window.kayak?.gpu, null, { timeout: 30_000 });
  const backend = await page.evaluate(() => window.kayak.gpu.backend);
  if (c.expect && backend !== c.expect) errors.push(`drew with ${backend}, expected ${c.expect}`);
  // Which screen opened: the walk by default, the menu with #menu, a race link straight to its race.
  const opened = await page.evaluate(() => ({ walk: !document.getElementById('club').hidden && !!window.kayak.club, menu: document.getElementById('menu').open }));
  if (c.club && !(opened.walk && !opened.menu)) errors.push(`expected the walk, got ${JSON.stringify(opened)}`);
  if (!c.club && opened.walk) errors.push(`the walk opened, expected ${c.raceLink ? 'the race link' : 'the menu'}`);
  if (c.raceLink) {
    // …and opens the race dialog on Join, its code filled in.
    await page.waitForFunction(() => document.getElementById('live').open, null, { timeout: 15_000 });
    const join = await page.evaluate(() => ({ join: document.getElementById('liveJoinTab').getAttribute('aria-pressed'), code: document.getElementById('liveCode').value }));
    if (!(join.join === 'true' && join.code === 'ABCD')) errors.push(`the race link opened ${JSON.stringify(join)}`);
    return `a race link: walk ${opened.walk ? 'opened (wrong)' : 'stayed shut'}, the race dialog on Join with ${join.code}`;
  }
  // Offline (no site behind the game), there's nobody to race: no racing-friends buttons.
  if (c.club && !c.site && (await page.locator('#clubCards .friend').count())) errors.push('racing-friends buttons offline');
  // Racing friends from the bridge (signed in): Invite friends opens the race dialog to make one, Join a race at the code box.
  if (c.friends) {
    await page.waitForFunction(() => document.querySelectorAll('#clubCards .friend').length === 2, null, { timeout: 15_000 });
    const opens = async (label, tab, focus) => {
      await page.locator('#clubCards .friend', { hasText: label }).click();
      const got = await page.evaluate((tab) => ({ open: document.getElementById('live').open, tab: document.getElementById(tab).getAttribute('aria-pressed'), focus: document.activeElement?.id }), tab);
      if (!(got.open && got.tab === 'true' && (!focus || got.focus === focus))) errors.push(`${label} opened ${JSON.stringify(got)}`);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('live').open && window.kayak.club);
    };
    await opens('Join a race', 'liveJoinTab', 'liveCode');
    await opens('Invite friends', 'liveMakeTab');
    // A keyboard reaches them: Tab to Join a race, Enter.
    // (Safari's Tab skips buttons unless you hold Option, as WebKit does here.)
    const tab = c.engine === webkit ? 'Alt+Tab' : 'Tab';
    for (let i = 0; i < 12 && !(await page.evaluate(() => document.activeElement?.textContent?.startsWith('Join a race'))); i++) await page.keyboard.press(tab);
    await page.keyboard.press('Enter');
    if (!(await page.evaluate(() => document.getElementById('live').open))) errors.push("Tab and Enter didn't reach Join a race");
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('live').open && window.kayak.club);
    // Outside the canoe club too; not in its rooms.
    await page.locator('#clubCards .card', { hasText: 'Canoe Club' }).click();
    await page.waitForFunction(() => window.kayak.club?.place === 'club' && !window.kayak.club.to, null, { timeout: 60_000 });
    if ((await page.locator('#clubCards .friend').count()) !== 2) errors.push('no racing-friends buttons outside the canoe club');
    await opens('Join a race', 'liveJoinTab', 'liveCode');
    await page.locator('#club button', { hasText: 'Changing room' }).first().click();
    await page.waitForFunction(() => window.kayak.club?.place === 'changing' && !window.kayak.club.to, null, { timeout: 60_000 });
    if (await page.locator('#clubCards .friend').count()) errors.push('racing-friends buttons in the changing room');
    return 'race friends: on the bridge and at the canoe club, by click and by keyboard, none in the rooms';
  }
  // The walk: tap the club's label on the bridge, then the water, then push off (practice, with no race picked yet).
  if (c.club) {
    // Into the changing room, open the picker, and Back out past it (a modal
    // picker once blocked every button in the room).
    // (Choosing a boat: Back first returns to the bridge's cards, then in again and pick.)
    const steps = c.tryIt ? [['Try it now', null]] : c.outing ? (c.boat ? [[c.outing, null], ['@unhire', null], [c.outing, null], [c.boat, null]] : [[c.outing, null]])
      : c.row ? [['Reading Rowing Club', 'rclub'], ...(c.erg ? [['Erg room', 'erg'], ['Row a 500 m', null]] : [['Clubhouse', 'rclubhouse'], ['Honours board', null], ['@honours', null], ['#clubBack', 'rclub'], ['Go to the water', 'rpontoon'], ['Push off', null]])]
      : [['Reading Canoe Club', 'club'], ['Changing room', 'changing'], ['Change', null], ['@backspace', 'changing'], ['#clubBack', 'club'], ['Changing room', 'changing'], ['@escape', 'club'], ['Go to the water', 'pontoon'], ['Push off', null]];
    for (const [label, place] of steps) {
      // Keys with the picker open: Backspace in one of its fields stays put, Esc goes back.
      if (label === '@backspace') {
        await page.locator('#menu input[name="hair"]').first().focus();
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(300);
        if (await page.evaluate(() => window.kayak.club.place !== 'changing' || !!window.kayak.club.to)) errors.push('Backspace in the picker left the room');
        continue;
      }
      // The honours board with no site behind it (offline): your bests as a note, no sheet.
      if (label === '@honours') {
        const shown = await page.evaluate(() => ({ note: !document.getElementById('clubNote').hidden && document.getElementById('clubNote').textContent, sheet: document.getElementById('menu').open }));
        if (!shown.note || shown.sheet) errors.push(`the honours board offline showed ${JSON.stringify(shown)}`);
        continue;
      }
      if (label === '@unhire') {
        await page.keyboard.press('Escape');
        const back = await page.evaluate(() => ({ canoe: [...document.querySelectorAll('#clubCards .card')].some((b) => b.textContent.includes('Canoe Club')), speedboat: [...document.querySelectorAll('#clubCards .card')].some((b) => b.textContent.includes('Speedboat')) }));
        if (!back.canoe || back.speedboat) errors.push(`Back from the choice of boats showed ${JSON.stringify(back)}`);
        continue;
      }
      if (label === '@escape') {
        await page.keyboard.press('Escape');
        await page.waitForFunction((p) => window.kayak.club?.place === p && !window.kayak.club.to, place, { timeout: 60_000 });
        continue;
      }
      const spot = label.startsWith('#') ? page.locator(label) : page.locator('#club button', { hasText: label }).first();
      await spot.waitFor({ state: 'visible', timeout: 30_000 });
      await (c.touch ? spot.tap() : spot.click());
      if (place) await page.waitForFunction((p) => window.kayak.club?.place === p && !window.kayak.club.to, place, { timeout: 60_000 });
      if (label === 'Change' && !(await page.locator('#menu').evaluate((m) => m.open))) errors.push("Change didn't open the paddler picker");
    }
    // (Signed out, a closed race goes to sign in: say so, not a timeout.)
    if (c.tryIt && await page.waitForURL(/signin/, { timeout: 3000 }).then(() => true, () => false)) return void errors.push('Try it now sent a signed-out player to sign in');
    if (!c.outing && !c.row && (await page.locator('#menu').evaluate((m) => m.open))) errors.push('the picker stayed open after leaving the room');
    if (c.tryIt) {
      await page.waitForFunction(() => window.kayak.mode?.key === 'hasler79' && window.kayak.race?.racers.length > 1, null, { timeout: 60_000 }).catch(() => {});
      const got = await page.evaluate(() => ({ racers: window.kayak.race.racers.length, course: window.kayak.mode?.key, format: window.kayak.format, easy: window.kayak.race.easy, help: document.getElementById('touchhelp').textContent }));
      if (!(got.racers > 1 && got.course === 'hasler79' && got.format === 'mass' && got.easy && got.help.startsWith('After the horn'))) errors.push(`Try it now started ${JSON.stringify(got)}, expected the Hasler Div 7-9 race`);
      const after = await page.evaluate(async () => {
        await window.kayak.submitResult(100);
        const ranked = document.getElementById('ranked');
        return { saved: localStorage.getItem('snitchmedia:kayak:format'), menu: document.querySelector('#menu [data-format="interval"]').getAttribute('aria-pressed'), signIn: !!ranked.querySelector('a[href*="signin"]'), text: ranked.textContent };
      });
      // The player's own pick stands, saved and on the menu, for the next course they choose.
      if (after.saved !== 'interval' || after.menu !== 'true') errors.push(`Try it now changed the picked format: ${JSON.stringify(after)}`);
      if (!after.signIn) errors.push(`a signed-out finish said "${after.text}", expected a link to sign in`);
    }
    // The erg: both sides together for each stroke, and the monitor counts down the 500 m.
    if (c.erg) {
      for (let i = 0; i < 6; i++) {
        if (c.touch) await Promise.all([page.touchscreen.tap(page.viewportSize().width * 0.2, page.viewportSize().height * 0.6), page.touchscreen.tap(page.viewportSize().width * 0.8, page.viewportSize().height * 0.6)]);
        else await page.keyboard.press('ArrowLeft');
        await page.waitForTimeout(1600);
      }
      const shown = await page.locator('#ergMon').textContent();
      const left = Number(/(\d+)m to go/.exec(shown)?.[1]);
      if (!(left < 500)) errors.push(`the erg's monitor says ${shown}`);
      return `the erg: ${shown.replace(/\s+/g, ' ').slice(0, 60)}`;
    }
  }
  // The practice time trial on your own, or a real river with the pack: there
  // the horn waits for you on the line, so the boat is put there.
  // A first visit opens on making your paddler: Next through boat and paddle to the races.
  // (Or skip it: one tap to the races, with the paddler you were given.)
  if (c.skip) {
    const skip = page.locator('#menu .step:not([hidden]) [data-skip]');
    if (!(await skip.isVisible())) errors.push('no Skip on a first visit');
    else await skip.click();
    if (await page.locator('#stepHome').isHidden()) errors.push("Skip didn't go to the races");
  }
  for (let i = 0; i < 3 && !c.club && await page.locator('#stepHome').isHidden(); i++) {
    const next = page.locator('#menu .step:not([hidden]) .step-buttons .next');
    await (c.touch ? next.tap() : next.click());
  }
  // The menu's buttons are big enough to tap.
  if (!c.club) {
    const small = await page.evaluate(() => [...document.querySelectorAll('#menu .edits button, #menu .format button')].filter((b) => b.getBoundingClientRect().height < 44).map((b) => b.textContent.trim().split('\n')[0]));
    if (small.length) errors.push(`menu buttons under 44 px: ${small.join(', ')}`);
  }
  if (c.format) {
    const format = page.locator(`#menu [data-format="${c.format}"]`);
    await (c.touch ? format.tap() : format.click());
  }
  // Practice and its drills are on the practice page.
  if (!c.club && (!c.course || c.course.startsWith('drill-'))) {
    const page2 = page.locator('#menu [data-step="practice"]');
    await (c.touch ? page2.tap() : page2.click());
  }
  const practice = page.locator(`#menu button[value="${c.course ?? 'practice'}"]`);
  if (!c.club) await (c.touch ? practice.tap() : practice.click());
  await page.waitForFunction(() => window.kayak.state === 'start' || window.kayak.state === 'racing', null, { timeout: 30_000 });
  // At the start the controls are on screen in a line: the phone's on a phone, the keys
  // on a keyboard (where the tap-here L and R aren't shown). Not in a scull on a keyboard, nor on an outing.
  if (!c.row && !c.outing) {
    await page.waitForFunction(() => getComputedStyle(document.getElementById('touchhelp')).display !== 'none', null, { timeout: 10_000 }).catch(() => {});
    const help = await page.evaluate(() => ({ text: document.getElementById('touchhelp').textContent, shown: getComputedStyle(document.getElementById('touchhelp')).display !== 'none', cue: getComputedStyle(document.querySelector('.cue')).display !== 'none' }));
    if (!help.shown) errors.push('no controls line at the start');
    if (!(c.touch ? /tap left/i.test(help.text) : /\u2190 \u2192/.test(help.text))) errors.push(`the controls line says "${help.text}"`);
    if (help.cue !== !!c.touch) errors.push(`the L and R tap marks ${help.cue ? 'show' : "don't show"}`);
  }
  await page.evaluate(() => {
    const { race, course, boat } = window.kayak;
    // This checks the game runs and answers the keys, not balance: the test never leans.
    boat.hull = { ...boat.hull, capsize: 10 };
    const i = Math.round((race.start.line - 4) / 2);
    const [a, n] = [course.samples[i], course.samples[i + 1]];
    if (race.format === 'interval') {
      // A time trial: bring everyone's start forward, so yours comes at once.
      const by = race.player.release - race.time - 1;
      for (const r of race.racers) r.release -= by;
    }
    // Out of the start queue by the bank, onto the line, mid-river (the test doesn't steer).
    if (race.racers.length > 1) Object.assign(boat, { x: a.x, z: a.z, heading: Math.atan2(n.x - a.x, -(n.z - a.z)), speed: 0, roll: 0, rollRate: 0 });
  });
  // The horn comes after a few seconds of race time: minutes, on CI's software graphics.
  await page.waitForFunction(() => window.kayak.state === 'racing', null, { timeout: 240_000 });
  // Paddle at about a racing rate: alternate sides, a stroke every 0.7 s of
  // race time. Race time, not real time: with software graphics (CI) a frame
  // can take a second, and the game slows its clock to match.
  // The best speed reached while paddling: the test doesn't steer, so on a
  // winding course the boat can reach a bank (and stop) by the last stroke.
  await page.evaluate(() => {
    window.__best = 0;
    const tick = () => {
      window.__best = Math.max(window.__best, window.kayak.boat.speed);
      window.__building ||= document.getElementById('flow').textContent === 'building';
      requestAnimationFrame(tick);
    };
    tick();
  });
  const { width, height } = page.viewportSize();
  // The hired launch: throttle full ahead first (then the arrow presses below steer it).
  if (c.outing === 'Hire a boat') for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowUp');
  for (let i = 0; i < 12; i++) {
    if (c.touch) await page.touchscreen.tap(i % 2 ? width * 0.8 : width * 0.2, height * 0.6);
    else await page.keyboard.press(i % 2 ? 'ArrowRight' : 'ArrowLeft');
    const next = (await page.evaluate(() => window.kayak.race.time)) + 0.7;
    await page.waitForFunction((t) => window.kayak.race.time >= t, next, { timeout: 30_000 });
  }
  const { speed, ms, s, start } = await page.evaluate(() => ({ speed: window.__best, ms: window.kayak.gpu.frameMs ?? window.kayak.gpu.gpuMs, s: window.kayak.loc.s, start: window.kayak.course.start }));
  if (!(speed > 1)) errors.push(`boat at ${speed.toFixed(2)} m/s after paddling`);
  // An even beat fills the rhythm bar, and it says so while it does.
  if (!c.row && !c.outing && !(await page.evaluate(() => window.__building))) errors.push('the rhythm bar never said "building"');
  const format = await page.evaluate(() => window.kayak.race.format ?? 'mass');
  if (c.format && format !== c.format) errors.push(`raced as ${format}, picked ${c.format}`);
  if (!(s > start + 2)) errors.push(`boat still on the start line (${s.toFixed(1)} m along, start at ${start})`);
  // A race's busiest moments: none of its messages on top of another, none under
  // Pause and Sound or off the screen, and no hidden bar showing. First the start
  // (the controls help, a hint and a big message), then mid-race (the place, the
  // wash and a turn cue under the clock, a hint and the balance-assist note).
  if (c.course) {
    const clash = await page.evaluate(() => {
      const $ = (id) => document.getElementById(id);
      const box = (el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return cs.display === 'none' || cs.visibility === 'hidden' || !r.width ? null : r;
      };
      const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const out = [];
      const check = (when) => {
        const named = { clock: document.querySelector('.hud-top'), place: $('place'), wash: $('wash'), cue: $('cue'), hint: $('hint'), help: $('touchhelp'), assist: $('assisted'), drill: $('drill'), flash: $('flash'), map: $('map'), near: $('near'), gauges: document.querySelector('.hud-bottom') };
        const boxes = Object.entries(named).map(([n, el]) => [n, box(el)]).filter(([n, b]) => b && (n !== 'flash' || $('flash').classList.contains('show')));
        boxes.forEach(([n, a], i) => boxes.slice(i + 1).forEach(([m, b]) => { if (hit(a, b)) out.push(`${when}: ${n} overlaps ${m}`); }));
        for (const b of document.querySelectorAll('header button')) if (named.map && hit(named.map.getBoundingClientRect(), b.getBoundingClientRect())) out.push(`${when}: the map is under ${b.textContent}`);
        for (const n of ['flash', 'hint', 'drill']) {
          const r = $(n).getBoundingClientRect();
          if (r.width && (r.left < 0 || r.right > innerWidth)) out.push(`${when}: ${n} runs off the screen (${Math.round(r.left)} to ${Math.round(r.right)})`);
        }
      };
      window.kayak.show('Paddle quicker than 90 a minute to sprint onto their wash', { small: true, hold: 5 });
      window.kayak.show("You hit a sculler's oars!", { hold: 5 });
      $('place').textContent = 'Caversham Bridge';
      $('cueText').textContent = "Round Fry's Island, keeping it on your right";
      for (const id of ['place', 'wash', 'cue']) $(id).classList.add('on');
      $('hud').classList.add('helping');
      check('at the start');
      $('hud').classList.remove('helping', 'flashing');
      $('flash').classList.remove('show');
      $('hud').classList.add('assisted');
      check('mid-race');
      $('hud').classList.remove('assisted');
      if (box($('outingBar'))) out.push('the hidden outing bar shows');
      if (matchMedia('(pointer: coarse)').matches) for (const b of document.querySelectorAll('header button')) if (b.getBoundingClientRect().height < 44) out.push(`${b.textContent} is under 44 px`);
      return out;
    });
    errors.push(...clash);
  }
  if (c.course && !c.course.startsWith('drill-')) {
    // One hint at a time: a moment's note doesn't wipe an instruction, and a
    // second instruction waits for the first to finish.
    const hint = () => page.evaluate(() => document.getElementById('hint').textContent);
    // (Cleared first, in the same frame: the race's own lessons can fill the
    // slot for longer than a test should wait, on CI's slow software drawing.)
    await page.evaluate(() => {
      window.kayak.show('', { small: true, now: true, hold: 0 });
      window.kayak.show('First instruction', { small: true, hold: 1.5 });
      window.kayak.show('Weak stroke', { small: true, hold: 0.5 });
      window.kayak.show('Second instruction', { small: true, hold: 1.2 });
    });
    if ((await hint()) !== 'First instruction') errors.push(`a later hint wiped the first: "${await hint()}"`);
    await page.waitForFunction(() => document.getElementById('hint').textContent === 'Second instruction', null, { timeout: 10_000 }).catch(async () => errors.push(`the waiting hint never showed: "${await hint()}"`));
    // Tipping over: the gauge warns in the red; then going in on your own says
    // so, and what keeps you up.
    await page.evaluate(() => Object.assign(window.kayak.boat, { roll: 0.6, rollRate: 0 }));
    await page.waitForFunction(() => document.getElementById('balance').classList.contains('tipping'), null, { timeout: 5_000 }).catch(() => errors.push("the balance gauge didn't warn in the red"));
    await page.evaluate(() => {
      const { boat } = window.kayak;
      boat.hull = { ...boat.hull, capsize: 0.3 };
      Object.assign(boat, { roll: 0.5, rollRate: 1 });
    });
    await page.waitForFunction(() => document.getElementById('flash').classList.contains('show'), null, { timeout: 10_000 }).catch(() => {});
    const fell = await page.evaluate(() => ({ flash: document.getElementById('flash').textContent, hint: document.getElementById('hint').textContent, assist: document.getElementById('hud').classList.contains('assisted') }));
    // (With the balance assist on, there's no lean to tell you about.)
    if (fell.flash !== 'You lost your balance!' || (!fell.assist && !(c.touch ? /turn the phone/ : /A and D/).test(fell.hint))) errors.push(`going in said ${JSON.stringify(fell)}`);
    // …and that counts as taught (teach.js won't tell you again), kept on the device.
    const taught = await page.evaluate(() => JSON.parse(localStorage.getItem('snitchmedia:kayak:taught') ?? '[]'));
    if (!fell.assist && !taught.includes('lean')) errors.push(`after going in, taught is ${JSON.stringify(taught)}`);
  }
  // Rowing really is rowing: a scull, the coach on its screen, gone while you look round.
  if (c.row) {
    const scull = await page.evaluate(() => !!window.kayak.boat.hull.scull);
    if (!scull) errors.push('pushed off in something other than a scull');
    if (await page.locator('#coach').isHidden()) errors.push("the stroke coach isn't showing");
    // The controls help at the start (a phone's) clear of the coach, and of the clock and the big message.
    if (c.touch) {
      const over = await page.evaluate(() => {
        const $ = (id) => document.getElementById(id);
        $('hud').classList.add('helping');
        window.kayak.show('Go!', { hold: 2 });
        const r = (el) => el.getBoundingClientRect();
        const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        const [help, coach, clock, flash] = [r($('touchhelp')), r($('coach')), r(document.querySelector('.hud-top')), r($('flash'))];
        const coachShown = getComputedStyle($('coach')).visibility !== 'hidden';
        const out = [coachShown && hit(help, coach) && 'the help under the coach', hit(help, clock) && 'the help on the clock', hit(flash, clock) && 'Go! on the clock', hit(flash, help) && 'Go! on the help'].filter(Boolean);
        $('hud').classList.remove('helping');
        return out;
      });
      errors.push(...over.map((o) => `rowing: ${o}`));
    }
    const lookIs = async (side, what) => {
      await page.waitForTimeout(800);
      const look = await page.evaluate(() => window.kayak.look);
      if (!(side ? look * side > 0.9 : Math.abs(look) < 0.1)) errors.push(`${what}: looked ${look.toFixed(2)}, expected ${side}`);
    };
    if (c.touch) {
      // A phone: the two Look buttons, both showing, apart, each looking over its own shoulder.
      const [l, r] = [await page.locator('#lookLeft').boundingBox(), await page.locator('#lookRight').boundingBox()];
      if (!l || !r || l.x + l.width > r.x) errors.push(`the Look buttons: ${JSON.stringify([l, r])}`);
      for (const [id, side] of [['#lookLeft', -1], ['#lookRight', 1]]) {
        await page.locator(id).dispatchEvent('pointerdown');
        await lookIs(side, id);
        if (await page.locator('#coach').isVisible()) errors.push('the coach stayed up while looking round');
        await page.locator(id).dispatchEvent('pointerup');
        await lookIs(0, `${id} let go`);
      }
      // A tap is a glance: it looks, then comes back on its own.
      await page.locator('#lookRight').dispatchEvent('pointerdown');
      await page.locator('#lookRight').dispatchEvent('pointerup');
      await lookIs(1, 'a tap on Look ▶');
      await page.waitForTimeout(1300);
      await lookIs(0, 'the glance over');
    } else {
      // Over each shoulder: Q left, E right; the coach goes while you look.
      for (const [key, side] of [['KeyQ', -1], ['KeyE', 1]]) {
        await page.keyboard.down(key);
        await lookIs(side, `holding ${key}`);
        if (await page.locator('#coach').isVisible()) errors.push('the coach stayed up while looking round');
        await page.keyboard.up(key);
      }
      // E held, then Q: left; let go of Q and it's E's again. Then leaving the window lets go of everything.
      await page.keyboard.down('KeyE');
      await page.keyboard.down('KeyQ');
      await lookIs(-1, 'E then Q');
      await page.keyboard.up('KeyQ');
      await lookIs(1, 'let go of Q with E held');
      await page.evaluate(() => dispatchEvent(new Event('blur')));
      await lookIs(0, 'after the window lost focus');
      await page.keyboard.up('KeyE');
    }
  }
  // Analytics (metrics.js): the paddler and the session go out when the page is
  // hidden; locally they're kept in gameMetrics.sent instead of sent.
  if (c.outing) {
    const sent = await page.evaluate(() => { window.gameMetrics.send(); return window.gameMetrics.sent.flatMap((b) => b.events); });
    const kinds = sent.map((e) => e.event);
    for (const want of ['pageview', 'game_kit', 'game_session']) if (!kinds.includes(want)) errors.push(`no ${want} event (sent ${kinds.join(', ')})`);
    const session = sent.find((e) => e.event === 'game_session');
    if (session && !(Number(session.props.secs) > 3 && session.props.places.includes('path') && session.props.from === 'walk' && session.props.plays === '1')) errors.push(`game_session says ${JSON.stringify(session.props)}`);
    if (kinds.filter((k) => k === 'game_kit').length !== 1) errors.push(`game_kit sent ${kinds.filter((k) => k === 'game_kit').length} times`);
    // Closing the page mid-outing still reports the play, ended 'closed', with how far it went.
    const closed = await page.evaluate(() => { dispatchEvent(new Event('pagehide')); return window.gameMetrics.sent.flatMap((b) => b.events).find((e) => e.event === 'game_play'); });
    if (!(closed?.props.end === 'closed' && closed.props.mode === 'outing' && Number(closed.props.km) > 0)) errors.push(`closing the page reported ${JSON.stringify(closed?.props)}`);
    // A hired boat: the one you picked, and the analytics say which.
    if (c.boat) {
      const id = { 'Electric launch': 'launch', Speedboat: 'speedboat', Narrowboat: 'narrowboat' }[c.boat];
      const boat = await page.evaluate(() => window.kayak.race.outing?.boat);
      if (boat !== id) errors.push(`hired the ${boat}, picked ${id}`);
      if (closed?.props.course !== `hire-${id}`) errors.push(`analytics course ${closed?.props.course}, expected hire-${id}`);
    }
  }
  // The finish on a small phone, signed out (its extra line), with every
  // button: all of them on screen without scrolling.
  if (c.course === 'hasler79' && c.touch) {
    await page.evaluate(() => {
      const { race } = window.kayak;
      race.player.finish = race.time + 400;
      window.kayak.finish();
    });
    await page.waitForFunction(() => document.getElementById('finished').open, null, { timeout: 15_000 });
    const cut = await page.evaluate(() => {
      document.getElementById('ranked').textContent = 'Sign in to put your time on the leaderboard.';
      const dialog = document.getElementById('finished');
      for (const b of dialog.querySelectorAll('button')) b.hidden = false;
      return [...dialog.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().bottom > Math.min(innerHeight, dialog.getBoundingClientRect().bottom)).map((b) => b.textContent);
    });
    if (cut.length) errors.push(`the finish on a phone hides ${cut.join(', ')} below the fold`);
  }
  return `${backend}, ${speed.toFixed(1)} m/s, ${Math.round(ms)} ms ${backend === 'webgpu' ? 'GPU time' : 'frames'}`;
}

let failed = 0;
for (const c of CASES) {
  if (c.gpuOnly && !process.argv.includes('--gpu')) continue;
  if (process.env.ONLY && !c.name.includes(process.env.ONLY)) continue; // ONLY=portage: just the cases named so
  if (process.env.ENGINE && c.engine.name() !== process.env.ENGINE) continue; // ENGINE=webkit: one browser (CI runs the three side by side)
  const errors = [];
  let line = '';
  const browser = await c.engine.launch(c.launch ?? {});
  try {
    const context = await browser.newContext(c.ctx);
    if (c.strip) await context.addInitScript(STRIP);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    try {
      line = await play(c, page, errors);
    } catch (e) {
      errors.push(e.message.split('\n')[0]);
      line = await page.evaluate(() => `${window.kayak?.gpu?.backend ?? 'no renderer'}, ${Math.round(window.kayak?.gpu?.frameMs ?? 0)} ms frames, state ${window.kayak?.state}, message: ${document.getElementById('nogpu')?.textContent || 'none'}`).catch(() => '');
    }
  } finally {
    await browser.close();
  }
  if (errors.length) failed++;
  console.log(`${errors.length ? '✖' : '✔'} ${c.name}: ${line}${errors.length ? `\n    ${errors.join('\n    ')}` : ''}`);
}
server.close();
process.exitCode = failed ? 1 : 0;
