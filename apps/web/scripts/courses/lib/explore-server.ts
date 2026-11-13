// course:explore's server: the store's spots, looks and verdicts as a small
// local API, and the page. Tested against a temp store in explore-server.test.ts.
import crypto from 'crypto'
import fs from 'fs'
import http from 'http'
import path from 'path'
import type { DatabaseSync } from 'node:sqlite'
import { fmtDay } from '@paddlesnitch/core/format'
import { saveArea, saveMissed, saveReview } from './footage-db'
import { areaName, ASSUMED_YAW, fetchSiteAllowed, hostAllowed, isJson, layoutPins, originAllowed, otherPasses, route, scoreOf, stripOrder, type Verdict } from './explore'
import { KINDS, placeItem, PROMPT_VERSION, VIEWS, type Distance } from './look'
import { AREA_LEVELS, inArea, LANDMARK_VERSION, LANDMARK_VIEW, LANDMARK_VIEWS, type Area } from './landmarks'
import { PAGE } from './explore-page'

export type SpotRow = { id: number; chapterId: number; lat: number; lng: number; heading: number; ft: number; level: number; clip: string; cameraYaw: number | null; startUtc: string | null; things: number; checked: number; ok: number }

export type ExplorerOptions = {
  model: string
  viewDir: string
  /** Cut a spot's views into viewDir (explore.ts uses ffmpeg): the general look's four, or a careful look's eight. */
  cut: (spot: { id: number; ft: number; path: string; width: number; height: number }, careful: boolean) => Promise<void>
  log?: (line: string) => void
}

const page = PAGE.replace('__KINDS__', JSON.stringify(KINDS))
// The page's one script, allowed by its hash: no other script can run on it.
const scriptHash = crypto.createHash('sha256').update(/<script>([\s\S]*)<\/script>/.exec(page)![1]).digest('base64')
const CSP = `default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; img-src 'self' https://server.arcgisonline.com; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`

