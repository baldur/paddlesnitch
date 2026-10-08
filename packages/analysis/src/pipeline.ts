// The shared "analyse a resolved track and save it to the library" core, used by
// BOTH the manual analyse route (file / Strava / trial / device) and the Strava
// auto-import webhook. It owns everything after the track is resolved: real
// conditions, the deterministic analysis, duplicate detection, the memory-aware
// LLM narrative, and the save — plus the follow-up athlete-profile refresh.
//
// Framework-agnostic: the profile refresh is a second LLM call kept off the
// caller's critical path, so the caller passes a `schedule` (e.g. Next's
// `after`); with no scheduler it just awaits inline (webhook / tests).
import { nanoid } from 'nanoid'
import { getWeatherAt } from '@paddlesnitch/timing/weather'
import { getFlowAt } from '@paddlesnitch/timing/river-flow'
import type { TrackPoint } from '@paddlesnitch/timing/types'
import { analyseTrack, type AnalysisResult } from './analysis'
import { generateInsight, type InsightContext } from './llm'
import { computeHistoryStats, renderHistoryFacts, selectRelevantPaddles, renderRelevant, type PaddleFacts } from './history-stats'
import { refreshAthleteProfile } from './athlete-profile'
import {
  saveSession, listSessionSummaries, getSession, getAthleteProfile, paddleFingerprint,
  type AnalysisSession, type AnalysisSource, type SessionSummary,
} from './analysis-store'

// Resolve a best-effort promise to null on rejection or a deadline, so a slow
// external dependency (Open-Meteo / EA — no fetch timeout of their own) can never
// stall the analysis toward the Lambda timeout.
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>(resolve => setTimeout(() => resolve(null), ms)),
  ])
}

// `dropped`: the caller's shouldSave said no, so nothing was saved.
export type AnalyseSaveResult = { session: AnalysisSession; duplicate: boolean; dropped?: true }

// Analyse `track` for `userId`, save it as a paddle, and return the saved (or
// pre-existing duplicate) session. Every enrichment step degrades on its own —
// conditions, history/memory, and the LLM can each fail without failing the save.
export async function analyseAndSave(
  userId: string,
  track: TrackPoint[],
  source: AnalysisSource,
  opts: {
    now?: Date; sport?: string; schedule?: (fn: () => void | Promise<void>) => void
    // The paddle's id, when the caller needs a fixed one (a tracker recording's
    // paddle, so two jobs for one recording write the same paddle).
    id?: string
    // Asked just before saving (after the slow summary): false drops the save.
    shouldSave?: () => Promise<boolean>
    // Save with the plain summary and return without calling the LLM; the
    // paddle page then asks for the written one (writePendingSummary). For a
    // person waiting on the upload: on our Lambda, work scheduled with after()
    // still holds the response until it finishes, so it can't hide the LLM.
    deferSummary?: boolean
  } = {},
): Promise<AnalyseSaveResult> {
  const now = opts.now ?? new Date()
  const mid = track[Math.floor(track.length / 2)]
  const when = track[0].timestamp.toISOString()

  // best-effort real conditions, bounded so a slow external API can't hang us.
  const [weather, flow] = await Promise.all([
    withDeadline(getWeatherAt(mid.lat, mid.lng, when), 4000),
    withDeadline(getFlowAt(mid.lat, mid.lng, when), 4000),
  ])
  const conditions = {
    windKmh: weather?.windSpeedKmh, windDir: weather?.windDirectionDeg,
    flowM3s: flow?.valueM3s, flowStation: flow?.stationLabel,
  }

  const result = analyseTrack(track, { doubleStrokeRate: false, conditions })

  // Read the library ONCE; reuse for both duplicate detection and memory context.
  let prior: SessionSummary[] = []
  try { prior = await listSessionSummaries(userId) }
  catch (err) { console.error('[analyse] history read failed', err) }

  // Duplicate detection (#178): return the existing paddle instead of a 2nd copy.
  const fp = paddleFingerprint(when, result.durationS, result.distanceKm)
  const dup = prior.find(s => paddleFingerprint(s.paddledAt, s.durationS, s.distanceKm) === fp)
  if (dup) {
    const existing = await getSession(userId, dup.id).catch(() => null)
    if (existing) return { session: existing, duplicate: true }
  }

  const sportSignal = opts.sport ?? (source.type === 'strava' ? source.sport : undefined)
  if (!opts.deferSummary) await narrate(userId, result, when, prior, now, sportSignal)
  const session: AnalysisSession = {
    id: opts.id ?? nanoid(), userId, createdAt: now.toISOString(), paddledAt: when,
    source, doubleStrokeRate: false, note: '', insight: result.insight, result,
    ...(opts.deferSummary ? { insightPending: true as const } : {}),
  }
  if (opts.shouldSave && !(await opts.shouldSave())) return { session, duplicate: false, dropped: true }
  await saveSession(session)
  // The profile is folded in when the written summary is (writePendingSummary).
  if (opts.deferSummary) return { session, duplicate: false }

  // Fold this paddle into the persistent athlete profile for NEXT time (a 2nd LLM
  // call). Off the critical path when a scheduler is given; awaited otherwise.
  const refresh = () => foldIntoProfile(userId, session.id)
  if (opts.schedule) opts.schedule(refresh); else await refresh()

  return { session, duplicate: false }
}

