#!/usr/bin/env node
// The games with the site, locally, as on paddlesnitch.com: the games under
// /games/ from this folder, and everything else (the API, sign-in, every page)
// passed through to the Next app. One origin, so the game's API calls carry
// your sign-in cookie, as they do in production. It also runs the live-race
// relay at ws://…/live, the same code as the relay's Lambda
// (infra/lambdas/game-relay/relay.mjs), keeping its state where the dev site
// keeps its files, so it can read the tickets the site's API writes.
//
//   pnpm dev            # the site, on :3000
//   pnpm games:site     # then http://localhost:8001/games/kayak/
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { WebSocketServer } from 'ws';
import { createRelay } from '../../infra/lambdas/game-relay/relay.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE = Number(process.env.SITE_PORT ?? 3000);
const PORT = Number(process.env.PORT ?? 8001);
const DATA = process.env.DATA_DIR ?? fileURLToPath(new URL('../../apps/web/.local-data', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/games/') && !url.pathname.startsWith('/games/tests/')) {
    let file = path.join(ROOT, decodeURIComponent(url.pathname.slice('/games/'.length)));
    if (!file.startsWith(ROOT)) return void res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      if (!url.pathname.endsWith('/')) return void res.writeHead(301, { Location: `${url.pathname}/${url.search}` }).end();
      file = path.join(file, 'index.html');
    }
    if (fs.existsSync(file)) return void res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(fs.readFileSync(file));
  }
  const proxied = http.request({ host: 'localhost', port: SITE, path: req.url, method: req.method, headers: req.headers }, (up) => {
    res.writeHead(up.statusCode, up.headers);
    up.pipe(res);
  });
  proxied.on('error', () => res.writeHead(502).end(`The site isn't running on :${SITE} (pnpm dev).`));
  req.pipe(proxied);
});

// The relay, over files instead of S3.
const file = (key) => path.join(DATA, key);
const store = {
  get: async (key) => {
    try {
      return JSON.parse(await fs.promises.readFile(file(key), 'utf8'));
    } catch {
      return null;
    }
  },
  put: async (key, value) => {
    await fs.promises.mkdir(path.dirname(file(key)), { recursive: true });
    await fs.promises.writeFile(file(key), JSON.stringify(value));
  },
  del: (key) => fs.promises.rm(file(key), { force: true }),
  list: async (prefix) => (await fs.promises.readdir(file(prefix)).catch(() => [])).map((name) => prefix + name),
};
const sockets = new Map(); // connection id -> WebSocket
const relay = createRelay({
  store,
  post: async (conn, text) => {
    const ws = sockets.get(conn);
    if (ws?.readyState !== ws?.OPEN) throw Object.assign(new Error('gone'), { gone: true });
    ws.send(text);
  },
});
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/live') return void socket.destroy();
  const conn = randomUUID();
  const status = await relay.connect(conn, Object.fromEntries(url.searchParams));
  if (status !== 200) return void socket.end(`HTTP/1.1 ${status} No\r\n\r\n`);
  wss.handleUpgrade(req, socket, head, (ws) => {
    sockets.set(conn, ws);
    ws.on('message', (data) => relay.message(conn, data.toString()).catch((e) => console.error('[relay]', e)));
    ws.on('close', () => {
      sockets.delete(conn);
      relay.disconnect(conn).catch((e) => console.error('[relay]', e));
    });
  });
});

server.listen(PORT, () => console.log(`games with the site: http://localhost:${PORT}/games/kayak/ (relay at ws://localhost:${PORT}/live)`));
