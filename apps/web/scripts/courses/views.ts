#!/usr/bin/env node
// Reference views: the measure for how recognisable the Reading game's river is.
// A fixed set of places along the river (every 200 m, and in front of each
// landmark), each a frame of the owner's footage beside the game drawn from the
// same eye and heading, scored 1–5 by the owner.
//
//   pnpm --filter web course:views pick [--again]   choose the places and cut their frames (once)
//   pnpm --filter web course:views shoot <label>    draw the game from each (after every change)
//   pnpm --filter web course:views serve [--port 3202]   the page to compare and score: http://localhost:3202
//
// Everything is kept in ~/.paddlesnitch/refviews/ (views.json, frames/,
// game/<label>/, scores.json) and stays on this machine: the frames are the
// owner's footage and show other people. Never commit or publish them. The
// footage store is course:look's (lib/footage-db.ts).
import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import { execSync } from 'child_process'
import { HERE_DIRS, type HereDir } from './lib/here'
import { cutView, loadClips, passesAt } from './lib/footage-passes'
import { openStore } from './lib/footage-db'
import { projection, type XZ } from './lib/river'
import { average, choosePass, cleanScores, gameCamera, pickPoints, viewFacing, type Scores } from './lib/views'
import { courseFromFile, locate, pointAt } from '../../../../games/reading-thames/course.js'

const DIR = path.join(os.homedir(), '.paddlesnitch', 'refviews')
const GAMES = path.join(process.cwd(), '../../games')
const VIEWS = path.join(DIR, 'views.json')
const SCORES = path.join(DIR, 'scores.json')
const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined }
const [cmd, label] = process.argv.slice(2)
const ORIGIN: [number, number] = [51.46175, -0.96945]
const { toLatLng, toXZ } = projection(ORIGIN)

// The landmarks the owner pointed out, and the bridges.
const LANDMARK_STYLES = ['island-bar', 'victorian', 'tudor-boathouse', 'rowing-club', 'canoe-club', 'spiral-boathouse', 'grey-boathouse', 'riverside-villa', 'glass-house', 'boatyard']
const STYLE_NAMES: Record<string, string> = { 'island-bar': 'Island Bar', victorian: 'Victorian house', 'tudor-boathouse': 'Tudor boathouse', 'rowing-club': 'Reading Rowing Club', 'canoe-club': 'Reading Canoe Club', 'spiral-boathouse': 'Spiral-stair boathouse', 'grey-boathouse': 'Grey boathouse', 'riverside-villa': 'Riverside villa', 'glass-house': 'Glass house', boatyard: 'Boatyard' }

type View = { id: string; name: string; frame: string; at: XZ; heading: number; view: HereDir; eye: [number, number, number]; look: [number, number, number]; clip: string; ft: number; day: string; metres: number; cameraAssumed: boolean }

