#!/usr/bin/env node
// River Explorer: walk the river spot by spot and see what the local model saw,
// pinned on the pictures, and say whether it was right.
//
//   pnpm --filter web course:explore [--port 3201]   then open http://localhost:3201
//
// Reads the course:look store (lib/footage-db.ts) and can run while course:look
// is looking. The pictures are cut from the clips when first opened and kept in
// the store's views/ folder. Everything stays on this machine: the server
// answers only localhost. Click a pin to mark it right, again for wrong, again
// to clear; click the picture where the model missed something. Keys: ← → along
// the clip, n the next spot not yet checked, a marks this spot's unmarked pins right.
// See docs/features/game-courses-from-video.md, "Checking what it saw".
import fs from 'fs'
import http from 'http'
import path from 'path'
import { eacGraph, eacLayout, flatView } from './lib/eac'
import { openStore, saveMissed, saveReview, STORE } from './lib/footage-db'
import { hostAllowed, layoutPins, originAllowed, otherPasses, route, scoreOf, stripOrder, type Verdict } from './lib/explore'
import { KINDS, PROMPT_VERSION, VIEW, VIEWS, type Distance } from './lib/look'
import { PAGE } from './lib/explore-page'
import { runDetached } from './lib/proc'

const portArg = process.argv.indexOf('--port')
const PORT = portArg > 0 ? Number(process.argv[portArg + 1]) : 3201
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) { console.error('stopped: --port must be 1024–65535'); process.exit(1) }
const modelArg = process.argv.indexOf('--model')
const MODEL = modelArg > 0 ? process.argv[modelArg + 1] : 'qwen2.5vl:32b'

const db = openStore()
const VIEW_DIR = path.join(STORE, 'views')
fs.mkdirSync(VIEW_DIR, { recursive: true })

type SpotRow = { id: number; chapterId: number; lat: number; lng: number; heading: number; ft: number; level: number; clip: string; cameraYaw: number | null; things: number; checked: number; startUtc: string | null }

/** Every spot the model has looked at, for the map. */
function spots(): SpotRow[] {
  return (db.prepare(`
    SELECT s.id, s.chapter_id AS chapterId, s.lat, s.lng, s.heading, s.ft, s.level, c.path AS clip, c.camera_yaw AS cameraYaw, c.start_utc AS startUtc,
      count(i.id) AS things, count(r.item_id) AS checked
    FROM stations s JOIN chapters c ON c.id = s.chapter_id JOIN looks l ON l.station_id = s.id AND l.model = ? AND l.prompt_version = ?
    LEFT JOIN items i ON i.look_id = l.id LEFT JOIN reviews r ON r.item_id = i.id
    GROUP BY s.id ORDER BY c.start_utc, s.ft`).all(MODEL, PROMPT_VERSION) as SpotRow[])
    .map((s) => ({ ...s, clip: path.basename(s.clip) }))
}

/** The tracks, thinned, so the map shows where the river goes between spots. */
function tracks(): number[][][] {
  return (db.prepare("SELECT track FROM chapters WHERE status != 'no-gps' AND track IS NOT NULL").all() as Array<{ track: string }>)
    .map((r) => (JSON.parse(r.track) as number[][]).filter((_, i) => i % 10 === 0).map(([, lat, lng]) => [+lat.toFixed(5), +lng.toFixed(5)]))
}

function spot(id: number) {
  const all = spots()
  const at = all.find((s) => s.id === id)
  if (!at) return null
  const looks = db.prepare('SELECT id, view_yaw AS viewYaw, ok, scene, water, light FROM looks WHERE station_id = ? AND model = ? AND prompt_version = ?')
    .all(id, MODEL, PROMPT_VERSION) as Array<{ id: number; viewYaw: number; ok: number; scene: string | null; water: string | null; light: string | null }>
  const views = stripOrder(at.cameraYaw).map((v) => {
    const l = looks.find((x) => x.viewYaw === v.viewYaw)
    const items = l ? db.prepare(`SELECT i.id, i.kind, i.detail, i.x, i.distance, i.count, r.verdict FROM items i LEFT JOIN reviews r ON r.item_id = i.id WHERE i.look_id = ? ORDER BY i.id`)
      .all(l.id) as Array<{ id: number; kind: string; detail: string; x: number; distance: Distance; count: number; verdict: Verdict | null }> : []
    const missed = l ? db.prepare('SELECT id, kind, x FROM missed WHERE look_id = ?').all(l.id) : []
    return { ...v, lookId: l?.id ?? null, ok: !!l?.ok, scene: l?.scene ?? null, water: l?.water ?? null, light: l?.light ?? null, pins: layoutPins(items), missed }
  })
  const sameClip = all.filter((s) => s.chapterId === at.chapterId)
  const i = sameClip.findIndex((s) => s.id === id)
  return {
    ...at, views, prev: sameClip[i - 1]?.id ?? null, next: sameClip[i + 1]?.id ?? null,
    others: otherPasses(all, at).map((o) => ({ id: o.id, clip: o.clip, startUtc: o.startUtc, metres: Math.round(o.metres) })),
  }
}

