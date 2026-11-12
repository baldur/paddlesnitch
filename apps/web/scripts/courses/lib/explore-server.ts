// course:explore's server: the store's spots, looks and verdicts as a small
// local API, and the page. Tested against a temp store in explore-server.test.ts.
import crypto from 'crypto'
import fs from 'fs'
import http from 'http'
import path from 'path'
import type { DatabaseSync } from 'node:sqlite'
import { fmtDay } from '@paddlesnitch/core/format'
import { saveMissed, saveReview } from './footage-db'
import { fetchSiteAllowed, hostAllowed, isJson, layoutPins, originAllowed, otherPasses, route, scoreOf, stripOrder, type Verdict } from './explore'
import { KINDS, PROMPT_VERSION, VIEWS, type Distance } from './look'
import { PAGE } from './explore-page'

export type SpotRow = { id: number; chapterId: number; lat: number; lng: number; heading: number; ft: number; level: number; clip: string; cameraYaw: number | null; startUtc: string | null; things: number; checked: number; ok: number }

export type ExplorerOptions = {
  model: string
  viewDir: string
  /** Cut the four views of a spot into viewDir (explore.ts uses ffmpeg). */
  cut: (spot: { id: number; ft: number; path: string; width: number; height: number }) => Promise<void>
  log?: (line: string) => void
}

const page = PAGE.replace('__KINDS__', JSON.stringify(KINDS))
// The page's one script, allowed by its hash: no other script can run on it.
const scriptHash = crypto.createHash('sha256').update(/<script>([\s\S]*)<\/script>/.exec(page)![1]).digest('base64')
const CSP = `default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`

export const viewFile = (dir: string, id: number, yaw: number) => path.join(dir, `${id}-${yaw}.jpg`)