function pick() {
  if (fs.existsSync(VIEWS) && !process.argv.includes('--again')) throw new Error(`${VIEWS} is the fixed set: pass --again to choose afresh (scores for the old set no longer match)`)
  const data = JSON.parse(fs.readFileSync(path.join(GAMES, 'reading-thames/courses/reading.json'), 'utf8'))
  const river = courseFromFile(data).scenery.river
  const centre = (shape: XZ[]): XZ => [shape.reduce((a, p) => a + p[0], 0) / shape.length, shape.reduce((a, p) => a + p[1], 0) / shape.length]
  const landmarks = [
    ...data.buildings.filter((b: { style?: string }) => LANDMARK_STYLES.includes(b.style ?? '')).map((b: { style: string; shape: XZ[] }) => ({ name: STYLE_NAMES[b.style], at: centre(b.shape) })),
    ...data.bridges.filter((b: { name?: string; ends?: [XZ, XZ] }) => b.name && b.ends).map((b: { name: string; ends: [XZ, XZ] }) => ({ name: b.name, at: centre(b.ends) })),
  ].map((l) => ({ ...l, s: locate(river, ...l.at).s }))
  const points = pickPoints(river.length, (s) => { const p = pointAt(river, s); return [p.x, p.z] }, landmarks)

  const clips = loadClips(openStore())
  fs.mkdirSync(path.join(DIR, 'frames'), { recursive: true })
  const views: View[] = []
  return (async () => {
    for (const pt of points) {
      const [lat, lng] = toLatLng(pt.at)
      let chosen = null
      for (const r of [30, 60]) {
        chosen = choosePass(passesAt(clips, { lat, lng }, r))
        if (chosen) break
      }
      if (!chosen || !fs.existsSync(chosen.c.path)) { console.log(`${pt.id}: no pass in daylight with the camera's direction known or assumed`); continue }
      const at = toXZ([chosen.lat, chosen.lng])
      const view = viewFacing(chosen.heading!, at, pt.target)
      const frame = `frames/${pt.id}.jpg`
      await cutView(chosen.c, chosen.ft, chosen.cameraYaw!, HERE_DIRS.find((d) => d.name === view)!.fromBow, path.join(DIR, frame))
      const day = chosen.c.startUtc ? new Date(Date.parse(chosen.c.startUtc) + chosen.ft * 1000).toISOString().slice(0, 16) : ''
      views.push({ id: pt.id, name: pt.name, frame, at: [+at[0].toFixed(1), +at[1].toFixed(1)], heading: Math.round(chosen.heading!), view, ...gameCamera(at, chosen.heading!, view), clip: path.basename(chosen.c.path), ft: +chosen.ft.toFixed(1), day, metres: Math.round(chosen.metres), cameraAssumed: !chosen.cameraKnown })
      console.log(`${pt.id}: ${view} from ${path.basename(chosen.c.path)} at ${chosen.ft.toFixed(1)} s, ${Math.round(chosen.metres)} m off${chosen.cameraKnown ? '' : ', camera assumed'}`)
    }
    fs.writeFileSync(VIEWS, JSON.stringify(views, null, 1))
    console.log(`${views.length} views of ${points.length} places in ${VIEWS}`)
  })()
}

async function shoot(name: string) {
  if (!/^[\w.-]{1,40}$/.test(name ?? '')) throw new Error('usage: course:views shoot <label> (letters, digits, . - _)')
  const views = JSON.parse(fs.readFileSync(VIEWS, 'utf8')) as View[]
  const out = path.join(DIR, 'game', name)
  fs.mkdirSync(out, { recursive: true })
  const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm' }
  const server = http.createServer((req, res) => {
    const p = path.normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
    const file = path.join(GAMES, p.endsWith('/') ? `${p}index.html` : p)
    if (!file.startsWith(GAMES) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end()
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file))
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  const { webkit } = await import('@playwright/test')
  const browser = await webkit.launch()
  const page = await browser.newPage({ viewport: { width: 1536, height: 960 } })
  await page.route('**/api/**', (r) => r.fulfill({ status: 404, body: '' }))
  // A broken page (a shader that doesn't compile) still draws something: stop rather than score it.
  const broken: string[] = []
  page.on('pageerror', (e) => broken.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) broken.push(m.text()) })
  await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/reading-thames/?webgl#debug`)
  await page.waitForFunction(() => (window as unknown as { kayak?: { course?: { scenery?: unknown } } }).kayak?.course?.scenery, null, { timeout: 120_000 })
  // Drawing at all: a shader that doesn't compile leaves no renderer (and drew 44 views of the menu's backdrop).
  if (!(await page.evaluate(() => (window as unknown as { kayak: { gpu?: unknown } }).kayak.gpu))) broken.push('no renderer started (a shader error?)')
  // Only the scene: the walk's cards and labels hidden.
  await page.addStyleTag({ content: '* { visibility: hidden !important } canvas { visibility: visible !important }' })
  for (const v of views) {
    if (broken.length) throw new Error(`the game broke, so the views stop here: ${broken[0]}`)
    await page.evaluate((shot) => (window as unknown as { kayak: { shoot: (s: unknown) => void } }).kayak.shoot(shot), { eye: v.eye, look: v.look, wide: 90 })
    await page.waitForTimeout(1500)
    if (broken.length) throw new Error(`the game broke, so the views stop here: ${broken[0]}`)
    await page.locator('canvas').screenshot({ path: path.join(out, `${v.id}.png`) })
    process.stdout.write('.')
  }
  await browser.close()
  server.close()
  let sha = ''
  try { sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim() } catch { /* not a checkout */ }
  fs.writeFileSync(path.join(out, 'about.json'), JSON.stringify({ label: name, commit: sha, at: new Date().toISOString() }))
  console.log(`\n${views.length} views drawn in ${out}`)
}

