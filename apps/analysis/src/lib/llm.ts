// LLM insight adapter — ONE interface, backend chosen by env. The prompt +
// summary shaping below are shared, so tuning locally (Ollama) maps 1:1 to prod
// (Bedrock). Prod hard-pins Bedrock; local uses LLM_BACKEND (ollama|bedrock).
// If no backend is configured or a call fails, generateInsight returns null and
// the caller keeps the deterministic templated insight — nothing ever breaks.
//
// Parity tip: llama3.2 / llama3.3 / mistral exist on BOTH Ollama and Bedrock, so
// you can tune the SAME model locally and deploy it unchanged.
import type { AnalysisResult, Segment } from './analysis'
import { fmtDur, split500 } from './analysis'
import type { SectionRace, Racer, SectionStats } from './similar'

const SYSTEM = [
  'You are this paddler\'s personal coach — you know them and their history.',
  'Write 2–4 short sentences of warm, specific commentary on THIS session: the single most interesting thing that',
  'happened, and one useful, forward-looking observation.',
  'When a paddler profile, history facts, or comparable past paddles are given, weave them in naturally to make it',
  'personal and progressive — reference their trajectory, their goals, and how today compares to their own record —',
  'but use ONLY the facts provided; never invent numbers.',
  'Vary how you open; avoid generic praise and filler. Sound like a real person who has watched them paddle before.',
  'No preamble, no lists, no markdown headings — just the short paragraph.',
].join(' ')

// Extra context blocks fed alongside the session fact sheet. All pre-rendered
// (by history-stats + the athlete-profile module) so llm.ts stays a thin adapter.
export type InsightContext = {
  profile?: string       // the persistent athlete-profile blurb (L2)
  historyFacts?: string  // renderHistoryFacts output (L1)
  relevant?: string      // renderRelevant output (L3)
}

// Compact, grounded fact sheet — the model narrates THIS, nothing else.
function buildPrompt(r: AnalysisResult, ctx: InsightContext = {}): string {
  const L: string[] = []
  L.push(`Session: ${fmtDur(r.durationS)} min, ${r.distanceKm.toFixed(2)} km.`)
  // NB: r.avgSR is already the corrected value; we do NOT tell the model about
  // the SUP×2 normalisation — a small model misreads it as "the athlete doubled
  // their rate". Present the final numbers only.
  L.push(`Cruising pace ~${split500(r.cruiseSpeed)}/500${r.avgSR != null ? ` at ~${Math.round(r.avgSR)} spm` : ''}${r.avgDps != null ? `, ~${r.avgDps.toFixed(1)} m per stroke` : ''}.`)
  const c = r.conditions
  if (c?.windKmh != null || c?.flowM3s != null) {
    const bits: string[] = []
    if (c?.windKmh != null) bits.push(`wind ${Math.round(c.windKmh)} km/h`)
    if (c?.flowM3s != null) bits.push(`river flow ${c.flowM3s.toFixed(1)} m³/s${c.flowStation ? ` (${c.flowStation})` : ''}`)
    L.push(`Conditions: ${bits.join('; ')}.`)
  }
  if (r.stops.length) L.push(`Rests: ${r.stops.length} (${r.stops.map(s => `${fmtDur(s.fromT)} for ${Math.round(s.durS)}s`).join(', ')}).`)
  if (r.surges.length) {
    L.push(`Efforts (${r.surges.length}):`)
    r.surges.forEach((s: Segment, i) => {
      L.push(`  ${i + 1}) at ${fmtDur(s.fromT)}, ${fmtDur(s.durS)}, pace ${split500(s.avgSpeed)}/500${s.avgSR != null ? `, ${Math.round(s.avgSR)} spm${s.srCv != null ? ` (${s.srCv.toFixed(0)}% variation)` : ''}` : ''}${s.trend ? `, ${s.trend}` : ''}.`)
    })
  }
  const sets = r.sets.filter(s => s.count > 1)
  if (sets.length) L.push(`Sets detected: ${sets.map(s => `${s.count} × ~${fmtDur(s.avgDurS)} @ ${split500(s.avgSpeed)}/500`).join('; ')}.`)
  if (!r.surges.length) L.push('No distinct efforts — this was a steady paddle.')
  let out = L.join('\n')
  if (ctx.profile?.trim()) out += `\n\nWho this paddler is (their evolving profile):\n${ctx.profile.trim()}`
  out += ctx.historyFacts ?? ''
  out += ctx.relevant ?? ''
  if (!ctx.profile?.trim() && !ctx.historyFacts && !ctx.relevant) {
    out += '\nThis is one of their first saved sessions — no prior history, so do not compare to past paddles.'
  }
  return out
}

