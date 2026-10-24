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
  // The real river: a course file, a world four times the size, boats moving at speedup.
  { name: 'chromium, desktop, Reading Thames', engine: chromium, ctx: desktop, course: 'reading' },
  { name: 'iphone safari, Reading Thames', engine: webkit, ctx: landscape('iPhone 15'), touch: true, course: 'reading' },
  { name: 'chrome GPU, desktop, Reading Thames', engine: chromium, launch: gpu, ctx: desktop, gpuOnly: true, course: 'reading', expect: 'webgpu' },
  // A time trial on a loop round islands, with interval starts.
  { name: 'chromium, desktop, Time Trial Loop', engine: chromium, ctx: desktop, course: 'loop' },
  { name: 'iphone safari, Time Trial Loop', engine: webkit, ctx: landscape('iPhone 15'), touch: true, course: 'loop' },
];

// Plays one case in a fresh page. Returns a line describing what it saw;
// anything wrong goes into `errors`.
async function play(c, page, errors) {
  await page.goto(`${base}/kayak/${c.query ?? ''}#debug`);
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
  // The practice time trial on your own, or a real river with the pack: there
  // the horn waits for you on the line, so the boat is put there.
  const practice = page.locator(`#menu button[value="${c.course ?? 'practice'}"]`);
  await (c.touch ? practice.tap() : practice.click());
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
  const { width, height } = page.viewportSize();
  for (let i = 0; i < 12; i++) {
    if (c.touch) await page.touchscreen.tap(i % 2 ? width * 0.8 : width * 0.2, height * 0.6);
    else await page.keyboard.press(i % 2 ? 'ArrowRight' : 'ArrowLeft');
    const next = (await page.evaluate(() => window.kayak.race.time)) + 0.7;
    await page.waitForFunction((t) => window.kayak.race.time >= t, next, { timeout: 30_000 });
  }
  const { speed, ms, s, start } = await page.evaluate(() => ({ speed: window.kayak.boat.speed, ms: window.kayak.gpu.frameMs ?? window.kayak.gpu.gpuMs, s: window.kayak.loc.s, start: window.kayak.course.start }));
  if (!(speed > 1)) errors.push(`boat at ${speed.toFixed(2)} m/s after paddling`);
  if (!(s > start + 2)) errors.push(`boat still on the start line (${s.toFixed(1)} m along, start at ${start})`);
  return `${backend}, ${speed.toFixed(1)} m/s, ${Math.round(ms)} ms ${backend === 'webgpu' ? 'GPU time' : 'frames'}`;
}

let failed = 0;
for (const c of CASES) {
  if (c.gpuOnly && !process.argv.includes('--gpu')) continue;
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