function serve() {
  const PORT = Number(arg('port') ?? 3202)
  const views = JSON.parse(fs.readFileSync(VIEWS, 'utf8')) as View[]
  const ids = views.map((v) => v.id)
  const readScores = (): Scores => { try { return cleanScores(JSON.parse(fs.readFileSync(SCORES, 'utf8')), ids) } catch { return {} } }
  const labels = () => (fs.existsSync(path.join(DIR, 'game')) ? fs.readdirSync(path.join(DIR, 'game')) : [])
    .filter((l) => fs.existsSync(path.join(DIR, 'game', l, 'about.json')))
    .map((l) => ({ label: l, ...JSON.parse(fs.readFileSync(path.join(DIR, 'game', l, 'about.json'), 'utf8')) }))
    .sort((a, b) => a.at.localeCompare(b.at))
  const send = (res: http.ServerResponse, status: number, type: string, body: string | Buffer) => res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }).end(body)
  const server = http.createServer(async (req, res) => {
    // This machine only; a POST only from this page.
    if (!/^(localhost|127\.0\.0\.1):\d+$/.test(req.headers.host ?? '')) return send(res, 403, 'text/plain', 'localhost only')
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (req.method === 'POST' && url.pathname === '/scores') {
      if (!(req.headers.origin ?? '').match(/^http:\/\/(localhost|127\.0\.0\.1):\d+$/)) return send(res, 403, 'text/plain', 'only from this page')
      let body = ''
      for await (const chunk of req) { body += chunk; if (body.length > 1000) return send(res, 400, 'text/plain', 'too long') }
      const b = JSON.parse(body || '{}') as { label?: string; id?: string; score?: number | null }
      const scores = readScores()
      if (!labels().some((l) => l.label === b.label) || !ids.includes(b.id ?? '')) return send(res, 400, 'text/plain', 'unknown view')
      scores[b.label!] ??= {}
      if (b.score === null) delete scores[b.label!][b.id!]
      else if (Number.isInteger(b.score) && b.score! >= 1 && b.score! <= 5) scores[b.label!][b.id!] = b.score!
      else return send(res, 400, 'text/plain', 'a score is 1 to 5')
      fs.writeFileSync(SCORES, JSON.stringify(scores, null, 1))
      return send(res, 200, 'application/json', JSON.stringify({ ...average(scores, b.label!) }))
    }
    if (url.pathname === '/data') return send(res, 200, 'application/json', JSON.stringify({ views, labels: labels(), scores: readScores() }))
    const img = url.pathname.match(/^\/(frames\/[\w-]+\.jpg|game\/[\w.-]+\/[\w-]+\.png)$/)
    if (img && fs.existsSync(path.join(DIR, img[1]))) return send(res, 200, img[1].endsWith('.jpg') ? 'image/jpeg' : 'image/png', fs.readFileSync(path.join(DIR, img[1])))
    if (url.pathname === '/') return send(res, 200, 'text/html; charset=utf-8', PAGE)
    send(res, 404, 'text/plain', 'not found')
  })
  server.listen(PORT, '127.0.0.1', () => console.log(`Reference views: http://localhost:${PORT}`))
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reference views</title><style>
body{margin:0;background:#0b1220;color:#e2e8f0;font:15px/1.4 system-ui,sans-serif}
header{position:sticky;top:0;background:#0f172a;padding:10px 16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap;border-bottom:1px solid #334155;z-index:1}
h1{font-size:17px;margin:0}select{font:inherit;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:6px}
.mean{color:#38bdf8;font-variant-numeric:tabular-nums}
section{padding:12px 16px;border-bottom:1px solid #1e293b}
.pics{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:8px}
figure{margin:0}img{width:100%;display:block;background:#000}figcaption{color:#94a3b8;font-size:13px;margin-top:4px}
.score{display:flex;gap:6px;align-items:center;margin-top:8px}
.score button{min-width:44px;min-height:44px;font:inherit;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:6px;cursor:pointer}
.score button[aria-pressed=true]{background:#0369a1;border-color:#38bdf8;color:#fff}
.hint{color:#94a3b8;font-size:13px}
</style></head><body>
<header><h1>Reference views</h1>
<label>Game <select id="label"></select></label><label>Compare with <select id="other"><option value="">None</option></select></label>
<span class="mean" id="mean"></span><span class="hint">1: nothing like it · 3: you can tell where it is · 5: could be the footage</span></header>
<main id="list"></main>
<script>
let data, label, other;
const $ = (s) => document.querySelector(s);
async function load() {
  data = await (await fetch('/data')).json();
  const opts = data.labels.map((l) => '<option value="' + l.label + '">' + l.label + (l.commit ? ' (' + l.commit + ')' : '') + '</option>').join('');
  $('#label').innerHTML = opts; $('#other').innerHTML = '<option value="">None</option>' + opts;
  label = data.labels.at(-1)?.label ?? ''; $('#label').value = label;
  draw();
}
function mean() {
  const v = Object.values(data.scores[label] ?? {});
  $('#mean').textContent = v.length ? 'Average ' + (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) + ' over ' + v.length + ' of ' + data.views.length : 'Not scored yet';
}
function draw() {
  const list = $('#list'); list.textContent = '';
  for (const v of data.views) {
    const s = document.createElement('section');
    const h = document.createElement('h2'); h.style.fontSize = '15px'; h.style.margin = '0 0 6px'; h.textContent = v.name.replace(/ km up$/, ' km up the river') + ', looking ' + (v.view === 'ahead' ? 'ahead' : v.view === 'behind' ? 'behind' : 'to the ' + v.view); s.append(h);
    const pics = document.createElement('div'); pics.className = 'pics';
    const fig = (src, cap) => { const f = document.createElement('figure'); const i = new Image(); i.loading = 'lazy'; i.src = src; i.alt = cap + ': ' + v.name; const c = document.createElement('figcaption'); c.textContent = cap; f.append(i, c); return f; };
    pics.append(fig('/frames/' + v.id + '.jpg', 'Footage, ' + v.day.replace('T', ' ')));
    if (label) pics.append(fig('/game/' + label + '/' + v.id + '.png', 'Game: ' + label));
    if (other) pics.append(fig('/game/' + other + '/' + v.id + '.png', 'Game: ' + other));
    s.append(pics);
    if (label) {
      const row = document.createElement('div'); row.className = 'score'; row.setAttribute('role', 'group'); row.setAttribute('aria-label', 'Score for ' + v.name);
      const now = data.scores[label]?.[v.id];
      for (let n = 1; n <= 5; n++) {
        const b = document.createElement('button'); b.textContent = n; b.setAttribute('aria-pressed', String(now === n));
        b.onclick = async () => {
          const score = now === n ? null : n;
          const r = await fetch('/scores', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label, id: v.id, score }) });
          if (!r.ok) { alertBox("Couldn't save the score. Please try again."); return; }
          data.scores[label] ??= {}; if (score === null) delete data.scores[label][v.id]; else data.scores[label][v.id] = score;
          draw();
        };
        row.append(b);
      }
      s.append(row);
    }
    list.append(s);
  }
  mean();
}
function alertBox(t) { $('#mean').textContent = t; }
$('#label').onchange = (e) => { label = e.target.value; draw(); };
$('#other').onchange = (e) => { other = e.target.value; draw(); };
load();
</script></body></html>`

const run = cmd === 'pick' ? pick : cmd === 'shoot' ? () => shoot(label) : cmd === 'serve' ? async () => serve() : null
if (!run) { console.error('usage: course:views pick [--again] | shoot <label> | serve [--port 3202]'); process.exit(1) }
run!().catch((e: Error) => { console.error(`stopped: ${e.message}`); process.exit(1) })