interface Insighter { generate(system: string, user: string, model: string): Promise<string> }

class OllamaInsighter implements Insighter {
  async generate(system: string, user: string, model: string): Promise<string> {
    const base = process.env.OLLAMA_URL ?? 'http://localhost:11434'
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        stream: false, options: { temperature: 0.6 },
      }),
    })
    if (!res.ok) throw new Error(`ollama ${res.status}`)
    const d = await res.json()
    return (d?.message?.content ?? '').trim()
  }
}

class BedrockInsighter implements Insighter {
  async generate(system: string, user: string, model: string): Promise<string> {
    const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime')
    const client = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'eu-west-1' })
    // Fold the system instructions into the user turn rather than using the
    // Converse `system` field — some models (e.g. Mistral Mixtral) reject a
    // separate system message, and inlining works across all of them.
    const out = await client.send(new ConverseCommand({
      modelId: model,
      messages: [{ role: 'user', content: [{ text: `${system}\n\n${user}` }] }],
      inferenceConfig: { maxTokens: 400, temperature: 0.6 },
    }))
    return (out.output?.message?.content?.map(b => ('text' in b ? b.text : '')).join('') ?? '').trim()
  }
}

function makeInsighter(): Insighter | null {
  // Backend is env/code-driven ONLY — there is no per-request or UI selection.
  // Prod ALWAYS uses Bedrock (never the Anthropic quota, never Ollama); local
  // dev picks via LLM_BACKEND; unset → null → deterministic template fallback.
  const backend = process.env.NODE_ENV === 'production' ? 'bedrock' : (process.env.LLM_BACKEND || '')
  if (backend === 'ollama') return new OllamaInsighter()
  if (backend === 'bedrock') return new BedrockInsighter()
  return null
}

// Shared low-level call: run the configured backend (env-driven) with a system +
// user prompt. Returns { text, model } or null (no backend / call failed).
// Reused by every insight generator here AND the athlete-profile module, so the
// backend/model selection lives in exactly one place. `maxTokens` lets the
// profile builder ask for a bit more room than a one-paragraph insight.
export async function runInsighter(system: string, user: string): Promise<{ text: string; model: string } | null> {
  const insighter = makeInsighter()
  if (!insighter) return null
  const model = process.env.LLM_MODEL || 'llama3.2:3b'
  try {
    const text = await insighter.generate(system, user, model)
    return text ? { text, model } : null
  } catch (err) {
    console.error('[llm] generation failed', err)
    return null
  }
}

// Returns the model-written insight, or null (→ caller keeps the template).
// Model + backend come from env (LLM_MODEL / LLM_BACKEND); to change the model,
// change the env/code — it is deliberately not selectable at runtime. The
// history-aware context (profile + aggregates + relevant paddles) is pre-rendered
// by the caller (see the analyse route) and passed in.
export async function generateInsight(result: AnalysisResult, ctx: InsightContext = {}): Promise<string | null> {
  const res = await runInsighter(SYSTEM, buildPrompt(result, ctx))
  return res?.text ?? null
}

// ---- Section race: comparing several efforts over the SAME stretch ----

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const compass = (d?: number | null) => (d == null ? '' : ` from ${COMPASS[Math.round(d / 45) % 8]}`)

const RACE_SYSTEM = [
  'You are an experienced kayak and rowing coach comparing several of ONE paddler\'s efforts over the SAME stretch of river',
  '— a virtual race between a fixed start line and finish line.',
  'In 2–4 short sentences: name the most interesting difference between the efforts, then REASON explicitly about whether the',
  'WIND and RIVER FLOW conditions plausibly explain it — a quicker time with more downstream flow or a tailwind is less',
  'impressive than the raw time; a quicker time INTO a headwind or against low flow is more impressive.',
  'If conditions are missing or similar across efforts, say the difference looks down to the paddler, not the day.',
  'Use ONLY the numbers provided; never invent data. Be concrete. No preamble, no lists, no markdown — just the paragraph.',
].join(' ')

