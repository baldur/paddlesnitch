// L2 — the persistent "who is this paddler" memory. Distilled by the LLM from
// the paddler's history + diary notes, stored once, and fed into every per-paddle
// insight at a CONSTANT token cost. Built once (≥ MIN_PADDLES), then cheaply
// merged as each new paddle is saved, with a periodic full re-distill to prevent
// drift. Falls back to a deterministic template when no LLM backend is
// configured, so it never breaks. See docs/features/personable-insights.md.
//
// Every draft goes through profileProblems (voice.ts) before it is saved: the
// profile is fed into every summary, so its mistakes repeat (#821).
import { isMotionOnly } from '@paddlesnitch/core/paddles'
import { historyBits } from './history-stats'
import { runInsighter, RETRY_IF_FIRST_UNDER_MS, type Run } from './llm'
import { profileProblems, numbersNotInFacts, tidyDraft } from './voice'
import { getAthleteProfile, saveAthleteProfile, type AthleteProfile, type SessionSummary } from './analysis-store'

const MIN_PADDLES = 3        // cold start: below this, no profile (aggregates carry it)
const REDISTILL_EVERY = 10   // full rebuild cadence (paddles since last full build)

// In the paddlesnitch voice (voice.ts).
export const PROFILE_SYSTEM = [
  'You keep a short profile of one paddler on paddlesnitch: the lasting picture of who they are as a paddler, not a report on one paddle.',
  'It is read before writing the note under each of their paddles.',
  'Plain British English, dry and exact. No praise words, no exclamation marks, no dashes as punctuation, no questions, no lists or markdown.',
  'Write 3 to 5 sentences, under 100 words: their usual paddles and distances, boat classes, home water if their notes name it,',
  'what their own notes say they are working on, and how their pace has changed.',
  'Use only what you are given. Use only numbers exactly as they appear (a distance may be rounded): never work out an average,',
  'total or difference that is not given. Pace is per 500 m, written like 2:31/500.',
  'You did not watch them paddle: never describe their technique, feel, effort or mood, and never compare them with other paddlers.',
  'Say what changed, not why. Call each outing a paddle (a row for rowers), never a session.',
].join(' ')

function summaryLine(h: SessionSummary): string {
  const bits = historyBits(h)
  if (h.avgSR != null) bits.push(`${Math.round(h.avgSR)}spm`)
  if (h.boatClass) bits.push(h.boatClass)
  let line = `  - ${bits.join(', ')}.`
  if (h.note?.trim()) line += ` Note: "${h.note.trim().slice(0, 160)}"`
  return line
}

// Paddles without a map (#414) have no distance to average.
function avgDistanceKm(summaries: SessionSummary[]): number | null {
  const dist = summaries.filter(s => !isMotionOnly(s)).map(s => s.distanceKm)
  return dist.length ? dist.reduce((a, b) => a + b, 0) / dist.length : null
}

// The count and average are worked out here and given, so the profile can use
// them and still pass the number check.
function totalsLine(summaries: SessionSummary[]): string {
  const avg = avgDistanceKm(summaries)
  return `They have ${summaries.length} saved paddles${avg != null ? `, ${avg.toFixed(1)} km on average` : ''}.`
}

function buildFromScratchPrompt(summaries: SessionSummary[]): string {
  const recent = summaries.slice(0, 30) // newest-first; cap for tokens
  return `${totalsLine(summaries)}\nHere are the paddler's saved paddles (newest first):\n${recent.map(summaryLine).join('\n')}\n\nWrite their profile.`
}

function mergePrompt(current: AthleteProfile, latest: SessionSummary, count: number): string {
  return `Existing profile of the paddler:\n"${current.text}"\n\nThey now have ${count} saved paddles. Their latest paddle:\n${summaryLine(latest)}\n\nReturn the updated profile: keep what still holds, and add anything new (a new boat class, a change in pace, a note they left). Same length and style.`
}

