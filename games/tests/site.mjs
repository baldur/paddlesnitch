#!/usr/bin/env node
// The games with the site, locally, as on paddlesnitch.com: the games under
// /games/ from this folder, and everything else (the API, sign-in, every page)
// passed through to the Next app. One origin, so the game's API calls carry
// your sign-in cookie, as they do in production.
//
//   pnpm dev            # the site, on :3000
//   pnpm games:site     # then http://localhost:8001/games/kayak/
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE = Number(process.env.SITE_PORT ?? 3000);
const PORT = Number(process.env.PORT ?? 8001);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };

http.createServer((req, res) => {
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
}).listen(PORT, () => console.log(`games with the site: http://localhost:${PORT}/games/kayak/`));