function racerLine(r: Racer, isRef: boolean): string {
  const bits = [`pace ${split500(r.cruiseSpeed)}/500`]
  if (r.avgSR != null) bits.push(`${Math.round(r.avgSR)} spm`)
  const c = r.conditions
  if (c?.windKmh != null) bits.push(`wind ${Math.round(c.windKmh)} km/h${compass(c.windDir)}`)
  if (c?.flowM3s != null) bits.push(`flow ${c.flowM3s.toFixed(1)} m³/s`)
  if (c?.windKmh == null && c?.flowM3s == null) bits.push('conditions unavailable')
  const d = r.paddledAt?.slice(0, 10) ?? '?'
  return `  - ${d}${isRef ? ' (reference)' : ''}: ${fmtDur(r.elapsedS)}, ${bits.join(', ')}.`
}

function buildRacePrompt(race: SectionRace): string {
  const ref = race.racers.find(r => r.isSource)
  const ordered = [...race.racers].sort((a, b) => a.elapsedS - b.elapsedS)
  const L = [`Same stretch: ${(race.sectionM / 1000).toFixed(2)} km. ${race.racers.length} efforts, fastest first:`]
  ordered.forEach(r => L.push(racerLine(r, !!ref && r.sessionId === ref.sessionId)))
  return L.join('\n')
}

// Deterministic fallback: always available, no network. Names the spread and a
// conditions read so the board is never blank.
export function buildRaceInsight(race: SectionRace): string {
  const ordered = [...race.racers].sort((a, b) => a.elapsedS - b.elapsedS)
  if (ordered.length < 2) return `One effort over this ${(race.sectionM / 1000).toFixed(2)} km stretch: ${fmtDur(ordered[0]?.elapsedS ?? 0)}. Race it against another paddle to compare.`
  const fast = ordered[0], slow = ordered[ordered.length - 1]
  const gap = Math.round(slow.elapsedS - fast.elapsedS)
  const fd = fast.paddledAt?.slice(0, 10) ?? '?', sd = slow.paddledAt?.slice(0, 10) ?? '?'
  let s = `Over this ${(race.sectionM / 1000).toFixed(2)} km stretch, ${fd} was fastest at ${fmtDur(fast.elapsedS)} — ${gap}s ahead of ${sd} (${fmtDur(slow.elapsedS)}).`
  const ff = fast.conditions?.flowM3s, sf = slow.conditions?.flowM3s
  const fw = fast.conditions?.windKmh, sw = slow.conditions?.windKmh
  if (ff != null && sf != null && Math.abs(ff - sf) >= 0.5) {
    s += ff > sf
      ? ` The river was running higher on the quicker day (${ff.toFixed(1)} vs ${sf.toFixed(1)} m³/s), so some of that gap may be flow, not form.`
      : ` The quicker day had lower flow (${ff.toFixed(1)} vs ${sf.toFixed(1)} m³/s), so the pace stands on its own.`
  } else if (fw != null && sw != null && Math.abs(fw - sw) >= 3) {
    s += fw < sw
      ? ` Less wind on the quicker day (${Math.round(fw)} vs ${Math.round(sw)} km/h) may account for part of it.`
      : ` And it was into more wind (${Math.round(fw)} vs ${Math.round(sw)} km/h) — a genuinely stronger effort.`
  } else {
    s += ` Conditions were similar (or unavailable), so the difference looks down to the paddler.`
  }
  return s
}

// LLM race narrative, or null → caller uses buildRaceInsight. Returns the text
// and the model that wrote it.
export async function generateRaceInsight(race: SectionRace): Promise<{ text: string; model: string } | null> {
  const insighter = makeInsighter()
  if (!insighter) return null
  const model = process.env.LLM_MODEL || 'llama3.2:3b'
  try {
    const text = await insighter.generate(RACE_SYSTEM, buildRacePrompt(race), model)
    return text ? { text, model } : null
  } catch (err) {
    console.error('[llm] race insight generation failed', err)
    return null
  }
}