export const viewFile = (dir: string, id: number, yaw: number, careful = false) => path.join(dir, `${id}-${careful ? 'l' : ''}${yaw}.jpg`)

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

  type AreaRow = Area & { id: number; name: string }
  const areaRows = () => db.prepare('SELECT id, name, south, west, north, east FROM areas ORDER BY id').all() as AreaRow[]

  /** Spots a careful look would visit (every pass), and what it has done there. Same filter as course:look --status --areas. */
  const carefulSpots = () => db.prepare(`SELECT s.lat, s.lng,
        (SELECT count(*) FROM looks l WHERE l.station_id = s.id AND l.model = ? AND l.prompt_version = ?) AS looked,
        (SELECT count(*) FROM landmarks m JOIN looks l ON l.id = m.look_id WHERE l.station_id = s.id AND l.model = ? AND l.prompt_version = ?) AS found
      FROM stations s JOIN chapters c ON c.id = s.chapter_id WHERE c.status = 'ok' AND s.level < ?`)
      .all(model, LANDMARK_VERSION, model, LANDMARK_VERSION, AREA_LEVELS) as Array<{ lat: number; lng: number; looked: number; found: number }>

  /** How long a careful look takes a spot with this model, measured once there are some; 5 min until then. */
  const minutesASpot = () => {
    const r = db.prepare('SELECT avg(ms) AS ms, count(*) AS n FROM looks WHERE model = ? AND prompt_version = ?').get(model, LANDMARK_VERSION) as { ms: number | null; n: number }
    return r.ms && r.n >= LANDMARK_VIEWS.length ? +(r.ms * LANDMARK_VIEWS.length / 60_000).toFixed(1) : 5
  }

  /** Each area with how far the careful look has got in it. */
  function areas() {
    const st = carefulSpots()
    return areaRows().map((a) => {
      const inside = st.filter((s) => inArea(s, a))
      return { ...a, spots: inside.length, looked: inside.filter((s) => s.looked >= LANDMARK_VIEWS.length).length, found: inside.reduce((n, s) => n + s.found, 0) }
    })
  }

  /** What the careful look found in one area, each placed on the map; sure ones first. */
  function area(id: number) {
    const a = areaRows().find((x) => x.id === id)
    if (!a) return null
    const rows = db.prepare(`SELECT m.id, m.name, m.kind, m.detail, m.x0, m.y0, m.x1, m.y1, m.distance, m.sure,
        l.view_yaw AS viewYaw, s.id AS stationId, s.lat, s.lng, s.heading, s.ft, c.path AS clip, c.start_utc AS startUtc, c.camera_yaw AS cameraYaw
      FROM landmarks m JOIN looks l ON l.id = m.look_id JOIN stations s ON s.id = l.station_id JOIN chapters c ON c.id = s.chapter_id
      WHERE l.model = ? AND l.prompt_version = ? AND c.status = 'ok' AND s.level < ? AND s.lat BETWEEN ? AND ? AND s.lng BETWEEN ? AND ?
      ORDER BY m.sure DESC, c.start_utc, s.ft, l.view_yaw`).all(model, LANDMARK_VERSION, AREA_LEVELS, a.south, a.north, a.west, a.east) as Array<Record<string, number | string | null>>
    const things = rows.map((r) => {
      const at = placeItem({ lat: r.lat as number, lng: r.lng as number, heading: r.heading as number }, r.viewYaw as number, (r.cameraYaw as number | null) ?? ASSUMED_YAW,
        { x: ((r.x0 as number) + (r.x1 as number)) / 2, distance: r.distance as Distance }, LANDMARK_VIEW.hFov)
      return {
        id: r.id, name: r.name, kind: r.kind, detail: r.detail, distance: r.distance, sure: !!r.sure,
        box: { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 }, stationId: r.stationId, viewYaw: r.viewYaw,
        clip: path.basename(r.clip as string), day: r.startUtc ? fmtDay(r.startUtc as string) : null, ft: r.ft,
        lat: +at.lat.toFixed(6), lng: +at.lng.toFixed(6),
      }
    })
    return { ...areas().find((x) => x.id === id)!, things }
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
  const cutting = new Map<string, Promise<void>>()
  const queue: Array<() => void> = []
  let running = 0
  const slot = () => new Promise<void>((go) => { if (running < 2) { running++; go() } else queue.push(go) })
  const free = () => { const next = queue.pop(); if (next) next(); else running-- }
  function cut(id: number, careful: boolean): Promise<void> {
    if ((careful ? LANDMARK_VIEWS : VIEWS).every((v) => fs.existsSync(viewFile(viewDir, id, v.yaw, careful)))) return Promise.resolve()
    const key = `${careful ? 'l' : ''}${id}`
    if (!cutting.has(key)) {
      const st = db.prepare('SELECT s.id, s.ft, c.path, c.width, c.height FROM stations s JOIN chapters c ON c.id = s.chapter_id WHERE s.id = ?').get(id) as { id: number; ft: number; path: string; width: number; height: number } | undefined
      cutting.set(key, (async () => {
        if (!st || !fs.existsSync(st.path)) throw new Error('missing')
        await slot()
        try { await opts.cut(st, careful) } finally { free() }
      })().finally(() => cutting.delete(key)))
    }
    return cutting.get(key)!
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
          try { await cut(r.id, r.careful) } catch (e) {
            if ((e as Error).message !== 'missing') log(`couldn't cut spot ${r.id}: ${(e as Error).message.split('\n')[0]}`)
            return send(res, 404, { error: "Couldn't cut this picture." })
          }
          // Not kept by the browser: deleting views/ is then enough to remove the pictures.
          res.writeHead(200, { ...HEADERS, 'content-type': 'image/jpeg' })
          return res.end(fs.readFileSync(viewFile(viewDir, r.id, r.yaw, r.careful)))
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
        case 'areas': return send(res, 200, { areas: areas(), minutesASpot: minutesASpot() })
        case 'areaSpots': {
          // How many spots a rectangle being drawn holds, before it's saved.
          const [south, west, north, east] = ['s', 'w', 'n', 'e'].map((k) => Number(url.searchParams.get(k)))
          if (![south, west, north, east].every(Number.isFinite)) return send(res, 400, { error: 'The page sent something unexpected. Reload the page.' })
          return send(res, 200, { spots: carefulSpots().filter((p) => inArea(p, { south, west, north, east })).length })
        }
        case 'area': { const a = area(r.id); return a ? send(res, 200, a) : send(res, 404, { error: 'That area has been removed. Reload the page.' }) }
        case 'saveArea': {
          // { name, south, west, north, east } or { remove }.
          const b = await readJson(req)
          if (!b) return send(res, 400, { error: 'The page sent something unexpected. Reload the page.' })
          const remove = whole(b.remove)
          if (remove !== null) { saveArea(db, { remove }); return send(res, 200, { areas: areas() }) }
          const [south, west, north, east] = [b.south, b.west, b.north, b.east].map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null))
          if (south === null || west === null || north === null || east === null || south < -90 || north > 90 || west < -180 || east > 180 || north <= south || east <= west) {
            return send(res, 400, { error: 'The page sent something unexpected. Reload the page.' })
          }
          const name = areaName(b.name)
          if (name === null) return send(res, 400, { error: 'Give the area a name of up to 60 characters.' })
          const id = saveArea(db, { name, south, west, north, east })
          return send(res, 200, { id, areas: areas() })
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
