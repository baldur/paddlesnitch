// Side-by-side test of the written paddle summary (docs/features/personable-insights.md).
// Runs real paddles through each candidate (model + prompt), checks every note
// with summaryProblems (voice.ts), and writes a blind ranking page.
//
//   AWS_PROFILE=paddlesnitch npx tsx scripts/insight-bench.ts \
//     --data <folder with <paddleId>/session.json and profile.json> --user <user id> \
//     --out <folder> [--n 20] [--only live,qwen,qwen-local]
//
// The data is a copy of ONE account's own analysis/<userId>/ folder (the owner
// benchmarks on their own paddles). Nothing is written back anywhere: the copy
// goes into a temporary local store, and the results into --out.
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { execFileSync } from 'child_process'
import os from 'os'
import path from 'path'

const arg = (name: string, dflt?: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : dflt
}
const DATA = arg('data'), OUT = arg('out'), USER = arg('user') ?? ''
if (!DATA || !USER || !OUT) { console.error('usage: --data <dir> --user <id> --out <dir> [--n 20] [--only a,b]'); process.exit(1) }
const N = Number(arg('n', '20'))
// The results hold the account's diary notes and profile: never inside the repo
// (one `git add -A` from a public repository). And the id must be an id.
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const outAbs = path.resolve(OUT!)
if (outAbs === repoRoot || outAbs.startsWith(repoRoot + path.sep)) { console.error('--out must be outside the repository'); process.exit(1) }
if (!/^[A-Za-z0-9_-]+$/.test(USER)) { console.error('--user must be a user id'); process.exit(1) }

// A throwaway local store holding the copy, so the site's own functions read it.
const store = mkdtempSync(path.join(os.tmpdir(), 'insight-bench-'))
mkdirSync(path.join(store, 'analysis'), { recursive: true })
cpSync(DATA, path.join(store, 'analysis', USER), { recursive: true })
process.env.USE_LOCAL_STORAGE = 'true'
process.env.DATA_DIR = store

type Run = (system: string, user: string) => Promise<string | null>
type Candidate = { id: string; label: string; system: 'old' | 'voice'; backend: 'bedrock' | 'ollama'; model: string }
const CANDIDATES: Candidate[] = [
  { id: 'live', label: 'Live today: Mixtral 8x7B, old prompt, no check', system: 'old', backend: 'bedrock', model: 'mistral.mixtral-8x7b-instruct-v0:1' },
  { id: 'qwen', label: 'Qwen3 Next 80B on Bedrock, new voice + check', system: 'voice', backend: 'bedrock', model: 'qwen.qwen3-next-80b-a3b' },
  { id: 'qwen-local', label: 'Qwen3 Next 80B on this laptop (Ollama), new voice + check', system: 'voice', backend: 'ollama', model: 'qwen3-next:80b' },
]
const only = arg('only')?.split(',')
const candidates = CANDIDATES.filter(c => !only || only.includes(c.id))

// The instructions live before the voice (2026-11-01), frozen here so "live"
// means the old site after this ships too.
const OLD_SYSTEM = "You are this paddler's personal coach \u2014 you know them and their history. Write 2\u20134 short sentences of warm, specific commentary on THIS session: the single most interesting thing that happened, and one useful, forward-looking observation. Value good technique, not just speed: a long, efficient run per stroke (higher distance-per-stroke) and a steady, consistent stroke rate (low variation) are marks of good paddling worth recognising and encouraging \u2014 read them alongside pace, and don't imply higher distance-per-stroke is better without the pace to match. When a paddler profile, history facts, or comparable past paddles are given, weave them in naturally to make it personal and progressive \u2014 reference their trajectory, their goals, and how this session compares to their own record \u2014 but use ONLY the facts provided; never invent numbers. The session date is given below. It may be a recent paddle OR an older one just imported, so narrate it for WHEN it happened \u2014 never assume it is today, and only say \"today\"/\"this morning\" if the date really is today. Vary how you open; avoid generic praise and filler. Sound like a real person who has watched them paddle before. Match your vocabulary to the sport stated below \u2014 rowing and kayak/canoe/SUP use different words for the stroke, the rate, and the glide, so never mix them; if no sport is stated, use neutral paddling language and do not assume rowing vs kayak. Phrase long durations the natural way \u2014 \"1 hour 20 minutes\", never \"80 minutes\". No preamble, no lists, no markdown headings \u2014 just the short paragraph."
const oldSystem = () => OLD_SYSTEM