// ---- Section focus: narrate ONE selected stretch of a single paddle ----

const SECTION_SYSTEM = [
  'You are an experienced kayak and rowing coach looking at ONE stretch a paddler selected from their session.',
  'In 2–3 short sentences, describe how they paddled THIS stretch specifically: the pace, the stroke rate and length,',
  'and whether they held / built / faded across it (use the first-half vs second-half split). If wind or river flow is',
  'given, note briefly whether it likely helped or hurt on this stretch. Use ONLY the numbers provided; never invent data.',
  'No preamble, no lists, no markdown — just the short paragraph about this section.',
].join(' ')

const COMPASS2 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const dir2 = (d?: number | null) => (d == null ? '' : ` from ${COMPASS2[Math.round(d / 45) % 8]}`)
const trendWord = (a: number, b: number) => {
  if (a <= 0) return 'steady'
  const chg = (b - a) / a
  return chg > 0.04 ? 'built (finished faster)' : chg < -0.04 ? 'faded (slowed through it)' : 'held steady'
}

function buildSectionPrompt(s: SectionStats): string {
  const L = [`Selected stretch: ${(s.sectionM / 1000).toFixed(2)} km in ${fmtDur(s.elapsedS)}, pace ${split500(s.cruiseSpeed)}/500.`]
  if (s.avgSR != null) L.push(`Stroke rate ~${Math.round(s.avgSR)} spm${s.avgDps != null ? `, ~${s.avgDps.toFixed(1)} m per stroke` : ''}${s.srSlopePerMin != null ? ` (${s.srSlopePerMin >= 0 ? '+' : ''}${s.srSlopePerMin.toFixed(0)} spm/min across it)` : ''}.`)
  L.push(`Pace ${trendWord(s.firstHalfSpeed, s.secondHalfSpeed)}: first half ${split500(s.firstHalfSpeed)}/500 vs second half ${split500(s.secondHalfSpeed)}/500.`)
  const c = s.conditions
  if (c?.windKmh != null || c?.flowM3s != null) {
    const bits: string[] = []
    if (c?.windKmh != null) bits.push(`wind ${Math.round(c.windKmh)} km/h${dir2(c.windDir)}`)
    if (c?.flowM3s != null) bits.push(`river flow ${c.flowM3s.toFixed(1)} m³/s`)
    L.push(`Conditions that day: ${bits.join('; ')}.`)
  }
  return L.join('\n')
}

// Deterministic fallback — never blank, no backend needed.
export function buildSectionInsight(s: SectionStats): string {
  const t = trendWord(s.firstHalfSpeed, s.secondHalfSpeed)
  let out = `Over this ${(s.sectionM / 1000).toFixed(2)} km stretch you held ${split500(s.cruiseSpeed)}/500`
  out += s.avgSR != null ? ` at ~${Math.round(s.avgSR)} spm${s.avgDps != null ? ` (~${s.avgDps.toFixed(1)} m/stroke)` : ''}.` : '.'
  out += ` Pace ${t} — ${split500(s.firstHalfSpeed)}/500 into ${split500(s.secondHalfSpeed)}/500.`
  const c = s.conditions
  if (c?.flowM3s != null) out += ` River was running ${c.flowM3s.toFixed(1)} m³/s.`
  else if (c?.windKmh != null) out += ` Wind ${Math.round(c.windKmh)} km/h${dir2(c.windDir)}.`
  return out
}

// LLM narrative for a single selected stretch, or null → caller uses the template.
export async function generateSectionInsight(s: SectionStats): Promise<{ text: string; model: string } | null> {
  const insighter = makeInsighter()
  if (!insighter) return null
  const model = process.env.LLM_MODEL || 'llama3.2:3b'
  try {
    const text = await insighter.generate(SECTION_SYSTEM, buildSectionPrompt(s), model)
    return text ? { text, model } : null
  } catch (err) {
    console.error('[llm] section insight generation failed', err)
    return null
  }
}
