// course:explore's server against a real store in a temp folder, over real HTTP.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'
import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import type { DatabaseSync } from 'node:sqlite'
import { createExplorer, viewFile } from './explore-server'
import { ensureStations, nextStation, openStore, saveClip, saveLook } from './footage-db'
import { PROMPT_VERSION, VIEWS } from './look'
import { destination } from './stations'

const ORIGIN = { lat: 51.4676, lng: -0.9822 }
const TRACK = Array.from({ length: 501 }, (_, k) => ({ ft: k, ...destination(ORIGIN, 90, 2 * k), speed: 2 }))
const MODEL = 'm'

let dir: string
let db: DatabaseSync
let server: http.Server
let port: number
let cuts: number[]
let video: string

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explore-test-'))
  db = openStore(dir)
  video = path.join(dir, 'GS010101.360')
  fs.writeFileSync(video, 'x')
  cuts = []
  const viewDir = path.join(dir, 'views')
  fs.mkdirSync(viewDir)
  server = createExplorer(db, {
    model: MODEL, viewDir, log: () => {},
    cut: async (st) => {
      cuts.push(st.id)
      await new Promise((r) => setTimeout(r, 20))
      for (const v of VIEWS) fs.writeFileSync(viewFile(viewDir, st.id, v.yaw), 'jpeg')
    },
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  port = (server.address() as { port: number }).port
})
afterEach(async () => {
  await new Promise((r) => server.close(r))
  db.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

/** A spot looked at with two things in one view; returns its id and the items' ids. */
function lookedAt(version = PROMPT_VERSION) {
  const { id } = saveClip(db, { path: video, size: 1, mtime: 1, recording: '0101', chapter: '01', duration: 500, width: 3008, height: 960, track: TRACK, startUtc: '2026-11-08T09:00:00.000Z' }, null)
  ensureStations(db, id, 100, 1)
  const st = nextStation(db, MODEL, version, 1, 4)!
  const two = [{ kind: 'bridge', detail: 'stone', x: 0.5, distance: 'mid', count: 1 }, { kind: 'swan', detail: 'white', x: 0.2, distance: 'near', count: 2 }]
  saveLook(db, st.id, 0, MODEL, version, { ok: true, raw: '{}', ms: 1, items: two })
  const items = (db.prepare('SELECT i.id FROM items i JOIN looks l ON l.id = i.look_id WHERE l.station_id = ? AND l.prompt_version = ? ORDER BY i.id').all(st.id, version) as Array<{ id: number }>).map((r) => r.id)
  const lookId = (db.prepare('SELECT id FROM looks WHERE station_id = ? AND prompt_version = ?').get(st.id, version) as { id: number }).id
  return { spotId: st.id, items, lookId }
}

type Res = { status: number; headers: http.IncomingHttpHeaders; body: string; json: () => any } // eslint-disable-line @typescript-eslint/no-explicit-any
function request(method: string, p: string, opts: { body?: unknown; headers?: Record<string, string> } = {}): Promise<Res> {
  const own = { host: `localhost:${port}`, 'sec-fetch-site': 'same-origin', ...(method === 'POST' ? { origin: `http://localhost:${port}`, 'content-type': 'application/json' } : {}) }
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { ...own, ...opts.headers } }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body, json: () => JSON.parse(body) }))
    })
    req.on('error', reject)
    if (opts.body !== undefined) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body))
    req.end()
  })
}
const post = (p: string, body: unknown, headers: Record<string, string> = {}) => request('POST', p, { body, headers })

