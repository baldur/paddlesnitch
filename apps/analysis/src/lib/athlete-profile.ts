// L2 — the persistent "who is this paddler" memory. Distilled by the LLM from
// the paddler's history + diary notes, stored once, and fed into every per-paddle
// insight at a CONSTANT token cost. Built once (≥ MIN_PADDLES), then cheaply
// merged as each new paddle is saved, with a periodic full re-distill to prevent
// drift. Falls back to a deterministic template when no LLM backend is
// configured, so it never breaks. See docs/features/personable-insights.md.
import { split500 } from './analysis'
import { runInsighter } from './llm'
import { getAthleteProfile, saveAthleteProfile, type AthleteProfile, type SessionSummary } from './analysis-store'

const MIN_PADDLES = 3        // cold start: below this, no profile (aggregates carry it)
const REDISTILL_EVERY = 10   // full rebuild cadence (paddles since last full build)
const MAX_PROFILE_CHARS = 900

const PROFILE_SYSTEM = [
  'You maintain a concise coaching profile of a single paddler — the durable picture of who they are, NOT a report on one session.',
  'Write 3–5 sentences (no lists, no markdown) capturing: their typical sessions and distances, boat class(es), home water if evident,',
  'what they seem to be working on or care about (from their own diary notes), their trajectory, and their character as a paddler.',
  'Use ONLY the information given; never invent specifics. Keep it under 120 words. Write it as durable notes a coach would keep.',
].join(' ')

function summaryLine(h: SessionSummary): string {
  const d = h.paddledAt?.slice(0, 10) ?? '?'
  const bits = [`${d}: ${h.distanceKm.toFixed(1)}km`, `cruise ${split500(h.cruiseSpeed)}/500`]
  if (h.avgSR != null) bits.push(`${Math.round(h.avgSR)}spm`)
  if (h.boatClass) bits.push(h.boatClass)
  let line = `  - ${bits.join(', ')}.`
  if (h.note?.trim()) line += ` Note: "${h.note.trim().slice(0, 160)}"`
  return line
}

function buildFromScratchPrompt(summaries: SessionSummary[]): string {
  const recent = summaries.slice(0, 30) // newest-first; cap for tokens
  return `Here are the paddler's saved paddles (newest first):\n${recent.map(summaryLine).join('\n')}\n\nWrite their coaching profile.`
}

function mergePrompt(current: AthleteProfile, latest: SessionSummary): string {
  return `Existing profile of the paddler:\n"${current.text}"\n\nTheir latest paddle:\n${summaryLine(latest)}\n\nReturn the UPDATED profile — keep what still holds, fold in anything new (a shift in focus, a new boat class, progress, a note they left). Same length and style.`
}

// Deterministic fallback — a plain-but-honest profile from the numbers, so the
// feature works with no LLM backend (and in tests). Never fabricates.
export function deterministicProfile(summaries: SessionSummary[]): string {
  if (summaries.length < MIN_PADDLES) return ''
  const dist = summaries.map(s => s.distanceKm)
  const avgDist = dist.reduce((a, b) => a + b, 0) / dist.length
  const classes = [...new Set(summaries.map(s => s.boatClass).filter(Boolean))] as string[]
  const withNotes = summaries.filter(s => s.note?.trim()).length
  const bits = [`A paddler with ${summaries.length} logged paddles, typically around ${avgDist.toFixed(1)} km.`]
  if (classes.length) bits.push(`Boat${classes.length > 1 ? 's' : ''}: ${classes.join(', ')}.`)
  if (withNotes) bits.push(`Keeps a diary — ${withNotes} of their sessions carry personal notes.`)
  return bits.join(' ')
}

// Refresh the stored profile after a new paddle is saved. Decides skip (cold
// start) / full re-distill (drift cadence or no profile yet) / incremental merge.
// `allSummaries` includes the just-saved paddle. Best-effort — a failure leaves
// the previous profile in place and is swallowed by the caller.
export async function refreshAthleteProfile(userId: string, latest: SessionSummary, allSummaries: SessionSummary[], nowIso: string): Promise<AthleteProfile | null> {
  if (allSummaries.length < MIN_PADDLES) return null
  const existing = await getAthleteProfile(userId)
  const needsFull = !existing || (allSummaries.length - existing.builtFromCount) >= REDISTILL_EVERY

  let text: string
  if (needsFull) {
    const llm = await runInsighter(PROFILE_SYSTEM, buildFromScratchPrompt(allSummaries))
    text = llm?.text ?? deterministicProfile(allSummaries)
  } else {
    const llm = await runInsighter(PROFILE_SYSTEM, mergePrompt(existing, latest))
    text = llm?.text ?? existing.text
  }
  if (!text.trim()) return null

  const profile: AthleteProfile = {
    text: text.trim().slice(0, MAX_PROFILE_CHARS),
    updatedAt: nowIso,
    builtFromCount: needsFull ? allSummaries.length : existing!.builtFromCount,
  }
  await saveAthleteProfile(userId, profile)
  return profile
}