function score() {
  const reviews = db.prepare(`SELECT i.kind, r.verdict FROM reviews r JOIN items i ON i.id = r.item_id JOIN looks l ON l.id = i.look_id
    WHERE l.model = ? AND l.prompt_version = ?`).all(MODEL, PROMPT_VERSION) as Array<{ kind: string; verdict: Verdict }>
  const missed = (db.prepare('SELECT count(*) AS n FROM missed m JOIN looks l ON l.id = m.look_id WHERE l.model = ? AND l.prompt_version = ?').get(MODEL, PROMPT_VERSION) as { n: number }).n
  return scoreOf(reviews, missed)
}

// The four views of a spot are cut together the first time one is asked for.
const cutting = new Map<number, Promise<void>>()
function viewFile(id: number, yaw: number) { return path.join(VIEW_DIR, `${id}-${yaw}.jpg`) }
function cut(id: number): Promise<void> {
  if (VIEWS.every((v) => fs.existsSync(viewFile(id, v.yaw)))) return Promise.resolve()
  if (!cutting.has(id)) {
    const st = db.prepare('SELECT s.ft, c.path, c.width, c.height FROM stations s JOIN chapters c ON c.id = s.chapter_id WHERE s.id = ?').get(id) as { ft: number; path: string; width: number; height: number } | undefined
    const job = (async () => {
      if (!st || !fs.existsSync(st.path)) throw new Error('the clip is not on this machine any more')
      // Same views the model was shown (look.ts), written next to their final names and moved in when complete.
      const graph = eacGraph(eacLayout(st.width, st.height), VIEWS.length) + VIEWS.map((v, i) => flatView(i, v.name, { ...VIEW, yaw: v.yaw })).join(';')
      await runDetached('ffmpeg', ['-v', 'error', '-y', '-ss', st.ft.toFixed(2), '-i', st.path, '-filter_complex', graph,
        ...VIEWS.flatMap((v) => ['-map', `[${v.name}]`, '-frames:v', '1', '-q:v', '4', `${viewFile(id, v.yaw)}.part.jpg`])])
      for (const v of VIEWS) fs.renameSync(`${viewFile(id, v.yaw)}.part.jpg`, viewFile(id, v.yaw))
    })().finally(() => cutting.delete(id))
    cutting.set(id, job)
  }
  return cutting.get(id)!
}

function send(res: http.ServerResponse, status: number, body: unknown, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' })
  res.end(type === 'application/json' ? JSON.stringify(body) : (body as string | Buffer))
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let body = ''
  for await (const chunk of req) { body += chunk; if (body.length > 10_000) throw new Error('too big') }
  const j = JSON.parse(body) as unknown
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('not an object')
  return j as Record<string, unknown>
}
const whole = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null)

const server = http.createServer(async (req, res) => {
  try {
    if (!hostAllowed(req.headers.host, PORT)) return send(res, 403, { error: 'this server only answers localhost' })
    const r = route(req.method ?? 'GET', new URL(req.url ?? '/', 'http://localhost').pathname)
    if (req.method === 'POST' && (!originAllowed(req.headers.origin, PORT) || req.headers['content-type'] !== 'application/json')) return send(res, 403, { error: 'only from this page' })
    switch (r.kind) {
      case 'page': {
        const page = PAGE.replace('__KINDS__', JSON.stringify(KINDS))
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
          'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'" })
        return res.end(page)
      }
      case 'spots': return send(res, 200, { model: MODEL, spots: spots(), tracks: tracks() })
      case 'score': return send(res, 200, score())
      case 'spot': { const s = spot(r.id); return s ? send(res, 200, s) : send(res, 404, { error: 'no such spot' }) }
      case 'view': {
        try { await cut(r.id) } catch (e) { return send(res, 404, { error: (e as Error).message.split('\n')[0] }) }
        return send(res, 200, fs.readFileSync(viewFile(r.id, r.yaw)), 'image/jpeg')
      }
      case 'review': {
        const b = await readJson(req)
        const id = whole(b.itemId)
        const verdict = b.verdict === 'right' || b.verdict === 'wrong' ? b.verdict : b.verdict === null ? null : undefined
        if (id === null || verdict === undefined) return send(res, 400, { error: 'itemId and verdict (right, wrong or null)' })
        return saveReview(db, id, verdict) ? send(res, 200, score()) : send(res, 404, { error: 'no such item' })
      }
      case 'missed': {
        const b = await readJson(req)
        const remove = whole(b.remove)
        if (remove !== null) { saveMissed(db, { remove }); return send(res, 200, { score: score() }) }
        const lookId = whole(b.lookId)
        const x = typeof b.x === 'number' && b.x >= 0 && b.x <= 1 ? b.x : null
        const kind = (KINDS as readonly string[]).includes(b.kind as string) ? (b.kind as string) : null
        if (lookId === null || x === null || kind === null) return send(res, 400, { error: 'lookId, a kind from the list and x 0–1' })
        const id = saveMissed(db, { lookId, kind, x })
        return id === null ? send(res, 404, { error: 'no such view' }) : send(res, 200, { id, score: score() })
      }
      default: return send(res, 404, { error: 'not found' })
    }
  } catch (e) {
    if (!res.headersSent) send(res, 400, { error: (e as Error).message })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  const n = spots().length
  console.log(`River Explorer: http://localhost:${PORT}  (${n} spots looked at by ${MODEL}; store ${STORE})`)
  if (!n) console.log('nothing to explore yet: run pnpm --filter web course:look first')
})
process.on('SIGINT', () => { server.close(); db.close(); process.exit(0) })