describe('who it answers', () => {
  it('refuses a request addressed to another name (a rebinding page)', async () => {
    expect((await request('GET', '/api/spots', { headers: { host: `evil.example:${port}` } })).status).toBe(403)
  })
  it("refuses another site's page, so an <img> there can't set ffmpeg cutting", async () => {
    const { spotId } = lookedAt()
    const r = await request('GET', `/view/${spotId}/0.jpg`, { headers: { 'sec-fetch-site': 'cross-site' } })
    expect(r.status).toBe(403)
    expect(cuts).toEqual([])
  })
  it('takes changes only from its own page, as JSON', async () => {
    const { items } = lookedAt()
    const body = { itemId: items[0], verdict: 'right' }
    expect((await post('/api/review', body, { origin: 'https://evil.example' })).status).toBe(403)
    expect((await request('POST', '/api/review', { body, headers: { origin: '' } })).status).toBe(403)
    expect((await post('/api/review', body, { 'content-type': 'text/plain' })).status).toBe(403)
    expect((await post('/api/review', body, { 'content-type': 'application/json; charset=utf-8' })).status).toBe(200)
  })
  it('opens the page from the address bar, but gives data only to the page', async () => {
    expect((await request('GET', '/', { headers: { 'sec-fetch-site': 'none' } })).status).toBe(200)
    expect((await request('GET', '/api/spots', { headers: { 'sec-fetch-site': 'none' } })).status).toBe(403)
  })
  it('lays the pins out for the width the page shows pictures at', async () => {
    const { spotId } = lookedAt()
    const at = async (w: number) => (await request('GET', `/api/spot/${spotId}?w=${w}`)).json().views.find((v: { viewYaw: number }) => v.viewYaw === 0).pins[0].w
    expect(await at(300)).toBeGreaterThan(await at(600))
  })
  it('sends the page with a policy that runs only its own script', async () => {
    const r = await request('GET', '/')
    const script = /<script>([\s\S]*)<\/script>/.exec(r.body)![1]
    const hash = crypto.createHash('sha256').update(script).digest('base64')
    expect(r.headers['content-security-policy']).toContain(`'sha256-${hash}'`)
    expect(/script-src [^;]*unsafe-inline/.test(String(r.headers["content-security-policy"]))).toBe(false)
    expect(r.headers['cross-origin-resource-policy']).toBe('same-origin')
  })
})

describe('marking', () => {
  it('a verdict needs a whole-number item and right, wrong or null', async () => {
    const { items } = lookedAt()
    expect((await post('/api/review', { itemId: items[0] })).status).toBe(400)
    expect((await post('/api/review', { itemId: String(items[0]), verdict: 'right' })).status).toBe(400)
    expect((await post('/api/review', { itemId: items[0], verdict: 'maybe' })).status).toBe(400)
    expect((await post('/api/review', 'not json')).status).toBe(400)
    expect((await post('/api/review', { itemId: 99999, verdict: 'right' })).status).toBe(404)
  })
  it('the score counts right and made up, overall and by kind', async () => {
    const { items } = lookedAt()
    await post('/api/review', { itemId: items[0], verdict: 'right' })
    const r = (await post('/api/review', { itemId: items[1], verdict: 'wrong' })).json()
    expect(r.score).toMatchObject({ checked: 2, right: 1, wrong: 1, rate: 0.5 })
    expect(r.score.byKind.map((k: { kind: string }) => k.kind).sort()).toEqual(['bridge', 'swan'])
  })
  it('marks the rest right in one request', async () => {
    const { items } = lookedAt()
    const r = (await post('/api/review', { itemIds: items, verdict: 'right' })).json()
    expect(r.saved).toEqual(items)
    expect(r.score.right).toBe(2)
  })
  it("doesn't count verdicts on another prompt version's answers", async () => {
    const old = lookedAt(PROMPT_VERSION - 1)
    db.prepare("INSERT INTO reviews (item_id, verdict, at) VALUES (?, 'wrong', '')").run(old.items[0])
    expect((await request('GET', '/api/score')).json()).toMatchObject({ checked: 0, rate: null })
  })
  it('a missed thing needs a known view, a kind from the list and x and y on the picture; it can be removed', async () => {
    const { lookId } = lookedAt()
    expect((await post('/api/missed', { lookId, kind: 'swan', x: 1.2, y: 0.5 })).status).toBe(400)
    expect((await post('/api/missed', { lookId, kind: 'dragon', x: 0.5, y: 0.5 })).status).toBe(400)
    expect((await post('/api/missed', { lookId: 99999, kind: 'swan', x: 0.5, y: 0.5 })).status).toBe(404)
    const added = (await post('/api/missed', { lookId, kind: 'swan', x: 0.5, y: 0.5 })).json()
    expect(added.score.missed).toBe(1)
    expect((await post('/api/missed', { remove: added.id })).json().score.missed).toBe(0)
  })
})

