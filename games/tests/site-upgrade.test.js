// `pnpm games:site` (site.mjs) passes WebSocket upgrades through to the site,
// except /live, which is its own relay. Next's dev page reload socket
// (/_next/hmr) was once dropped, so the site's pages never hydrated on :8001
// and Sign in fell back to a plain form GET.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
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

test("a WebSocket that isn't /live goes through to the site; /live stays on the relay", async (t) => {
  // A stand-in site: echoes on any WebSocket, and notes the paths it was asked for.
  const site = http.createServer();
  const asked = [];
  const wss = new WebSocketServer({ server: site });
  wss.on('connection', (ws, req) => {
    asked.push(new URL(req.url, 'http://x').pathname);
    ws.on('message', (m) => ws.send(`echo ${m}`));
  });
  site.listen(0);
  await once(site, 'listening');
  const port = await free();
  const child = spawn(process.execPath, [fileURLToPath(new URL('site.mjs', import.meta.url))], {
    env: { ...process.env, PORT: String(port), SITE_PORT: String(site.address().port), DATA_DIR: fileURLToPath(new URL('../../node_modules/.cache/site-upgrade-test', import.meta.url)) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(() => { child.kill(); site.close(); wss.close(); });
  for await (const line of child.stdout) if (String(line).includes('games with the site')) break;

  // Next's reload socket: opens, and talks to the site.
  const hmr = new WebSocket(`ws://localhost:${port}/_next/hmr?id=test`);
  await new Promise((ok, fail) => { hmr.onopen = ok; hmr.onerror = () => fail(new Error('the /_next/hmr socket was dropped')); });
  hmr.send('hello');
  const [reply] = await once(hmr, 'message');
  assert.equal(reply.data, 'echo hello');
  hmr.close();

  // /live is the relay's (refused here, with no ticket), never the site's.
  const live = new WebSocket(`ws://localhost:${port}/live`);
  await new Promise((ok) => { live.onerror = ok; live.onclose = ok; });
  assert.deepEqual(asked, ['/_next/hmr']);
});
