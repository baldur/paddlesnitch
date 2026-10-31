#!/usr/bin/env node
// Step 6: does it look like the place? The game's view next to the real frame,
// every `--step` metres along the course.
//
//   pnpm --filter web course:compare <course-id> [--step 250]
//
// Serves games/ itself, plays the course in Chrome (#debug), puts the boat at
// each spot, and writes .cache/courses/<id>/compare.html: the game on the left,
// the camera on the right, both looking up the course. The real view comes from
// a pass going the other way, looking back over the stern, so there's no
// paddler in it; failing that, the forward view. Needs Chrome, or
// `pnpm --filter web e2e:install`.
// See docs/features/game-courses-from-video.md.
import { chromium } from '@playwright/test'
import fs from 'fs'
import http from 'http'
import path from 'path'

const id = process.argv[2]
const stepArg = process.argv.indexOf('--step')
const STEP = stepArg > 0 ? Number(process.argv[stepArg + 1]) : 250
if (!id) throw new Error('usage: course:compare <course-id> [--step 250]')
const OUT = path.join(process.cwd(), '.cache/courses', id)
const SHOTS = path.join(OUT, 'compare')
fs.mkdirSync(SHOTS, { recursive: true })
const GAMES = path.resolve(process.cwd(), '../../games')
const frames = JSON.parse(fs.readFileSync(path.join(OUT, 'frames.json'), 'utf8')) as Array<{ s: number; dir: 1 | -1; name: string }>
const course = JSON.parse(fs.readFileSync(path.join(GAMES, 'reading-thames/courses', `${id}.json`), 'utf8')) as { start: number; finish: number }

// What the game exposes on window.kayak with #debug (games/reading-thames/main.js).
type Sample = { x: number; z: number; s: number; tx: number; tz: number }
type Kayak = { gpu?: unknown; state: string; course: { samples: Sample[] }; boat: Record<string, number>; race: { player: { loc: unknown }; start: { line: number } } }

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }
const server = http.createServer((req, res) => {
  const file = path.join(GAMES, decodeURIComponent(new URL(req.url!, 'http://x').pathname).replace(/\/$/, '/index.html'))
  if (!file.startsWith(GAMES) || !fs.existsSync(file)) return void res.writeHead(404).end()
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file))
})

async function main() {
  await new Promise<void>((done) => server.listen(0, done))
  const port = (server.address() as { port: number }).port
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch())
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } })
  await page.goto(`http://localhost:${port}/reading-thames/#debug`)
  await page.waitForFunction(() => (window as unknown as { kayak?: Kayak }).kayak?.gpu, null, { timeout: 30000 })
  await page.click(`#menu button[value="${id}"]`)
  // The horn comes once you sit still on the line: put the boat there.
  await page.evaluate(() => {
    const k = (window as unknown as { kayak: Kayak }).kayak
    const i = Math.round((k.race.start.line - 4) / 2)
    const [a, n] = [k.course.samples[i], k.course.samples[i + 1]]
    Object.assign(k.boat, { x: a.x, z: a.z, heading: Math.atan2(n.x - a.x, -(n.z - a.z)), speed: 0, roll: 0, rollRate: 0 })
  })
  await page.waitForFunction(() => (window as unknown as { kayak: Kayak }).kayak.state === 'racing', null, { timeout: 60000 })
  await page.addStyleTag({ content: '#hud { display: none !important }' })

  const rows: string[] = []
  for (let s = Math.ceil(course.start / STEP) * STEP; s <= course.finish; s += STEP) {
    const near = (dir: number) => frames.filter((f) => f.dir === dir).sort((a, b) => Math.abs(a.s - s) - Math.abs(b.s - s))[0]
    const back = near(-1)
    const real = back && Math.abs(back.s - s) <= STEP / 2 ? `${back.name}-behind.jpg` : near(1) ? `${near(1).name}-ahead.jpg` : null
    await page.evaluate((s) => {
      const k = (window as unknown as { kayak: Kayak }).kayak
      const c = k.course
      const i = Math.min(c.samples.length - 2, Math.round(s / 2))
      const [a, n] = [c.samples[i], c.samples[i + 1]]
      Object.assign(k.boat, { x: a.x, z: a.z, heading: Math.atan2(n.x - a.x, -(n.z - a.z)), speed: 3, swim: 0, roll: 0, rollRate: 0, yawRate: 0 })
      k.race.player.loc = { i, s: a.s, lateral: 0, tx: a.tx, tz: a.tz, x: a.x, z: a.z }
    }, s)
    await page.waitForTimeout(200)
    await page.screenshot({ path: path.join(SHOTS, `${s}.png`) })
    rows.push(`<tr><th>${(s / 1000).toFixed(2)} km</th><td><img src="compare/${s}.png"></td><td>${real ? `<img src="frames/${real}"><br><small>${real}</small>` : 'no frame'}</td></tr>`)
  }
  await browser.close()
  server.close()
  fs.writeFileSync(path.join(OUT, 'compare.html'), `<!doctype html><meta charset="utf-8"><title>${id}: game and camera</title>
<style>body{font:13px system-ui;margin:8px}img{width:480px;display:block}th{text-align:left;vertical-align:top;padding-right:8px}td{padding:2px}</style>
<table><tr><th></th><th>Game</th><th>Camera</th></tr>${rows.join('')}</table>`)
  console.log(`${rows.length} spots → ${path.relative(process.cwd(), path.join(OUT, 'compare.html'))}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