export function createExplorer(db: DatabaseSync, opts: ExplorerOptions): http.Server {
  const { model, viewDir } = opts
  const log = opts.log ?? ((l: string) => console.log(l))

  const spots = (): SpotRow[] => (db.prepare(`
    SELECT s.id, s.chapter_id AS chapterId, s.lat, s.lng, s.heading, s.ft, s.level, c.path AS clip, c.camera_yaw AS cameraYaw, c.start_utc AS startUtc,
      count(i.id) AS things, count(r.item_id) AS checked, max(l.ok) AS ok
    FROM stations s JOIN chapters c ON c.id = s.chapter_id JOIN looks l ON l.station_id = s.id AND l.model = ? AND l.prompt_version = ?
    LEFT JOIN items i ON i.look_id = l.id LEFT JOIN reviews r ON r.item_id = i.id
    GROUP BY s.id ORDER BY c.start_utc, c.path, s.ft`).all(model, PROMPT_VERSION) as SpotRow[])
    .map((s) => ({ ...s, clip: path.basename(s.clip) }))

  /** The tracks, thinned to a point every ~10 s, so the map shows the river between spots. */
  const tracks = (): number[][][] => (db.prepare("SELECT track FROM chapters WHERE status != 'no-gps' AND track IS NOT NULL").all() as Array<{ track: string }>)
    .map((r) => {
      let last = -Infinity
      return (JSON.parse(r.track) as number[][]).filter(([ft]) => (ft - last >= 10 ? ((last = ft), true) : false)).map(([, lat, lng]) => [+lat.toFixed(5), +lng.toFixed(5)])
    })

  function spot(id: number, viewPx: number) {
    const all = spots()
    const at = all.find((s) => s.id === id)
    if (!at) return null
    const looks = db.prepare('SELECT id, view_yaw AS viewYaw, ok, scene, water, light FROM looks WHERE station_id = ? AND model = ? AND prompt_version = ?')
      .all(id, model, PROMPT_VERSION) as Array<{ id: number; viewYaw: number; ok: number; scene: string | null; water: string | null; light: string | null }>
    const views = stripOrder(at.cameraYaw).map((v) => {
      const l = looks.find((x) => x.viewYaw === v.viewYaw)
      const items = l ? (db.prepare('SELECT i.id, i.kind, i.detail, i.x, i.distance, i.count, r.verdict FROM items i LEFT JOIN reviews r ON r.item_id = i.id WHERE i.look_id = ? ORDER BY i.id')
        .all(l.id) as Array<{ id: number; kind: string; detail: string; x: number; distance: Distance; count: number; verdict: Verdict | null }>) : []
      const missed = l ? db.prepare('SELECT id, kind, x, coalesce(y, 0.86) AS y FROM missed WHERE look_id = ?').all(l.id) : []
      return {
        ...v, lookId: l?.id ?? null, ok: !!l?.ok, scene: l?.scene ?? null, water: l?.water ?? null, light: l?.light ?? null, missed,
        pins: layoutPins(items.map((i) => ({ ...i, label: i.kind + (i.count > 1 ? ` ×${i.count}` : '') })), viewPx),
      }
    })
    const sameClip = all.filter((s) => s.chapterId === at.chapterId)
    const i = sameClip.findIndex((s) => s.id === id)
    return {
      ...at, views, prev: sameClip[i - 1]?.id ?? null, next: sameClip[i + 1]?.id ?? null,
      others: otherPasses(all, at).map((o) => ({ id: o.id, clip: o.clip, day: o.startUtc ? fmtDay(o.startUtc) : null, metres: Math.round(o.metres) })),
    }
  }

  const score = () => {
    const reviews = db.prepare(`SELECT i.kind, r.verdict FROM reviews r JOIN items i ON i.id = r.item_id JOIN looks l ON l.id = i.look_id
      WHERE l.model = ? AND l.prompt_version = ?`).all(model, PROMPT_VERSION) as Array<{ kind: string; verdict: Verdict }>
    const missed = (db.prepare('SELECT count(*) AS n FROM missed m JOIN looks l ON l.id = m.look_id WHERE l.model = ? AND l.prompt_version = ?').get(model, PROMPT_VERSION) as { n: number }).n
    return scoreOf(reviews, missed)
  }

  // Cutting a 360 frame is heavy: at most two at once, and one job per spot however
  // many views are asked for. The newest request goes first, so the spot the owner
  // stops on isn't stuck behind ones skipped past.
  const cutting = new Map<number, Promise<void>>()
  const queue: Array<() => void> = []
  let running = 0
  const slot = () => new Promise<void>((go) => { if (running < 2) { running++; go() } else queue.push(go) })
  const free = () => { const next = queue.pop(); if (next) next(); else running-- }
  function cut(id: number): Promise<void> {
    if (VIEWS.every((v) => fs.existsSync(viewFile(viewDir, id, v.yaw)))) return Promise.resolve()
    if (!cutting.has(id)) {
      const st = db.prepare('SELECT s.id, s.ft, c.path, c.width, c.height FROM stations s JOIN chapters c ON c.id = s.chapter_id WHERE s.id = ?').get(id) as { id: number; ft: number; path: string; width: number; height: number } | undefined
      cutting.set(id, (async () => {
        if (!st || !fs.existsSync(st.path)) throw new Error('missing')
        await slot()
        try { await opts.cut(st) } finally { free() }
      })().finally(() => cutting.delete(id)))
    }
    return cutting.get(id)!
  }

  const HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin' }
  function send(res: http.ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { ...HEADERS, 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown> | null> {
    let body = ''
    for await (const chunk of req) { body += chunk; if (body.length > 10_000) return null }
    try {
      const j = JSON.parse(body) as unknown
      return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : null
    } catch { return null }
  }
  const whole = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null)
  const share = (v: unknown) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : null)

  const server = http.createServer(async (req, res) => {
    const port = (server.address() as { port: number }).port
    try {
      if (!hostAllowed(req.headers.host, port)) return send(res, 403, { error: 'This server only answers localhost.' })
      const url = new URL(req.url ?? '/', 'http://localhost')
      const r = route(req.method ?? 'GET', url.pathname)
      if (!fetchSiteAllowed(req.headers['sec-fetch-site'] as string | undefined, r.kind === 'page')) return send(res, 403, { error: 'Only from this page.' })
      if (req.method === 'POST' && (!originAllowed(req.headers.origin, port) || !isJson(req.headers['content-type']))) return send(res, 403, { error: 'Only from this page.' })
      switch (r.kind) {
        case 'page':
          res.writeHead(200, { ...HEADERS, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP })
          return res.end(page)
        case 'spots': return send(res, 200, { model, spots: spots(), tracks: tracks() })
        case 'score': return send(res, 200, score())
        case 'spot': {
          // How wide the page shows a picture, so the pins are laid out for it.
          const w = Number(url.searchParams.get('w'))
          const s = spot(r.id, Number.isFinite(w) && w >= 150 && w <= 2000 ? w : 520)
          return s ? send(res, 200, s) : send(res, 404, { error: 'No such spot.' }) }
        case 'view': {
          try { await cut(r.id) } catch (e) {
            if ((e as Error).message !== 'missing') log(`couldn't cut spot ${r.id}: ${(e as Error).message.split('\n')[0]}`)
            return send(res, 404, { error: "Couldn't cut this picture." })
          }
          // Not kept by the browser: deleting views/ is then enough to remove the pictures.
          res.writeHead(200, { ...HEADERS, 'content-type': 'image/jpeg' })
          return res.end(fs.readFileSync(viewFile(viewDir, r.id, r.yaw)))
        }
        case 'review': {
          // { itemId, verdict } or { itemIds: [...], verdict } for "mark the rest right".
          const b = await readJson(req)
          const ids = b && (Array.isArray(b.itemIds) ? b.itemIds.slice(0, 100).map(whole) : [whole(b.itemId)])
          const verdict = b?.verdict === 'right' || b?.verdict === 'wrong' ? b.verdict : b?.verdict === null ? null : undefined
          if (!ids?.length || ids.includes(null) || verdict === undefined) return send(res, 400, { error: 'The page sent something unexpected. Reload the page.' })
          const saved = (ids as number[]).filter((id) => saveReview(db, id, verdict))
          return saved.length ? send(res, 200, { saved, score: score() }) : send(res, 404, { error: 'The model has looked here again since. Reload the page.' })
        }
        case 'missed': {
          const b = await readJson(req)
          if (!b) return send(res, 400, { error: 'The page sent something unexpected. Reload the page.' })
          const remove = whole(b.remove)
          if (remove !== null) { saveMissed(db, { remove }); return send(res, 200, { score: score() }) }
          const lookId = whole(b.lookId)
          const x = share(b.x)
          const y = share(b.y)
          const kind = (KINDS as readonly string[]).includes(b.kind as string) ? (b.kind as string) : null
          if (lookId === null || x === null || y === null || kind === null) return send(res, 400, { error: 'The page sent something unexpected. Reload the page.' })
          const id = saveMissed(db, { lookId, kind, x, y })
          return id === null ? send(res, 404, { error: 'The model has looked here again since. Reload the page.' }) : send(res, 200, { id, score: score() })
        }
        default: return send(res, 404, { error: 'Not found.' })
      }
    } catch (e) {
      log(`request failed: ${(e as Error).message}`)
      if (!res.headersSent) send(res, 500, { error: 'Something went wrong; see the terminal.' })
    }
  })
  return server
}
