#!/usr/bin/env node
// What the Reading river's plain buildings are made of, from the owner's footage.
//
//   pnpm --filter web course:materials [--within 80] [--views 2] [--model qwen2.5vl:32b]
//   pnpm --filter web course:materials --write    only write the game's file from what's been asked
//
// For each plain building (not a landmark, which is modelled from the footage)
// within --within metres of the water, nearest first: up to --views passes that
// face it from 8–70 m, a view cut toward it, and a local vision model asked its
// wall and roof colour and material. Answers are kept in
// ~/.paddlesnitch/materials/ (answers.json, and the views it was shown), so a run
// can stop and go on; the pictures never leave this machine. Then the answers
// are combined per building into games/reading-thames/materials.js (attributes
// only). About 36 s a look with qwen2.5vl:32b: a long run, fine overnight.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { openStore } from './lib/footage-db'
import { cutView, loadClips, passesAt } from './lib/footage-passes'
import { aimAt, combine, materialsModule, parseAnswer, PROMPT, PROMPT_VERSION, SCHEMA, type Answer } from './lib/materials'
import { assertLocalModel, chat, checkOllama, ollamaEndpoint } from './lib/ollama'
import { projection, type XZ } from './lib/river'
import { courseFromFile, locate, widthAt } from '../../../../games/reading-thames/course.js'

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined }
const WITHIN = Number(arg('within') ?? 80)
const VIEWS = Number(arg('views') ?? 2)
const MODEL = arg('model') ?? 'qwen2.5vl:32b'
const DIR = path.join(os.homedir(), '.paddlesnitch', 'materials')
const ANSWERS = path.join(DIR, 'answers.json')
const GAMES = path.join(process.cwd(), '../../games/reading-thames')
// Modelled from the footage already (world.js LANDMARKS).
const LANDMARKS = new Set(['island-bar', 'victorian', 'tudor-boathouse', 'rowing-club', 'canoe-club', 'spiral-boathouse', 'grey-boathouse', 'riverside-villa', 'glass-house', 'boatyard'])

type Saved = { building: string; clip: string; ft: number; raw: string; answer: Answer | null; version?: number }

const data = JSON.parse(fs.readFileSync(path.join(GAMES, 'courses/reading.json'), 'utf8'))
const river = courseFromFile(data).scenery.river
const { toLatLng, toXZ } = projection([51.46175, -0.96945])
const keyOf = ([x, z]: XZ) => `${x.toFixed(1)},${z.toFixed(1)}`
const targets = (data.buildings as Array<{ shape: XZ[]; style?: string }>).filter((b) => !LANDMARKS.has(b.style ?? '')).map((b) => {
  const ring = b.shape[0][0] === b.shape.at(-1)![0] && b.shape[0][1] === b.shape.at(-1)![1] ? b.shape.slice(0, -1) : b.shape
  const c: XZ = [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length]
  const at = locate(river, ...c)
  return { ring, c, key: keyOf(c), d: Math.abs(at.lateral) - widthAt(river, at.s).half }
}).filter((t) => t.d < WITHIN).sort((a, b) => a.d - b.d)

// Answers to an older prompt are kept in the file but asked again.
const all: Saved[] = fs.existsSync(ANSWERS) ? JSON.parse(fs.readFileSync(ANSWERS, 'utf8')) : []
const saved = all.filter((s) => s.version === PROMPT_VERSION)
const older = all.filter((s) => s.version !== PROMPT_VERSION)

function write() {
  const rows = targets.flatMap((t) => {
    const m = combine(saved.filter((s) => s.building === t.key && s.answer).map((s) => s.answer!))
    return m ? [[+t.c[0].toFixed(1), +t.c[1].toFixed(1), m.wallColour, m.wall, m.roofColour, m.roof] as [number, number, string, Answer['wall'], string | null, Answer['roof']]] : []
  })
  fs.writeFileSync(path.join(GAMES, 'materials.js'), materialsModule(rows))
  console.log(`materials.js: ${rows.length} of ${targets.length} buildings`)
}

async function run() {
  if (process.argv.includes('--write')) return write()
  assertLocalModel(MODEL)
  const endpoint = ollamaEndpoint(process.env.PADDLESNITCH_OLLAMA, false)
  await checkOllama(endpoint, MODEL)
  fs.mkdirSync(path.join(DIR, 'views'), { recursive: true })
  const clips = loadClips(openStore())
  let asked = 0
  const started = Date.now()
  for (const t of targets) {
    const done = saved.filter((s) => s.building === t.key)
    if (done.length >= VIEWS) continue
    const [lat, lng] = toLatLng(t.c)
    // Passes that face it from far enough to see it whole, moving, in daylight, a known camera first; one per recording.
    const passes = passesAt(clips, { lat, lng }, 70)
      .filter((p) => p.cameraYaw !== null && p.heading !== null && p.hour >= 6 && p.hour < 21 && fs.existsSync(p.c.path))
      .map((p) => ({ p, aim: aimAt(toXZ([p.lat, p.lng]), p.heading!, t.ring) }))
      .filter((x) => x.aim && !done.some((s) => s.clip === path.basename(x.p.c.path) && Math.abs(s.ft - x.p.ft) < 1))
      .sort((a, b) => Number(b.p.cameraKnown) - Number(a.p.cameraKnown) || a.aim!.metres - b.aim!.metres)
    const used = new Set(done.map((s) => s.clip))
    for (const { p, aim } of passes) {
      if (saved.filter((s) => s.building === t.key).length >= VIEWS) break
      if (used.has(path.basename(p.c.path))) continue
      used.add(path.basename(p.c.path))
      const file = path.join(DIR, 'views', `${t.key.replace(',', '_')}-${path.basename(p.c.path)}-${p.ft.toFixed(1)}.jpg`)
      try { await cutView(p.c, p.ft, p.cameraYaw!, aim!.fromBow, file, aim!.hFov, 896, 672) } catch (e) { console.log(`${t.key}: couldn't cut ${path.basename(p.c.path)} at ${p.ft.toFixed(1)} s: ${(e as Error).message.split('\n')[0]}`); continue }
      const image = fs.readFileSync(file).toString('base64')
      let raw = ''
      let answer: Answer | null = null
      for (let attempt = 0; attempt < 2 && !answer; attempt++) {
        raw = await chat(endpoint, { model: MODEL, format: SCHEMA, keep_alive: '30m', options: { temperature: 0, num_predict: 200 }, messages: [{ role: 'user', content: PROMPT, images: [image] }] })
        answer = parseAnswer(raw)
      }
      saved.push({ building: t.key, clip: path.basename(p.c.path), ft: +p.ft.toFixed(1), raw, answer, version: PROMPT_VERSION })
      fs.writeFileSync(ANSWERS, JSON.stringify([...older, ...saved]))
      asked++
      const each = (Date.now() - started) / 1000 / asked
      console.log(`${t.key} (${t.d.toFixed(0)} m from the water, ${aim!.metres.toFixed(0)} m off): ${answer ? (answer.visible ? `${answer.wall} ${answer.wallColour}, roof ${answer.roof ?? '?'} ${answer.roofColour ?? ''}` : 'not visible') : 'no answer'}  [${asked} asked, ${each.toFixed(0)} s each]`)
    }
  }
  write()
}

run().catch((e: Error) => { console.error(`stopped: ${e.message}`); process.exit(1) })