describe('spots and pictures', () => {
  it('lists spots looked at with how many things each has and how many are marked', async () => {
    const { spotId, items } = lookedAt()
    await post('/api/review', { itemId: items[0], verdict: 'right' })
    const { spots } = (await request('GET', '/api/spots')).json()
    expect(spots).toHaveLength(1)
    expect(spots[0]).toMatchObject({ id: spotId, clip: 'GS010101.360', things: 2, checked: 1 })
  })
  it('a spot has its four views, bow in the middle, with the pins laid out', async () => {
    const { spotId } = lookedAt()
    const s = (await request('GET', `/api/spot/${spotId}`)).json()
    expect(s.views.map((v: { name: string }) => v.name)).toEqual(['left', 'ahead', 'right', 'behind'])
    const pins = s.views.find((v: { viewYaw: number }) => v.viewYaw === 0).pins
    expect(pins.map((p: { label: string }) => p.label)).toEqual(['bridge', 'swan ×2'])
    expect((await request('GET', '/api/spot/99999')).status).toBe(404)
  })
  it("cuts a spot once however many of its views are asked for at once, and the browser doesn't keep them", async () => {
    const { spotId } = lookedAt()
    const rs = await Promise.all(VIEWS.map((v) => request('GET', `/view/${spotId}/${v.yaw}.jpg`)))
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200])
    expect(cuts).toEqual([spotId])
    expect(rs[0].headers['cache-control']).toBe('no-store')
  })
  it('cuts at most two spots at once, newest first, and a failed cut frees its place', async () => {
    lookedAt()
    const ids = (db.prepare('SELECT id FROM stations ORDER BY id LIMIT 5').all() as Array<{ id: number }>).map((r) => r.id)
    let now = 0, most = 0
    const order: number[] = []
    const viewDir = path.join(dir, 'views2')
    fs.mkdirSync(viewDir)
    const busy = createExplorer(db, {
      model: MODEL, viewDir, log: () => {},
      cut: async (st) => {
        order.push(st.id); most = Math.max(most, ++now)
        await new Promise((r) => setTimeout(r, 30))
        now--
        if (st.id === ids[0]) throw new Error('ffmpeg exited 1: /secret/path.360: Invalid data')
        for (const v of VIEWS) fs.writeFileSync(viewFile(viewDir, st.id, v.yaw), 'jpeg')
      },
    })
    await new Promise<void>((r) => busy.listen(0, '127.0.0.1', r))
    const p2 = (busy.address() as { port: number }).port
    const get = (id: number) => new Promise<number>((resolve) => {
      http.get({ host: '127.0.0.1', port: p2, path: `/view/${id}/0.jpg`, headers: { host: `localhost:${p2}`, 'sec-fetch-site': 'same-origin' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode!)) })
    })
    try {
      const results: Promise<number>[] = []
      for (const id of ids) { results.push(get(id)); await new Promise((r) => setTimeout(r, 2)) }
      expect(await Promise.all(results)).toEqual([404, 200, 200, 200, 200])
      expect(most).toBe(2)
      expect(order.slice(2)).toEqual([ids[4], ids[3], ids[2]])
    } finally { await new Promise((r) => busy.close(r)) }
  })

  it("says so without a path when the clip isn't on this machine", async () => {
    const { spotId } = lookedAt()
    fs.rmSync(video)
    const r = await request('GET', `/view/${spotId}/0.jpg`)
    expect(r.status).toBe(404)
    expect(r.body).not.toContain(dir)
    expect(cuts).toEqual([])
  })
})