async function main() {
  const { listSessionSummaries, getSession, getAthleteProfile } = await import('@paddlesnitch/analysis/analysis-store')
  const { computeHistoryStats, renderHistoryFacts, renderRelevant, selectRelevantPaddles } = await import('@paddlesnitch/analysis/history-stats')
  const { buildPrompt, runInsighter, generateInsight, SYSTEM } = await import('@paddlesnitch/analysis/llm')
  const { summaryProblems } = await import('@paddlesnitch/analysis/voice')
  const { plainInsight, split500, fmtDurWords } = await import('@paddlesnitch/analysis/analysis')
  const OLD = oldSystem()

  const runner = (c: Candidate): Run => async (system, user) => {
    process.env.LLM_BACKEND = c.backend
    process.env.LLM_MODEL = c.model
    return (await runInsighter(system, user))?.text ?? null
  }

  // A spread over time, not just the newest: every k-th paddle, oldest to newest.
  const all = (await listSessionSummaries(USER)).sort((a, b) => a.paddledAt.localeCompare(b.paddledAt))
  const step = Math.max(1, Math.floor(all.length / N))
  const picked = all.filter((_, i) => i % step === 0).slice(-N)
  const profile = await getAthleteProfile(USER)

  const rows: unknown[] = []
  for (const [k, s] of picked.entries()) {
    const session = await getSession(USER, s.id)
    if (!session) continue
    const r = session.result
    const when = session.paddledAt
    const prior = all.filter(p => p.paddledAt < when)
    const facts = {
      paddledAt: when, cruiseSpeed: r.cruiseSpeed, distanceKm: r.distanceKm, avgSR: r.avgSR, avgDps: r.avgDps,
      startLat: r.points[0]?.lat, startLng: r.points[0]?.lng,
    }
    const asOf = new Date(Date.parse(when) + 3 * 3600_000)
    const ctx = {
      paddledAt: when, asOf: asOf.toISOString(),
      sport: session.source.type === 'strava' ? session.source.sport : undefined,
      profile: profile?.text,
      historyFacts: renderHistoryFacts(computeHistoryStats(facts, prior, asOf)),
      relevant: renderRelevant(selectRelevantPaddles(facts, prior), facts),
    }
    const prompt = buildPrompt(r, ctx)
    const notes: Record<string, unknown> = {}
    for (const c of candidates) {
      const run = runner(c)
      const t0 = Date.now()
      let text: string | null, firstProblems: string[] = [], drafts = 0
      if (c.system === 'old') {
        // Today's site: one call, no check, the old instructions.
        text = (await run(OLD, prompt))?.trim() || null
        drafts = 1
      } else {
        // The new path exactly as the site will run it, counting drafts.
        const counted: Run = async (sys, user) => {
          drafts++
          const out = await run(sys, user)
          if (drafts === 1 && out) firstProblems = summaryProblems(out, prompt)
          return out
        }
        text = await generateInsight(r, ctx, counted)
      }
      const shown = text ?? plainInsight(r)
      notes[c.id] = {
        text: shown, fellBack: !text, drafts, firstDraftProblems: firstProblems,
        problems: summaryProblems(shown, prompt), seconds: (Date.now() - t0) / 1000,
      }
      console.log(`[${k + 1}/${picked.length}] ${c.id} ${((Date.now() - t0) / 1000).toFixed(1)} s${text ? '' : ' (plain summary)'}`)
    }
    rows.push({
      id: s.id, paddledAt: when, source: session.source.type, sport: session.source.sport ?? null,
      headline: `${r.distanceKm.toFixed(1)} km, ${fmtDurWords(r.durationS)}, ${split500(r.cruiseSpeed)}/500${r.avgSR != null ? `, ${Math.round(r.avgSR)} spm` : ''}`,
      prompt, notes,
    })
  }

  mkdirSync(OUT!, { recursive: true })
  const results = { ranAt: new Date().toISOString(), candidates, voice: SYSTEM, rows }
  writeFileSync(path.join(OUT!, 'results.json'), JSON.stringify(results, null, 2))
  writeFileSync(path.join(OUT!, 'rank.html'), page(results))
  console.log(`\nwrote ${path.join(OUT!, 'results.json')} and rank.html`)
}

// The blind ranking page: each paddle's notes in a shuffled order labelled
// A, B, C. Rankings stay in this browser; "Copy my rankings" gives JSON to
// paste back. "Reveal" shows which model wrote each note and what the check found.
function page(results: { candidates: Candidate[]; rows: unknown[] }): string {
  const data = JSON.stringify(results).replace(/</g, '\\u003c')
  return readFileSync(path.join(__dirname, 'insight-bench.html'), 'utf8').replace('/*DATA*/null', data)
}

main()
  .catch(err => { console.error(err); process.exitCode = 1 })
  .finally(() => rmSync(store, { recursive: true, force: true }))   // the account copy never outlives the run
