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
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
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
  { name: 'webkit, desktop', engine: webkit, ctx: desktop },
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
  { name: 'chrome GPU, desktop, Hasler Div 7-9 race', engine: chromium, launch: gpu, ctx: desktop, gpuOnly: true, course: 'hasler79', format: 'mass', expect: 'webgpu' },
  // A time trial, with interval starts.
  { name: 'webkit, desktop, Time Trial Loop time trial', engine: webkit, ctx: desktop, course: 'loop', format: 'interval' },
  { name: 'iphone safari, Time Trial Loop time trial', engine: webkit, ctx: landscape('iPhone 15'), touch: true, course: 'loop', format: 'interval' },
  // A practice drill: under way below the Mapledurham beach, no starter.
  { name: 'webkit, desktop, portage drill', engine: webkit, ctx: desktop, course: 'drill-portage' },
  // The walk to the club (#club, prototype): from the bridge to the club, to the water, and off.
  { name: 'iphone safari, the walk to the club', engine: webkit, ctx: landscape('iPhone 15'), touch: true, club: true },
  // The outings from Caversham Pier: the river cruise, and a hired launch driven with the keys.
  // A race link goes to its race, not the walk; with no graphics at all (CI's Firefox) the walk falls back to the menu.
  { name: 'webkit, desktop, a race link', engine: webkit, ctx: desktop, raceLink: true },
  { name: 'firefox, features missing, the walk', engine: firefox, ctx: desktop, strip: true, club: true, expect: 'webgl2' },
  { name: 'webkit, desktop, river cruise', engine: webkit, ctx: desktop, club: true, outing: 'River cruise' },
  { name: 'webkit, desktop, hire a boat', engine: webkit, ctx: desktop, club: true, outing: 'Hire a boat' },
  // The rowing club: a practice row in a single scull, and a 500 m on the ergs.
  { name: 'webkit, desktop, a practice row', engine: webkit, ctx: desktop, club: true, row: true },
  { name: 'iphone safari, the ergs', engine: webkit, ctx: landscape('iPhone 15'), touch: true, club: true, row: true, erg: true },
];

// Plays one case in a fresh page. Returns a line describing what it saw;
// anything wrong goes into `errors`.
async function play(c, page, errors) {
  await page.goto(`${base}/kayak/${c.query ?? ''}#debug${c.raceLink ? '&race=ABCD' : c.club ? '' : '&menu'}`); // the walk opens unless #menu (or a race link)
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
  if (c.raceLink) return `a race link: walk ${opened.walk ? 'opened (wrong)' : 'stayed shut'}`;
  // The walk: tap the club's label on the bridge, then the water, then push off (practice, with no race picked yet).
  if (c.club) {
    // Into the changing room, open the picker, and Back out past it (a modal
    // picker once blocked every button in the room).
    const steps = c.outing ? [[c.outing, null]]
      : c.row ? [['Reading Rowing Club', 'rclub'], ...(c.erg ? [['Erg room', 'erg'], ['Row a 500 m', null]] : [['Go to the water', 'rpontoon'], ['Push off', null]])]
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
    if (!c.outing && !c.row && (await page.locator('#menu').evaluate((m) => m.open))) errors.push('the picker stayed open after leaving the room');
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
  for (let i = 0; i < 3 && !c.club && await page.locator('#stepHome').isHidden(); i++) {
    const next = page.locator('#menu .step:not([hidden]) .step-buttons .next');
    await (c.touch ? next.tap() : next.click());
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
  const format = await page.evaluate(() => window.kayak.race.format ?? 'mass');
  if (c.format && format !== c.format) errors.push(`raced as ${format}, picked ${c.format}`);
  if (!(s > start + 2)) errors.push(`boat still on the start line (${s.toFixed(1)} m along, start at ${start})`);
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
  }
  return `${backend}, ${speed.toFixed(1)} m/s, ${Math.round(ms)} ms ${backend === 'webgpu' ? 'GPU time' : 'frames'}`;
}

let failed = 0;
for (const c of CASES) {
  if (c.gpuOnly && !process.argv.includes('--gpu')) continue;
  if (process.env.ONLY && !c.name.includes(process.env.ONLY)) continue; // ONLY=portage: just the cases named so
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