async function foldIntoProfile(userId: string, id: string): Promise<void> {
  try {
    const all = await listSessionSummaries(userId)
    const latest = all.find(s => s.id === id)
    if (latest) await refreshAthleteProfile(userId, latest, all, new Date().toISOString())
  } catch (err) { console.error('[analyse] profile refresh failed', err) }
}

/**
 * Writes the AI summary of a paddle saved with `deferSummary`, then folds the
 * paddle into the athlete profile, as analyseAndSave would have. A paddle whose
 * summary is already written is returned as it is, so asking twice costs one
 * LLM call at most per request that finds it pending. Everything the paddler
 * changed meanwhile (note, boat, share link) is kept: the paddle is read again
 * just before saving, and a paddle deleted meanwhile stays deleted (null).
 */
export async function writePendingSummary(userId: string, id: string, opts: { now?: Date } = {}): Promise<AnalysisSession | null> {
  const before = await getSession(userId, id)
  if (!before?.insightPending) return before
  const now = opts.now ?? new Date()
  let prior: SessionSummary[] = []
  try { prior = (await listSessionSummaries(userId)).filter(s => s.id !== id) }
  catch (err) { console.error('[analyse] history read failed', err) }
  const result: AnalysisResult = { ...before.result }
  const sport = before.source.type === 'strava' ? before.source.sport : undefined
  await narrate(userId, result, before.paddledAt, prior, now, sport)

  const latest = await getSession(userId, id)
  if (!latest) return null
  if (!latest.insightPending) return latest
  const { insightPending: _, ...rest } = latest
  const session: AnalysisSession = {
    ...rest, insight: result.insight,
    result: { ...latest.result, insight: result.insight, ...(result.insightModel ? { insightModel: result.insightModel } : {}) },
  }
  await saveSession(session)
  await foldIntoProfile(userId, id)
  return session
}

// The memory-aware written summary (docs/features/personable-insights.md), in
// place on `result`. Grounded facts only, and every read is wrapped so an error
// degrades to the plain summary analyseTrack already wrote.
async function narrate(
  userId: string, result: AnalysisResult, when: string, prior: SessionSummary[], now: Date, sport?: string,
): Promise<void> {
  let ctx: InsightContext = { paddledAt: when, asOf: now.toISOString(), sport }
  try {
    const profile = await getAthleteProfile(userId)
    const currentFacts: PaddleFacts = {
      paddledAt: when, cruiseSpeed: result.cruiseSpeed, distanceKm: result.distanceKm,
      avgSR: result.avgSR, avgDps: result.avgDps,
      startLat: result.points[0]?.lat, startLng: result.points[0]?.lng,
    }
    ctx = {
      ...ctx,
      profile: profile?.text,
      historyFacts: renderHistoryFacts(computeHistoryStats(currentFacts, prior, now)),
      relevant: renderRelevant(selectRelevantPaddles(currentFacts, prior)),
    }
  } catch (err) { console.error('[analyse] memory context failed', err) }

  const narrated = await generateInsight(result, ctx)
  if (narrated) { result.insight = narrated; result.insightModel = process.env.LLM_MODEL || '' }
}

/**
 * Re-analyses a saved paddle from a fuller track (a tracker paddle whose motion
 * data arrived after it was made: one-paddle.md, phase 2) and rewrites its
 * summary. Keeps everything the paddler set: diary note, boat class and seat,
 * share link. Not folded into the athlete profile again (it already was).
 */
export async function reanalyseAndSave(userId: string, existing: AnalysisSession, track: TrackPoint[], opts: { now?: Date } = {}): Promise<AnalysisSession> {
  const now = opts.now ?? new Date()
  const result = analyseTrack(track, { doubleStrokeRate: existing.doubleStrokeRate, conditions: existing.result.conditions })
  let prior: SessionSummary[] = []
  try { prior = (await listSessionSummaries(userId)).filter(s => s.id !== existing.id) }
  catch (err) { console.error('[analyse] history read failed', err) }
  await narrate(userId, result, existing.paddledAt, prior, now)
  const session: AnalysisSession = { ...existing, insight: result.insight, result }
  await saveSession(session)
  return session
}
