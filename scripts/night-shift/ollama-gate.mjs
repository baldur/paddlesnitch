// The night shift's only way to the model (docs/night-shift/README.md).
// Ollama itself can reach the internet (pull, push, create from a URL), so
// the sandbox doesn't let the night shift talk to it directly. run.sh starts
// this gate outside the sandbox; it passes on chat, completion and listing
// requests and refuses everything else.
//
//   node scripts/night-shift/ollama-gate.mjs [port=11435] [ollama=http://127.0.0.1:11434]
import http from 'node:http'

const PORT = Number(process.argv[2] ?? 11435)
const OLLAMA = new URL(process.argv[3] ?? 'http://127.0.0.1:11434')
const MAX_BODY = 64 * 1024 * 1024 // images go in as base64

export const ALLOWED = new Set([
  'GET /api/tags', 'GET /api/version', 'GET /api/ps', 'POST /api/show',
  'POST /api/chat', 'POST /api/generate', 'POST /api/embed', 'POST /api/embeddings',
  'GET /v1/models', 'POST /v1/chat/completions', 'POST /v1/completions', 'POST /v1/embeddings',
])
export const allowed = (method, url) => ALLOWED.has(`${method} ${new URL(url, 'http://x').pathname.replace(/\/+$/, '')}`)

const server = http.createServer((req, res) => {
  if (!allowed(req.method, req.url)) {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('the night shift may only chat with the model\n')
    return
  }
  let size = 0
  const up = http.request({
    // Forward the path that was checked, never the raw one.
    host: OLLAMA.hostname, port: OLLAMA.port, method: req.method, path: new URL(req.url, 'http://x').pathname,
    headers: { 'content-type': req.headers['content-type'] ?? 'application/json' },
  }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res) })
  up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
  req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { req.destroy(); up.destroy() } })
  req.pipe(up)
})

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, '127.0.0.1', () => console.log(`[ollama-gate] 127.0.0.1:${PORT} -> ${OLLAMA.origin}`))
}
