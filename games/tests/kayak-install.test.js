// Added to the Home Screen, the game opens full screen without the browser
// (manifest.json, and Apple's tags for an iPhone): the manifest, its icons and
// the page's links to them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = (name) => new URL(`../reading-thames/${name}`, import.meta.url);
// A PNG's width and height, from its header.
const pngSize = (buf) => (buf.subarray(1, 4).toString() === 'PNG' ? [buf.readUInt32BE(16), buf.readUInt32BE(20)] : null);

test('the manifest opens the game full screen, from its own folder, with icons of the sizes it says', async () => {
  const m = JSON.parse(await readFile(file('manifest.json'), 'utf8'));
  assert.equal(m.display, 'fullscreen');
  assert.ok(m.name && m.short_name.length <= 15, 'a short name fits under a home-screen icon');
  // Relative, so it works served on its own (pnpm games) as well as under /games/.
  for (const key of ['start_url', 'scope', 'id']) assert.equal(m[key], './', key);
  for (const purpose of ['any', 'maskable']) {
    const sizes = m.icons.filter((i) => i.purpose === purpose).map((i) => i.sizes);
    assert.ok(sizes.includes('192x192') && sizes.includes('512x512'), `Android needs 192 and 512 (${purpose})`);
  }
  // (Not both purposes on one icon: a maskable one is cropped to a circle, so it needs its own padding.)
  assert.ok(m.icons.every((i) => !i.purpose.includes(' ')));
  for (const icon of m.icons) {
    assert.ok(!icon.src.startsWith('/') && !icon.src.includes('//'), `${icon.src} is relative`);
    assert.deepEqual(pngSize(await readFile(file(icon.src))), icon.sizes.split('x').map(Number), icon.src);
  }
});

test("the page links the manifest, and an iPhone's icon and tags (relative links, as every game's)", async () => {
  const html = await readFile(file('index.html'), 'utf8');
  assert.match(html, /<link rel="manifest" href="manifest.json">/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  const touch = /<link rel="apple-touch-icon" href="([^"]+)">/.exec(html)?.[1];
  assert.ok(touch && !touch.startsWith('/'));
  assert.deepEqual(pngSize(await readFile(file(touch))), [180, 180]);
});
