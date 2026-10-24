#!/usr/bin/env node
// Step 3: a 360 frame every `--step` metres along the course, from every pass of
// every recording, with flat views to look at.
//
//   pnpm --filter web course:frames <course-id> [--step 50]
//
// Needs course:ingest (the recordings' tracks) and course:river (the line). Writes
//   .cache/courses/<id>/frames/<rec>-p<pass>-<s>.jpg        the full 360 (equirectangular)
//   .cache/courses/<id>/frames/<rec>-p<pass>-<s>-<view>.jpg  ahead, left, right, behind
//   .cache/courses/<id>/frames.json                         what each frame is
//   .cache/courses/<id>/sheet-<view>.html                   contact sheets by distance
// Views are relative to the boat: on a pass going down the course (dir -1)
// "ahead" looks back towards the start. Existing frames are kept; delete the
// folder after changing cameraYaw.
// See docs/features/game-courses-from-video.md.
import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { promisify } from 'util'
import { cumulative, locate, projection, type LatLng, type XZ } from './lib/river'
import { passes, stations } from './lib/passes'

const run = promisify(execFile)
const id = process.argv[2]
const stepArg = process.argv.indexOf('--step')
const STEP = stepArg > 0 ? Number(process.argv[stepArg + 1]) : 50
if (!id) throw new Error('usage: course:frames <course-id> [--step 50]')
const OUT = path.join(process.cwd(), '.cache/courses', id)
const FRAMES = path.join(OUT, 'frames')
fs.mkdirSync(FRAMES, { recursive: true })
const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts/courses/data', id, 'course.json'), 'utf8')) as {
  recordings: string[]
  // Which way each recording's camera lens faced, in degrees from the bow (180: on
  // the back deck looking back). Telemetry can't tell; the frames can (see README).
  cameraYaw?: Record<string, number>
}
const river = JSON.parse(fs.readFileSync(path.join(OUT, 'river.json'), 'utf8')) as { origin: LatLng; samples: Array<{ x: number; z: number }> }
const line: XZ[] = river.samples.map((p) => [p.x, p.z])
const cum = cumulative(line)
const { toXZ } = projection(river.origin)

// The GoPro MAX stores its 360 as two streams of three equi-angular cube faces
// (left/front/right, then down/back/up), each 1344 px plus 32 px of overlap on
// the outer faces. Laid out 3x2 that's YouTube's EAC, which v360 reads directly.
const FACES = '[0:0]crop=1344:1344:0:0[l];[0:0]crop=1344:1344:1376:0[f];[0:0]crop=1344:1344:2752:0[r];'
  + '[0:4]crop=1344:1344:0:0[d];[0:4]crop=1344:1344:1376:0[b];[0:4]crop=1344:1344:2752:0[u];'
  + '[l][f][r]hstack=3[top];[d][b][u]hstack=3[bot];[top][bot]vstack,split=5[e0][e1][e2][e3][e4];'
// Every output is turned so the bow is straight ahead: the 360's centre, and the
// views at their angle from the bow.
const VIEWS = { ahead: 0, left: -90, right: 90, behind: 180 } as const
const wrap = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180 // v360 takes -180..180
const equirect = (cam: number) => `[e0]v360=eac:e:yaw=${wrap(cam)}:w=2048:h=1024[eq];`
const flat = (name: string, i: number, yaw: number) => `[e${i}]v360=eac:flat:yaw=${wrap(yaw)}:pitch=5:h_fov=90:v_fov=56:w=800:h=500[${name}]`

type Fix = { t: number; lat: number; lng: number; file: string; ft: number }
type Frame = { s: number; recording: string; cameraYaw: number; pass: number; dir: 1 | -1; t: number; lat: number; lng: number; video: string; ft: number; name: string }
const frames: Frame[] = []
for (const rec of config.recordings) {
  const { sources, track } = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.cache/courses', rec, 'track.json'), 'utf8')) as { sources: Array<{ file: string }>; track: Fix[] }
  const placedFixes = track.filter((_, i) => i % 5 === 0)
    .map((f) => ({ f, at: locate(line, cum, toXZ([f.lat, f.lng])) }))
    .filter((p) => p.at.d < 80)
  const placed = placedFixes.map((p) => ({ t: p.f.t, s: p.at.s }))
  passes(placed).forEach((pass, k) => {
    for (const st of stations(placed, pass, STEP)) {
      const f = placedFixes[st.i].f
      const video = sources.find((v) => path.basename(v.file) === f.file)!.file
      frames.push({ s: st.s, recording: rec, cameraYaw: config.cameraYaw?.[rec] ?? 0, pass: k, dir: pass.dir, t: f.t, lat: f.lat, lng: f.lng, video, ft: f.ft, name: `${rec}-p${k}-${String(st.s).padStart(5, '0')}` })
    }
    console.log(`${rec} pass ${k}: ${placed[pass.from].s.toFixed(0)} → ${placed[pass.to].s.toFixed(0)} m`)
  })
}

async function extract(fr: Frame) {
  if (fs.existsSync(path.join(FRAMES, `${fr.name}-behind.jpg`))) return
  const graph = FACES + equirect(fr.cameraYaw) + Object.entries(VIEWS).map(([v, yaw], i) => flat(v, i + 1, fr.cameraYaw + yaw)).join(';')
  await run('ffmpeg', ['-v', 'error', '-y', '-ss', fr.ft.toFixed(2), '-i', fr.video, '-filter_complex', graph,
    '-map', '[eq]', '-frames:v', '1', '-q:v', '3', path.join(FRAMES, `${fr.name}.jpg`),
    ...Object.keys(VIEWS).flatMap((v) => ['-map', `[${v}]`, '-frames:v', '1', '-q:v', '4', path.join(FRAMES, `${fr.name}-${v}.jpg`)])])
}

async function main() {
let done = 0
const queue = [...frames]
await Promise.all(Array.from({ length: 6 }, async () => {
  for (let fr = queue.shift(); fr; fr = queue.shift()) {
    await extract(fr)
    if (++done % 25 === 0) console.log(`${done}/${frames.length} frames`)
  }
}))
fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify(frames, null, 1))

// Contact sheets: one row per distance, one column per pass.
const passKeys = [...new Set(frames.map((f) => `${f.recording}-p${f.pass}`))]
for (const view of Object.keys(VIEWS)) {
  const rows = [...new Set(frames.map((f) => f.s))].sort((a, b) => a - b).map((s) =>
    `<tr><th>${(s / 1000).toFixed(2)} km</th>${passKeys.map((k) => {
      const f = frames.find((x) => `${x.recording}-p${x.pass}` === k && x.s === s)
      return `<td>${f ? `<img src="frames/${f.name}-${view}.jpg" loading="lazy">` : ''}</td>`
    }).join('')}</tr>`)
  const head = passKeys.map((k) => {
    const f = frames.find((x) => `${x.recording}-p${x.pass}` === k)!
    return `<th>${k} ${f.dir > 0 ? 'up the course' : 'down the course'}</th>`
  }).join('')
  fs.writeFileSync(path.join(OUT, `sheet-${view}.html`), `<!doctype html><meta charset="utf-8"><title>${id} ${view}</title>
<style>body{font:12px system-ui;margin:0}img{width:260px;display:block}th{position:sticky;top:0;background:#fff;padding:4px}td{padding:1px}</style>
<table><tr><th></th>${head}</tr>${rows.join('')}</table>`)
}
console.log(`${frames.length} frames in ${path.relative(process.cwd(), FRAMES)}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