// Deterministic fallback: a plain profile from the numbers, so the feature
// works with no LLM backend (and in tests), and stands in when there is no
// good draft and no stored profile worth keeping. Never fabricates.
export function deterministicProfile(summaries: SessionSummary[]): string {
  if (summaries.length < MIN_PADDLES) return ''
  const avgDist = avgDistanceKm(summaries)
  const classes = [...new Set(summaries.map(s => s.boatClass).filter(Boolean))] as string[]
  const withNotes = summaries.filter(s => s.note?.trim()).length
  const bits = [`A paddler with ${summaries.length} logged paddles${avgDist != null ? `, typically around ${avgDist.toFixed(1)} km` : ''}.`]
  if (classes.length) bits.push(`Boat${classes.length > 1 ? 's' : ''}: ${classes.join(', ')}.`)
  if (withNotes) bits.push(`Keeps a diary: ${withNotes} of their paddles carry personal notes.`)
  return bits.join(' ')
}

// A stored profile that fails the check (one written before #821) is rebuilt,
// not kept. Its own text is its facts, so only the other rules apply.
const sound = (p: AthleteProfile | null): p is AthleteProfile => !!p && !profileProblems(p.text, p.text).length

// One draft, checked. A failing draft goes back once with what was wrong, but
// only if the first call was quick: the profile update runs after the
// summary's call in the same request. Null = no draft worth saving.
async function draftProfile(prompt: string, run: Run): Promise<string | null> {
  const started = Date.now()
  const first = tidyDraft((await run(PROFILE_SYSTEM, prompt)) ?? '')
  if (!first) return null
  const problems = profileProblems(first, prompt)
  if (!problems.length) return first
  if (Date.now() - started > RETRY_IF_FIRST_UNDER_MS) {
    console.warn('[profile] draft broke the voice; no time to retry', { problems: problems.length })
    return null
  }
  const unknown = numbersNotInFacts(first, prompt)
  const again = `${prompt}\n\nYour draft:\n${first}\n\nThe draft breaks the rules: ${problems.join('; ')}.`
    + (unknown.length ? ` Leave out ${unknown.join(', ')}: use a number from the paddles given or none.` : '')
    + ' Write the profile again, keeping every rule.'
  const second = tidyDraft((await run(PROFILE_SYSTEM, again)) ?? '')
  if (second && !profileProblems(second, prompt).length) return second
  console.warn('[profile] draft broke the voice twice', { problems: problems.length })
  return null
}

const runConfigured: Run = async (system, user) => (await runInsighter(system, user))?.text ?? null

// Refresh the stored profile after a new paddle is saved. Decides skip (cold
// start) / full re-distill (drift cadence, no profile yet, or one that fails
// the check) / incremental merge. `allSummaries` includes the just-saved
// paddle. With no good draft, the previous profile stays as it is, or the
// deterministic one is saved if there is none worth keeping.
// Best-effort: a failure is swallowed by the caller.
export async function refreshAthleteProfile(userId: string, latest: SessionSummary, allSummaries: SessionSummary[], nowIso: string, run: Run = runConfigured): Promise<AthleteProfile | null> {
  if (allSummaries.length < MIN_PADDLES) return null
  const stored = await getAthleteProfile(userId)
  const existing = sound(stored) ? stored : null
  const needsFull = !existing || (allSummaries.length - existing.builtFromCount) >= REDISTILL_EVERY

  const prompt = existing && !needsFull ? mergePrompt(existing, latest, allSummaries.length) : buildFromScratchPrompt(allSummaries)
  const draft = await draftProfile(prompt, run)
  if (!draft && existing) return existing
  const text = draft ?? deterministicProfile(allSummaries)
  if (!text) return null

  const profile: AthleteProfile = {
    text,
    updatedAt: nowIso,
    builtFromCount: existing && !needsFull ? existing.builtFromCount : allSummaries.length,
  }
  await saveAthleteProfile(userId, profile)
  return profile
}
