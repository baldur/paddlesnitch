#!/usr/bin/env node
// Score the game against the footage, with the model, so the owner need not do it
// by hand. For each reference view it sends the footage frame and the game shot,
// drawn from the same eye and heading, to the model (only through the night gate)
// and asks how recognisable the game's place is, 1-5. The scores and the
// agreement with the owner's are written under $NIGHT_WORK/views (never into the
// repo: the frames are the owner's footage). See docs/night-shift/jobs/views.md.
//
//   pnpm --filter web course:view-score <label> [--only all|even|odd] [--limit N]
//
// The prompt lives here so a change to it is a diff lead can review; the pure
// parts (parsing the answer, the agreement maths) are in lib/ with tests.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { agreement } from './lib/agreement'
import { parseScoreAnswer } from './lib/score-parse'

const BASE = process.env.NIGHT_OLLAMA ?? 'http://127.0.0.1:11435'
const MODEL = process.env.NIGHT_MODEL ?? 'qwen3.8-64k:latest'
const DIR = path.join(os.homedir(), '.paddlesnitch', 'refviews')
const OUT = path.join(process.env.NIGHT_WORK ?? process.cwd(), 'views')

// The rubric, the way the owner scores on the compare page, with the one thing
// that matters for a low-poly game: the simplification itself is not a penalty.
const PROMPT = [
  'You compare two images of the same place on the River Thames at Reading.',
  'The first image is a photograph taken from a camera on a boat in the real river.',
  'The second image is a 3D rendering of the same place, from the same viewpoint and heading, from a video game.',
  'Rate how recognisable the game place is, 1 to 5:',
  '  1 - nothing alike; it looks like a different place.',
  '  2 - only the broad idea matches; you could not tell where it is.',
  '  3 - you can roughly tell where along the river it is.',
  '  4 - very similar; you would recognise it with little doubt.',
  '  5 - it could be the real place; you would know it at once.',
  'Judge the place itself: the bend and width of the river, the banks, the buildings, boats and bridges you can see, and any landmark named in the second image.',
  'The game is deliberately low-poly: trees are simple shapes, the water is flat or gently rippled, and buildings are simplified blocks.',
  'That simplification is expected and must not, by itself, lower the score. Score only what makes one place identifiable from another.',
  'Do not reward or punish caution; give the number the two images justify.',
  'Reply with one JSON object and nothing else: { "score": <a whole number 1 to 5>, "differences": [ "<two to four visible differences between the two images, or why the place still reads>" ] }.',
].join('\n')

type View = { id: string; name: string; frame: string }
type ModelScores = Record<string, Record<string, { score: number; differences: string[] }>>

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}

async function ask(frame64: string, game64: string): Promise<string> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      options: { temperature: 0 },
      messages: [{ role: 'user', content: PROMPT, images: [frame64, game64] }],
    }),
  })
  if (!res.ok) throw new Error(`chat ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { message?: { content?: string } }
  return data.message?.content ?? ''
}

function selectIds(views: View[], only: string | undefined, limit: number | undefined, idsCsv: string | undefined): string[] {
  let ids = views.map((v) => v.id)
  if (idsCsv) ids = idsCsv.split(',').map((s) => s.trim()).filter(Boolean)
  if (only === 'even') ids = views.filter((_, i) => i % 2 === 0).map((v) => v.id)
  if (only === 'odd') ids = views.filter((_, i) => i % 2 === 1).map((v) => v.id)
  if (limit !== undefined) ids = ids.slice(0, limit)
  return ids
}

async function main() {
  const args = process.argv.slice(2)
  const label = args.find((a) => !a.startsWith('--')) ?? ''
  if (!/^[\w.-]{1,40}$/.test(label)) throw new Error('usage: course:view-score <label> [--only all|even|odd] [--limit N] [--ids a,b] [--fresh]')
  const only = arg('only') ?? 'all'
  const limit = arg('limit') ? Number(arg('limit')) : undefined
  const fresh = process.argv.includes('--fresh')
  const views = JSON.parse(fs.readFileSync(path.join(DIR, 'views.json'), 'utf8')) as View[]
  const ownerRaw = JSON.parse(fs.readFileSync(path.join(DIR, 'scores.json'), 'utf8'))
  const owner: Record<string, number> = ownerRaw[label] ?? {}
  const ids = selectIds(views, only, limit, arg('ids'))
  fs.mkdirSync(OUT, { recursive: true })

  const all = fs.existsSync(path.join(OUT, 'model-scores.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'model-scores.json'), 'utf8')) as ModelScores : {}
  if (fresh) delete all[label]
  all[label] = all[label] ?? {}

  let done = 0
  let failed = 0
  for (const id of ids) {
    const view = views.find((v) => v.id === id)
    if (!view) continue
    const frame = path.join(DIR, view.frame)
    const shot = path.join(DIR, 'game', label, `${id}.png`)
    if (!fs.existsSync(frame) || !fs.existsSync(shot)) {
      console.log(`${id}: no frame or game shot, skipped`)
      failed++
      continue
    }
    const frame64 = fs.readFileSync(frame).toString('base64')
    const game64 = fs.readFileSync(shot).toString('base64')
    try {
      const parsed = parseScoreAnswer(await ask(frame64, game64))
      all[label][id] = { score: parsed.score, differences: parsed.differences }
      done++
      process.stdout.write(`${id}: ${parsed.score}\n`)
    } catch (e) {
      failed++
      console.log(`${id}: ${(e as Error).message.slice(0, 120)}`)
    }
  }
  fs.writeFileSync(path.join(OUT, 'model-scores.json'), JSON.stringify(all, null, 1))

  // Agreement with the owner, over every view the owner scored, even/odd by the
  // index in views.json (the job tunes on even, measures on odd = held out).
  const modelMap: Record<string, number> = {}
  for (const [id, v] of Object.entries(all[label] ?? {})) modelMap[id] = v.score
  const report = agreement(modelMap, owner, views.map((v) => v.id))
  fs.writeFileSync(path.join(OUT, `agreement-${label}.json`), JSON.stringify({ label, model: MODEL, at: new Date().toISOString(), ...report }, null, 1))
  console.log(`\n${label}: scored ${done}, skipped/failed ${failed}, ${report.n}/${report.of} with an owner score`)
  const numbers = {
    'views-mae': report.mae,
    'views-mae-even': report.maeEven,
    'views-mae-held-out': report.maeHeldOut,
    spearman: report.spearman,
    'spearman-held-out': report.spearmanHeldOut,
    even: report.even,
    odd: report.odd,
  }
  console.log(JSON.stringify(numbers, null, 1))
}

main().catch((e: Error) => {
  console.error(`stopped: ${e.message}`)
  process.exit(1)
})
