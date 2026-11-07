// `pnpm games:site` (site.mjs) passes WebSocket upgrades through to the site,
// except /live, which is its own relay. Next's dev page reload socket
// (/_next/hmr) was once dropped, so the site's pages never hydrated on :8001
// and Sign in fell back to a plain form GET.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const free = async () => {
  const s = http.createServer().listen(0);
  await once(s, 'listening');
  const { port } = s.address();
  s.close();
  return port;
};

test("a WebSocket that isn't /live goes through to the site; /live stays on the relay", { timeout: 20_000 }, async (t) => {
  // A stand-in site: echoes on any WebSocket, and notes the paths it was asked for.
  const site = http.createServer();
  const asked = [];
  const heard = [];
  const wss = new WebSocketServer({ server: site });
  wss.on('connection', (ws, req) => {
    asked.push(new URL(req.url, 'http://x').pathname);
    ws.on('message', (m) => { heard.push(String(m)); ws.send(`echo ${m}`); });
  });
  site.listen(0);
  await once(site, 'listening');
  const port = await free();
  const child = spawn(process.execPath, [fileURLToPath(new URL('site.mjs', import.meta.url))], {
    env: { ...process.env, PORT: String(port), SITE_PORT: String(site.address().port), DATA_DIR: fileURLToPath(new URL('../../node_modules/.cache/site-upgrade-test', import.meta.url)) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(() => { child.kill(); site.close(); wss.close(); });
  let ready = false;
  for await (const line of child.stdout) if (String(line).includes('games with the site')) { ready = true; break; }
  assert.ok(ready, `site.mjs didn't start (exit ${child.exitCode})`);

  // Next's reload socket: opens, and talks to the site.
  const hmr = new WebSocket(`ws://localhost:${port}/_next/hmr?id=test`);
  await new Promise((ok, fail) => { hmr.onopen = ok; hmr.onerror = () => fail(new Error('the /_next/hmr socket was dropped')); });
  hmr.send('hello');
  const [reply] = await once(hmr, 'message');
  assert.equal(reply.data, 'echo hello');
  hmr.close();

  // A message sent in the same packet as the handshake (the proxy's `head`) reaches the site too.
  const raw = net.connect(port, 'localhost');
  await once(raw, 'connect');
  const text = Buffer.from('early');
  const mask = Buffer.from([1, 2, 3, 4]);
  const frame = Buffer.concat([Buffer.from([0x81, 0x80 | text.length]), mask, Buffer.from(text.map((b, i) => b ^ mask[i % 4]))]);
  raw.write(Buffer.concat([Buffer.from(`GET /_next/hmr?id=raw HTTP/1.1\r\nHost: localhost:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`), frame]));
  for (let i = 0; i < 50 && !heard.includes('early'); i++) await new Promise((ok) => setTimeout(ok, 20));
  raw.destroy();
  assert.ok(heard.includes('early'), `the site heard ${JSON.stringify(heard)}`);

  // /live is the relay's (refused here, with no ticket), never the site's.
  // (Opened, it would have gone to the site: the check below says so, rather than waiting forever.)
  const live = new WebSocket(`ws://localhost:${port}/live`);
  await new Promise((ok) => { live.onerror = ok; live.onclose = ok; live.onopen = ok; });
  live.close();
  assert.deepEqual(asked, ['/_next/hmr', '/_next/hmr']);
});
